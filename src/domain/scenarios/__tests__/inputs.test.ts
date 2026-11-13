import { describe, expect, it } from 'vitest';
import type { CashEntry } from '../../finance/types';
import { describeAdjustment, parseIntegerText, parsePercentBpsUpTo } from '../inputs';
import type { Adjustment } from '../types';

const entry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string, description: string): CashEntry => ({ id, direction, amountCents, dueDate, description, category: '', origin: 'manual', sourceKey: id, state: 'scheduled' });
const entries = new Map([entry('conta', 'out', '200000', '2026-11-14', 'Aluguel fictício'), entry('rec', 'in', '400000', '2026-11-15', 'Evento fictício')].map((e) => [e.id, e] as const));

describe('parsePercentBpsUpTo — percentual com vírgula, até 2 casas, com teto', () => {
  it('converte para basis points inteiros, sem ponto flutuante', () => {
    expect(parsePercentBpsUpTo('2,5', 2000)).toEqual({ ok: true, bps: 250 });
    expect(parsePercentBpsUpTo(' 1,25 % ', 2000)).toEqual({ ok: true, bps: 125 });
    expect(parsePercentBpsUpTo('0', 2000)).toEqual({ ok: true, bps: 0 });
    expect(parsePercentBpsUpTo('20', 2000)).toEqual({ ok: true, bps: 2000 });
    expect(parsePercentBpsUpTo('0,01', 2000)).toEqual({ ok: true, bps: 1 });
  });
  it('o teto é inclusivo: 20% passa, 20,01% não', () => {
    expect(parsePercentBpsUpTo('20,01', 2000)).toEqual({ ok: false, reason: 'O percentual máximo é 20%.' });
    expect(parsePercentBpsUpTo('21', 2000).ok).toBe(false);
  });
  it('recusa formato errado (ponto decimal, 3 casas, texto, vazio)', () => {
    for (const bad of ['2.5', '1,234', 'abc', '', '-1', '2,']) expect(parsePercentBpsUpTo(bad, 2000).ok, bad).toBe(false);
    expect(parsePercentBpsUpTo('x', 2000)).toEqual({ ok: false, reason: 'Informe um percentual como 80 ou 80,5 (use vírgula).' });
  });
});

describe('parseIntegerText — inteiro simples dentro de uma faixa', () => {
  it('aceita só dígitos dentro da faixa inclusiva', () => {
    expect(parseIntegerText('12', 1, 60)).toEqual({ ok: true, value: 12 });
    expect(parseIntegerText(' 1 ', 1, 60)).toEqual({ ok: true, value: 1 });
    expect(parseIntegerText('60', 1, 60)).toEqual({ ok: true, value: 60 });
  });
  it('recusa vazio, texto, decimal, negativo e fora da faixa', () => {
    for (const bad of ['', 'x', '1,5', '1.5', '-3', '0', '61']) expect(parseIntegerText(bad, 1, 60).ok, bad).toBe(false);
  });
});

describe('describeAdjustment — as quatro decisões da S06, em texto e sem verbo de execução', () => {
  const text = (a: Adjustment) => describeAdjustment(a, entries);
  it('equipamento: à vista, adiado e parcelado', () => {
    const base = { id: 'c', kind: 'equipment_purchase' as const, description: 'Forno', principalCents: '1000000' };
    expect(text({ ...base, payment: { mode: 'cash', date: '2026-11-20' } })).toBe('Hipótese de compra: "Forno" (R$ 10.000,00) à vista em 20/11/2026');
    expect(text({ ...base, payment: { mode: 'deferred', date: '2026-12-05', chargeBps: 200 } })).toBe('Hipótese de compra: "Forno" (R$ 10.000,00) adiada para 05/12/2026, com encargo único de 2%');
    expect(text({ ...base, payment: { mode: 'installments', firstDate: '2026-11-20', count: 3, monthlyRateBps: 200 } })).toBe('Hipótese de compra: "Forno" (R$ 10.000,00) em 3 parcelas a partir de 20/11/2026, juros de 2% ao mês');
  });
  it('contratação, com e sem encargos e data final', () => {
    expect(text({ id: 'h', kind: 'hiring', role: 'Auxiliar', monthlyCostCents: '200000', chargesBps: 7000, fixedMonthlyCents: '30000', payDay: 5, startDate: '2026-11-20' })).toBe(
      'Hipótese de contratação: "Auxiliar", R$ 2.000,00 por mês (encargos de 70% e custos fixos de R$ 300,00 informados), a partir de 20/11/2026, pagamento no dia 5',
    );
    expect(text({ id: 'h', kind: 'hiring', role: 'Auxiliar', monthlyCostCents: '200000', payDay: 31, startDate: '2026-11-20', endDate: '2027-01-31' })).toBe(
      'Hipótese de contratação: "Auxiliar", R$ 2.000,00 por mês (encargos e outros custos não informados), a partir de 20/11/2026 até 31/01/2027, pagamento no dia 31',
    );
  });
  it('vencimento de fornecedor mostra a trilha de → para a partir da base', () => {
    expect(text({ id: 's', kind: 'shift_vendor_due', entryId: 'conta', newDate: '2026-11-21' })).toBe('Hipótese de novo vencimento: "Aluguel fictício" (R$ 2.000,00) de 14/11/2026 para 21/11/2026');
    expect(text({ id: 's', kind: 'shift_vendor_due', entryId: 'x', newDate: '2026-11-21' })).toBe('Hipótese de novo vencimento: x para 21/11/2026');
  });
  it('antecipação mostra o recebível, a data e a taxa informada', () => {
    expect(text({ id: 'a', kind: 'advance_receivable', entryId: 'rec', advanceDate: '2026-11-13', rateBps: 100 })).toBe('Hipótese de antecipação: "Evento fictício" (R$ 4.000,00, 15/11/2026) para 13/11/2026, taxa informada de 1% ao mês');
    expect(text({ id: 'a', kind: 'advance_receivable', entryId: 'x', advanceDate: '2026-11-13', rateBps: 250 })).toBe('Hipótese de antecipação: x para 13/11/2026, taxa informada de 2,5% ao mês');
  });
  it('nenhum texto usa verbo de execução', () => {
    const all: Adjustment[] = [
      { id: '1', kind: 'equipment_purchase', description: 'Forno', principalCents: '1000', payment: { mode: 'cash', date: '2026-11-20' } },
      { id: '2', kind: 'hiring', role: 'Aux', monthlyCostCents: '1000', payDay: 5, startDate: '2026-11-20' },
      { id: '3', kind: 'shift_vendor_due', entryId: 'conta', newDate: '2026-11-21' },
      { id: '4', kind: 'advance_receivable', entryId: 'rec', advanceDate: '2026-11-13', rateBps: 100 },
    ];
    for (const a of all) expect(text(a)).not.toMatch(/\b(pagar|contratar|antecipar agora|confirmar|comprar agora|solicitar)\b/i);
  });
});
