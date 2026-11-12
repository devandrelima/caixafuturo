import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { projectWeekly } from '../../domain/finance/weekly';
import type { CashEntry, CashSettings } from '../../domain/finance/types';
import { WeeklyView } from '../WeeklyView';

const e = (id: string, direction: 'in' | 'out', cents: number, dueDate: string): CashEntry => ({
  id,
  direction,
  amountCents: String(cents),
  dueDate,
  description: `Conta ${id}`,
  category: '',
  origin: 'manual',
  sourceKey: `k:${id}`,
  state: 'scheduled',
});

// Mesmo fixture calculado à mão do domínio (weekly.test.ts): data-base quinta 12/11/2026.
const settings: CashSettings = { baseDate: '2026-11-12', openingBalanceCents: '500000', minimumBalanceCents: '100000' };
const entries = [
  e('a', 'out', 30000, '2026-11-13'),
  e('b', 'in', 100000, '2026-11-14'),
  e('c', 'out', 20000, '2026-11-16'),
  e('d', 'in', 50000, '2026-11-19'),
  e('e', 'out', 20000, '2026-11-22'),
  e('f', 'out', 150000, '2026-11-30'),
  e('g', 'out', 700000, '2026-12-31'),
  e('h', 'in', 800000, '2027-01-01'),
  e('j', 'in', 999999, '2027-02-08'), // fora do horizonte
];
const { weekly } = projectWeekly(settings, entries);
const byId = new Map(entries.map((x) => [x.id, x] as const));

describe('WeeklyView', () => {
  it('mostra 13 semanas, a 1ª parcial, e os saldos do motor (sem fórmula própria)', () => {
    render(<WeeklyView weekly={weekly} entriesById={byId} />);
    const table = screen.getByRole('table', { name: 'Fluxo de caixa por semana' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(13);
    expect(rows[0]).toHaveTextContent('1ª · 13/11 a 15/11');
    expect(rows[0]).toHaveTextContent('parcial: 3 dias');
    expect(rows[0]).toHaveTextContent('R$ 1.000,00'); // entradas
    expect(rows[0]).toHaveTextContent('R$ 300,00'); // saídas
    expect(rows[0]).toHaveTextContent('R$ 5.700,00'); // saldo final
    expect(rows[7]).toHaveTextContent('8ª · 28/12 a 03/01');
    expect(rows[7]).toHaveTextContent('R$ 5.300,00');
    expect(rows[12]).toHaveTextContent('13ª · 01/02 a 07/02');
  });

  it('semana que fecha positiva mas passou negativa mostra o alerta em TEXTO com data e valor (não esconde)', () => {
    render(<WeeklyView weekly={weekly} entriesById={byId} />);
    const row8 = screen.getByRole('table', { name: 'Fluxo de caixa por semana' }).querySelector('[data-week="8"]') as HTMLElement;
    expect(row8).toHaveTextContent('Saldo negativo em 31/12: -R$ 2.700,00');
    expect(row8).toHaveTextContent('R$ 5.300,00');
    expect(screen.getByRole('alert')).toHaveTextContent(/o saldo fica negativo na semana 8/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/mesmo que a semana feche positiva/i);
  });

  it('exibe a ressalva de incerteza e as premissas (sem previsão de faturamento nem hipótese)', () => {
    render(<WeeklyView weekly={weekly} entriesById={byId} />);
    expect(screen.getByText(/a incerteza cresce com o horizonte/i)).toBeInTheDocument();
    expect(screen.getByText(/recorrências calculadas pela regra/i)).toBeInTheDocument();
    expect(screen.getByText(/repasses derivados das vendas/i)).toBeInTheDocument();
    expect(screen.getByText(/nunca entram previsão de faturamento nem hipóteses manuais/i)).toBeInTheDocument();
  });

  it('lançamento fora do horizonte fica fora das semanas e é avisado', () => {
    render(<WeeklyView weekly={weekly} entriesById={byId} />);
    expect(screen.getByText(/1 lançamento\(s\) agendado\(s\) vence\(m\) depois da 13ª semana/i)).toBeInTheDocument();
    expect(screen.queryByText(/Conta j/)).toBeNull();
  });

  it('detalhe de cada semana lista os lançamentos com origem e chave, e a conta fecha', async () => {
    const user = userEvent.setup();
    render(<WeeklyView weekly={weekly} entriesById={byId} />);
    const details = document.querySelector('[data-week-detail="8"]') as HTMLDetailsElement;
    const summary = within(details).getByText(/8ª semana · 28\/12 a 03\/01 · 2 lançamentos/);
    await user.click(summary); // o teclado em <details> é nativo do navegador: verificado no Chromium (E2E), não em jsdom
    expect(details.open).toBe(true);
    expect(details).toHaveTextContent('Abertura R$ 4.300,00 + entradas R$ 8.000,00 − saídas R$ 7.000,00 = saldo final R$ 5.300,00');
    const items = within(details).getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('data-entry-id'))).toEqual(['g', 'h']);
    expect(items[0]).toHaveTextContent('31/12/2026 · Pagar R$ 7.000,00 · Conta g (Manual, k:g)');
  });

  it('semana sem lançamentos explica que o saldo se mantém', () => {
    render(<WeeklyView weekly={weekly} entriesById={byId} />);
    expect(within(document.querySelector('[data-week-detail="3"]') as HTMLElement).getByText(/saldo se mantém/i)).toBeInTheDocument();
  });

  it('sem alerta algum: mostra o aviso positivo com as premissas', () => {
    const calm = projectWeekly({ ...settings, openingBalanceCents: '5000000' }, [e('x', 'out', 1000, '2026-12-01')]);
    render(<WeeklyView weekly={calm.weekly} entriesById={new Map()} />);
    expect(screen.getByText(/sem alerta nas 13 semanas/i)).toBeInTheDocument();
  });

  it('só abaixo do mínimo: alerta de aviso (não negativo)', () => {
    const tight = projectWeekly({ ...settings, openingBalanceCents: '150000' }, [e('x', 'out', 100000, '2026-12-01')]);
    render(<WeeklyView weekly={tight.weekly} entriesById={new Map()} />);
    expect(screen.getByText(/o saldo fica abaixo do mínimo na semana/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sem semanas: estado vazio', () => {
    render(<WeeklyView weekly={{ ...weekly, weeks: [] }} entriesById={new Map()} />);
    expect(screen.getByText(/sem dados para exibir/i)).toBeInTheDocument();
  });
});
