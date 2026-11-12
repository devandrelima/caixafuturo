import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createRestaurantDemo } from '../../demo/restaurant';
import { project } from '../../domain/finance/projection';
import type { CashEntry, CashSettings } from '../../domain/finance/types';
import { CashDashboard } from '../CashDashboard';
import { RiskCalendar } from '../RiskCalendar';

const demo = () => {
  const { settings, entries } = createRestaurantDemo();
  return { settings, entries, result: project(settings, entries), byId: new Map(entries.map((e) => [e.id, e] as const)) };
};

function renderDashboard(settings: CashSettings, entries: CashEntry[], selected: string | null = null, onSelect = vi.fn()) {
  const result = project(settings, entries);
  render(<CashDashboard settings={settings} result={result} entriesById={new Map(entries.map((e) => [e.id, e] as const))} selectedDate={selected} onSelectDate={onSelect} />);
  return { result, onSelect };
}

describe('CashDashboard (dados do motor)', () => {
  it('indicadores rotulados com data e valores calculados pelo motor', () => {
    const { settings, entries } = demo();
    renderDashboard(settings, entries);
    expect(screen.getByText('Saldo informado em 11/11/2026')).toBeInTheDocument();
    expect(screen.getByText('R$ 3.000,00')).toBeInTheDocument();
    expect(screen.getByText('Saldo projetado em 11/12/2026')).toBeInTheDocument();
    expect(screen.getByText('R$ 3.300,00')).toBeInTheDocument();
    expect(screen.getByText('Menor saldo projetado')).toBeInTheDocument();
    expect(screen.getByText('em 14/11/2026')).toBeInTheDocument();
    expect(screen.getByText('Próxima data crítica')).toBeInTheDocument();
  });

  it('aviso de risco: saldo negativo em 14/11 com déficit de R$ 1.700 e origem', () => {
    const { settings, entries } = demo();
    renderDashboard(settings, entries);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Saldo projetado negativo em 14/11/2026');
    expect(alert).toHaveTextContent('R$ 1.700,00');
    expect(alert).toHaveTextContent('Aluguel fictício');
    expect(alert).toHaveTextContent('abaixo do mínimo em 12/11/2026');
  });

  it('tabela alternativa traz os saldos do contrato, vindos dos mesmos pontos', async () => {
    const { settings, entries } = demo();
    renderDashboard(settings, entries);
    expect(screen.queryByRole('table', { name: /saldo projetado por dia/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /mostrar tabela de valores/i }));
    const table = screen.getByRole('table', { name: /saldo projetado por dia/i });
    const row = (date: string) => table.querySelector(`tr[data-date="${date}"]`) as HTMLElement;
    expect(within(row('2026-11-12')).getByText('R$ 500,00')).toBeInTheDocument();
    expect(within(row('2026-11-13')).getByText('R$ 1.300,00')).toBeInTheDocument();
    expect(within(row('2026-11-14')).getByText('-R$ 700,00')).toBeInTheDocument();
    expect(within(row('2026-11-14')).getByText('Saldo negativo')).toBeInTheDocument();
    expect(within(row('2026-11-15')).getByText('R$ 3.300,00')).toBeInTheDocument();
    expect(table.querySelectorAll('tbody tr')).toHaveLength(30);
  });

  it('gráfico: foco por teclado percorre os dias e mostra saldo e situação', async () => {
    const { settings, entries } = demo();
    renderDashboard(settings, entries);
    const group = screen.getByRole('group', { name: /gráfico do saldo projetado/i });
    group.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('12/11/2026');
    expect(screen.getByRole('status')).toHaveTextContent('R$ 500,00');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('-R$ 700,00');
    expect(screen.getByRole('status')).toHaveTextContent('Saldo negativo');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('status')).toHaveTextContent('12/11/2026');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('status')).toHaveTextContent('11/12/2026');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('marcadores de risco por forma: 1 quadrado (negativo) e 1 círculo (abaixo do mínimo)', () => {
    const { settings, entries } = demo();
    const { container } = render(
      <CashDashboard settings={settings} result={project(settings, entries)} entriesById={new Map()} selectedDate={null} onSelectDate={() => {}} />,
    );
    expect(container.querySelectorAll('rect.cf-chart__mark--neg')).toHaveLength(1);
    expect(container.querySelectorAll('circle.cf-chart__mark--warn')).toHaveLength(1);
    expect(container.querySelector('path.cf-chart__line')).not.toBeNull();
    expect(container.querySelector('line.cf-chart__min')).not.toBeNull();
  });

  it('sem risco: mensagem prudente e valores corretos', () => {
    renderDashboard({ baseDate: '2026-11-11', openingBalanceCents: '500000', minimumBalanceCents: '100000' }, []);
    expect(screen.getByText(/nenhum risco detectado nos próximos 30 dias com os dados informados/i)).toBeInTheDocument();
    expect(screen.getByText('Nenhuma')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Nenhum lançamento agendado nos próximos 30 dias.')).toBeInTheDocument();
  });

  it('apenas abaixo do mínimo: aviso âmbar com data e déficit', () => {
    renderDashboard({ baseDate: '2026-11-11', openingBalanceCents: '50000', minimumBalanceCents: '100000' }, []);
    expect(screen.getAllByText(/Risco de ficar abaixo do mínimo em 12\/11\/2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R\$ 500,00/).length).toBeGreaterThan(0);
  });

  it('avisa sobre lançamentos vencidos até a data-base e duplicados', () => {
    const { settings, entries } = demo();
    const stale: CashEntry = { ...entries[0]!, id: 'velho', sourceKey: 'manual:velho', dueDate: '2026-11-10' };
    const dup: CashEntry = { ...entries[1]!, id: 'dup' };
    renderDashboard(settings, [...entries, stale, dup]);
    expect(screen.getByText(/1 lançamento\(s\) agendado\(s\) até a data-base não entram na projeção/)).toBeInTheDocument();
    expect(screen.getByText(/1 lançamento\(s\) duplicado\(s\) ignorado\(s\)/)).toBeInTheDocument();
  });

  it('editar saldo inicial muda os valores exibidos (nada é constante)', () => {
    const { entries } = demo();
    renderDashboard({ baseDate: '2026-11-11', openingBalanceCents: '900000', minimumBalanceCents: '100000' }, entries);
    expect(screen.getByText('R$ 9.000,00')).toBeInTheDocument();
    expect(screen.getByText('R$ 9.300,00')).toBeInTheDocument();
    expect(screen.queryByText(/Saldo projetado negativo/)).toBeNull();
  });
});

describe('RiskCalendar', () => {
  it('lista os 30 dias do horizonte em dois meses e navega entre eles', async () => {
    const { result, byId } = demo();
    const onSelect = vi.fn();
    render(<RiskCalendar baseDate="2026-11-11" openingCents={300000n} points={result.points} entriesById={byId} selectedDate="2026-11-14" onSelectDate={onSelect} firstRiskDate="2026-11-12" />);
    expect(screen.getByText(/novembro de 2026/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mês anterior/i })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /^\d{2}\/\d{2}\/2026, saldo/ })).toHaveLength(19); // 12..30/11
    await userEvent.click(screen.getByRole('button', { name: /próximo mês/i }));
    expect(screen.getByText(/dezembro de 2026/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /próximo mês/i })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /^\d{2}\/12\/2026, saldo/ })).toHaveLength(11); // 01..11/12
  });

  it('dia crítico tem rótulo textual e detalhe com a origem do cálculo', () => {
    const { result, byId } = demo();
    render(<RiskCalendar baseDate="2026-11-11" openingCents={300000n} points={result.points} entriesById={byId} selectedDate="2026-11-14" onSelectDate={() => {}} firstRiskDate="2026-11-12" />);
    const day = screen.getByRole('button', { name: /14\/11\/2026, saldo -R\$ 700,00, Saldo negativo, pagamento/ });
    expect(day).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/faltam R\$ 1\.700,00 para o mínimo/)).toBeInTheDocument();
    expect(screen.getByText(/A pagar: Aluguel fictício — R\$ 2\.000,00/)).toBeInTheDocument();
  });

  it('selecionar data e "Ir para a próxima data crítica" notificam a data do motor', async () => {
    const { result, byId } = demo();
    const onSelect = vi.fn();
    render(<RiskCalendar baseDate="2026-11-11" openingCents={300000n} points={result.points} entriesById={byId} selectedDate="2026-11-20" onSelectDate={onSelect} firstRiskDate="2026-11-12" />);
    await userEvent.click(screen.getByRole('button', { name: /13\/11\/2026, saldo R\$ 1\.300,00/ }));
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-13');
    await userEvent.click(screen.getByRole('button', { name: /ir para a próxima data crítica/i }));
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-12');
    expect(screen.getByText('Nenhum lançamento neste dia.')).toBeInTheDocument();
  });

  it('sem risco não oferece o atalho; sem pontos mostra estado vazio', () => {
    const { result, byId } = demo();
    const { rerender } = render(<RiskCalendar baseDate="2026-11-11" openingCents={300000n} points={result.points} entriesById={byId} selectedDate={null} onSelectDate={() => {}} firstRiskDate={null} />);
    expect(screen.queryByRole('button', { name: /próxima data crítica/i })).toBeNull();
    rerender(<RiskCalendar baseDate="2026-11-11" openingCents={300000n} points={[]} entriesById={byId} selectedDate={null} onSelectDate={() => {}} firstRiskDate={null} />);
    expect(screen.getByText(/sem dados para exibir/i)).toBeInTheDocument();
  });

  it('a data-base é destacada e clicável e mostra o saldo INFORMADO (não projetado)', async () => {
    const { result, byId } = demo();
    const onSelect = vi.fn();
    const { rerender } = render(
      <RiskCalendar baseDate="2026-11-11" openingCents={300000n} points={result.points} entriesById={byId} selectedDate="2026-11-14" onSelectDate={onSelect} firstRiskDate="2026-11-12" />,
    );
    const base = screen.getByRole('button', { name: /^11\/11\/2026, data-base, saldo informado R\$ 3\.000,00/ });
    expect(base).toBeEnabled();
    expect(base).toHaveTextContent('base');
    // dias anteriores à data-base continuam inativos
    expect(screen.queryByRole('button', { name: /^10\/11\/2026/ })).toBeNull();
    await userEvent.click(base);
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-11');
    rerender(<RiskCalendar baseDate="2026-11-11" openingCents={300000n} points={result.points} entriesById={byId} selectedDate="2026-11-11" onSelectDate={onSelect} firstRiskDate="2026-11-12" />);
    expect(screen.getByText('Data-base')).toBeInTheDocument();
    expect(screen.getByText(/Saldo informado ao fim do dia:/)).toHaveTextContent('R$ 3.000,00');
    expect(screen.getByText(/conferido por você, não projetado/)).toBeInTheDocument();
    expect(screen.getByText(/projeção começa no dia seguinte/i)).toBeInTheDocument();
    expect(screen.queryByText(/faltam R\$/)).toBeNull();
  });

  it('data-base no último dia do mês: o mês da data-base continua navegável', () => {
    const settings = { baseDate: '2026-11-30', openingBalanceCents: '100000', minimumBalanceCents: '0' };
    const result = project(settings, []);
    render(<RiskCalendar baseDate="2026-11-30" openingCents={100000n} points={result.points} entriesById={new Map()} selectedDate={null} onSelectDate={() => {}} firstRiskDate={null} />);
    expect(screen.getByRole('button', { name: /^30\/11\/2026, data-base/ })).toBeInTheDocument();
  });
});
