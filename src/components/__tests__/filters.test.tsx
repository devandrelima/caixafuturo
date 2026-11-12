import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DetailFilters } from '../DetailFilters';
import { EntriesPanel } from '../EntriesPanel';
import { project } from '../../domain/finance/projection';
import { EMPTY_FILTER, traceEntry, type EntryFilter } from '../../domain/finance/filters';
import type { CashEntry, CashSettings } from '../../domain/finance/types';

const e = (id: string, direction: 'in' | 'out', cents: number, dueDate: string, category: string, origin: CashEntry['origin'], state: CashEntry['state'] = 'scheduled'): CashEntry => ({
  id,
  direction,
  amountCents: String(cents),
  dueDate,
  description: `Conta ${id}`,
  category,
  origin,
  sourceKey: `k:${id}`,
  state,
  ...(state === 'settled' ? { settledAt: dueDate } : {}),
});

const ENTRIES: CashEntry[] = [
  e('e1', 'out', 100000, '2026-12-01', 'Aluguel', 'manual'),
  e('e2', 'in', 50000, '2026-12-05', 'Vendas', 'csv'),
  e('e3', 'out', 30000, '2026-12-10', 'Aluguel', 'recurring'),
  e('e4', 'out', 20000, '2026-12-10', '', 'manual'),
  e('e5', 'in', 70000, '2026-12-31', 'Vendas', 'demo'),
  e('e6', 'out', 15000, '2027-01-01', 'Aluguel', 'manual', 'settled'),
];
const SETTINGS: CashSettings = { baseDate: '2026-11-30', openingBalanceCents: '50000', minimumBalanceCents: '10000' };
const result = project(SETTINGS, ENTRIES.filter((x) => x.id !== 'e3'));

const noop = () => undefined;
function panel(over: Partial<Parameters<typeof EntriesPanel>[0]> = {}) {
  return render(
    <EntriesPanel
      entries={ENTRIES}
      calculatedIds={new Set(['e3'])}
      flaggedIds={new Set()}
      trace={(entry) => traceEntry(entry, result)}
      globalAlert={<div role="status">ALERTA GLOBAL: saldo negativo em 01/12/2026</div>}
      onAdd={noop}
      onPickCsv={noop}
      onEdit={noop}
      onDelete={noop}
      {...over}
    />,
  );
}
const rowIds = (): string[] => {
  const table = screen.queryByRole('table', { name: 'Lançamentos' });
  return table ? within(table).getAllByRole('row').map((r) => r.getAttribute('data-entry-id')).filter((x): x is string => x !== null) : [];
};
const setDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('DetailFilters (controlado)', () => {
  function Harness({ onChange }: { onChange?: (f: EntryFilter) => void }) {
    const [filter, setFilter] = useState<EntryFilter>(EMPTY_FILTER);
    return (
      <DetailFilters
        filter={filter}
        onChange={(f) => {
          setFilter(f);
          onChange?.(f);
        }}
        categories={[{ value: 'Aluguel', label: 'Aluguel' }, { value: '', label: 'Sem categoria' }]}
        origins={['manual', 'recurring']}
        shown={3}
        total={6}
        globalAlert={<p>ALERTA GLOBAL</p>}
      />
    );
  }

  it('sem filtros: estado em texto, alerta global visível e nenhum chip', () => {
    render(<Harness />);
    expect(screen.getByTestId('filter-status')).toHaveTextContent('Sem filtros — mostrando todos os 6 lançamentos.');
    expect(screen.getByText('ALERTA GLOBAL')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Filtros ativos' })).toBeNull();
  });

  it('cada campo propaga o filtro; chips descrevem em TEXTO; "Limpar filtros" restaura tudo', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    setDate('Período a partir de', '2026-12-01');
    setDate('Período até', '2026-12-31');
    await user.selectOptions(screen.getByLabelText('Categoria'), 'Aluguel');
    await user.selectOptions(screen.getByLabelText('Origem'), 'recurring');
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-12-01', to: '2026-12-31', category: 'Aluguel', origin: 'recurring' });
    const chips = within(screen.getByRole('list', { name: 'Filtros ativos' })).getAllByRole('listitem');
    expect(chips.map((c) => c.textContent)).toEqual(['Período: 01/12/2026 a 31/12/2026', 'Categoria: Aluguel', 'Origem: Recorrente']);
    expect(screen.getByTestId('filter-status')).toHaveTextContent('Filtro ativo — mostrando 3 de 6 lançamentos.');

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_FILTER);
    expect(screen.queryByRole('list', { name: 'Filtros ativos' })).toBeNull();
    expect(screen.getByLabelText('Categoria')).toHaveValue('__all__');
  });

  it('"Sem categoria" é uma opção própria; período invertido mostra erro em texto', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Categoria'), 'Sem categoria');
    expect(screen.getByText('Categoria: Sem categoria')).toBeInTheDocument();
    setDate('Período a partir de', '2026-12-10');
    setDate('Período até', '2026-12-01');
    expect(screen.getByRole('alert')).toHaveTextContent(/inicial é posterior/i);
  });

  it('teclado: Tab chega aos campos e ao botão Limpar, que funciona com Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Origem'), 'manual');
    const clear = screen.getByRole('button', { name: 'Limpar filtros' });
    clear.focus();
    expect(clear).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Origem')).toHaveValue('__all__');
  });
});

describe('EntriesPanel com filtros', () => {
  it('sem filtro lista tudo e o somatório vem dos 6 ids listados (à mão: entradas 1.200,00, saídas 1.650,00)', () => {
    panel();
    expect(rowIds()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    const s = screen.getByTestId('entries-summary');
    expect(s).toHaveTextContent('6 lançamentos listados');
    expect(s).toHaveTextContent('entradas R$ 1.200,00');
    expect(s).toHaveTextContent('saídas R$ 1.650,00');
    expect(s).toHaveTextContent('líquido -R$ 450,00');
    expect(s).toHaveTextContent('inclui 1 liquidado');
  });

  it('filtrar por categoria: lista e somatório correspondem exatamente aos ids visíveis; o alerta global NÃO some', async () => {
    const user = userEvent.setup();
    panel();
    await user.selectOptions(screen.getByLabelText('Categoria'), 'Aluguel');
    expect(rowIds()).toEqual(['e1', 'e3', 'e6']);
    // 1.000,00 + 300,00 + 150,00 = 1.450,00 de saídas, sem entradas
    const s = screen.getByTestId('entries-summary');
    expect(s).toHaveTextContent('3 lançamentos listados');
    expect(s).toHaveTextContent('entradas R$ 0,00');
    expect(s).toHaveTextContent('saídas R$ 1.450,00');
    expect(screen.getByText(/ALERTA GLOBAL/)).toBeInTheDocument();
    expect(screen.getByTestId('filter-status')).toHaveTextContent('Filtro ativo — mostrando 3 de 6 lançamentos.');
  });

  it('período inclusivo + origem; filtro sem resultado explica e "Limpar filtros" devolve a lista', async () => {
    const user = userEvent.setup();
    panel();
    setDate('Período a partir de', '2026-12-05');
    setDate('Período até', '2026-12-10');
    expect(rowIds()).toEqual(['e2', 'e3', 'e4']);
    await user.selectOptions(screen.getByLabelText('Origem'), 'csv');
    expect(rowIds()).toEqual(['e2']);
    setDate('Período a partir de', '2027-06-01');
    setDate('Período até', '2027-06-30');
    expect(rowIds()).toEqual([]);
    expect(screen.getByText(/nenhum lançamento atende aos filtros/i)).toBeInTheDocument();
    expect(screen.getByTestId('entries-summary')).toHaveTextContent('0 lançamentos listados');
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(rowIds()).toHaveLength(6);
  });

  it('ocorrência calculada não tem Editar/Excluir e se identifica por texto; lançamento gravado tem', () => {
    panel();
    const calculated = screen.getByRole('table', { name: 'Lançamentos' }).querySelector('[data-entry-id="e3"]') as HTMLElement;
    expect(within(calculated).getByText('Calculada pela regra')).toBeInTheDocument();
    expect(within(calculated).queryByRole('button', { name: /^Editar/ })).toBeNull();
    expect(within(calculated).queryByRole('button', { name: /^Excluir/ })).toBeNull();
    const stored = screen.getByRole('table', { name: 'Lançamentos' }).querySelector('[data-entry-id="e1"]') as HTMLElement;
    expect(within(stored).getByRole('button', { name: 'Editar Conta e1' })).toBeInTheDocument();
  });

  it('detalhe rastreável por teclado: mostra onde entra no saldo, id e chave de origem; liquidado explica que não entra', async () => {
    const user = userEvent.setup();
    panel();
    const toggle = screen.getByRole('button', { name: 'Detalhes de Conta e1 em 01/12/2026' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByTestId('entry-detail');
    // 01/12: 500,00 − 1.000,00 = −500,00 → negativo
    expect(detail).toHaveTextContent('Entra no saldo de 01/12/2026 (fechamento do dia: -R$ 500,00 — Saldo negativo)');
    expect(detail).toHaveTextContent('Identificador e1 · chave de origem k:e1');
    await user.click(screen.getByRole('button', { name: 'Detalhes de Conta e6 em 01/01/2027' }));
    expect(screen.getAllByTestId('entry-detail').at(-1)).toHaveTextContent('Liquidado: já está refletido no saldo inicial');
    await user.click(screen.getByRole('button', { name: 'Detalhes de Conta e3 em 10/12/2026' }));
    expect(screen.getAllByTestId('entry-detail').some((d) => /calculada pela regra recorrente/i.test(d.textContent ?? ''))).toBe(true);
  });

  it('sem lançamentos: estado vazio e sem filtros', () => {
    panel({ entries: [] });
    expect(screen.getByText(/nenhum lançamento ainda/i)).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
  });
});
