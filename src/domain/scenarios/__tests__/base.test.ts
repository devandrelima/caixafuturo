import { describe, expect, it } from 'vitest';
import { createSalesDemo } from '../../../demo/salesDemo';
import { createRestaurantDemo } from '../../../demo/restaurant';
import { project } from '../../finance/projection';
import type { CashEntry } from '../../finance/types';
import { reconcile } from '../../sales/reconcile';
import { DEFAULT_SETTLEMENT_RULES, netOf } from '../../sales/settlement';
import { buildScenarioBase } from '../base';
import { simulate } from '../engine';
import { describeAdjustment, parsePercentBps } from '../inputs';
import type { Adjustment } from '../types';

const demo = createRestaurantDemo();
const sales = createSalesDemo().sales;
const rec = () => reconcile({ baseDate: demo.settings.baseDate, sales, rules: DEFAULT_SETTLEMENT_RULES, entries: demo.entries, decisions: [] });

describe('buildScenarioBase com a demonstração fictícia (restaurante + vendas)', () => {
  const r = rec();
  const base = buildScenarioBase({ settings: demo.settings, entries: r.projectionEntries, receivables: r.receivables, rules: DEFAULT_SETTLEMENT_RULES });

  it('a base projeta exatamente o mesmo que o app (mesmas entradas, mesmo project())', () => {
    const app = project(demo.settings, r.projectionEntries);
    const viaBase = simulate(base, []).baseProjection;
    expect(viaBase.points.map((p) => p.closingCents)).toEqual(app.points.map((p) => p.closingCents));
    expect(viaBase.summary.endingCents).toBe(app.summary.endingCents);
  });

  it('só repasses derivados que contam viram base de venda, e cada um tem bruto e custo corretos', () => {
    const derived = r.projectionEntries.filter((e: CashEntry) => e.origin === 'sale');
    expect(derived.length).toBeGreaterThan(0);
    expect(base.saleBasis.map((b) => b.entryId).sort()).toEqual(derived.map((e) => e.id).sort());
    for (const b of base.saleBasis) {
      const view = r.receivables.find((v) => v.receivable.id === b.entryId);
      const method = view?.receivable.method as keyof typeof DEFAULT_SETTLEMENT_RULES;
      expect(b.costBps).toBe(DEFAULT_SETTLEMENT_RULES[method].feeBps + DEFAULT_SETTLEMENT_RULES[method].commissionBps);
    }
  });

  it('o bruto/custo é coerente com o líquido já no caixa: 100% do bruto não muda nenhum repasse', () => {
    const run = simulate(base, [{ id: 's', kind: 'scale_sales', from: '2026-11-12', to: '2026-12-11', change: { mode: 'factor', factorBps: 10_000 } }]);
    expect(run.effects[0]?.status).toBe('ignored');
    expect(run.deltaByDate.every((d) => d.deltaCents === 0n)).toBe(true);
  });

  it('50% do bruto: o total recebido na alternativa é a soma exata de (bruto/2 meio-sobe − taxa) dos repasses, mais o restante igual', () => {
    const run = simulate(base, [{ id: 's', kind: 'scale_sales', from: '2026-11-12', to: '2026-12-11', change: { mode: 'factor', factorBps: 5000 } }]);
    let expected = 0n;
    for (const e of base.entries.filter((x) => x.direction === 'in' && x.state === 'scheduled' && x.dueDate > '2026-11-11' && x.dueDate <= '2026-12-11')) {
      const b = base.saleBasis.find((x) => x.entryId === e.id);
      if (!b) {
        expected += BigInt(e.amountCents);
        continue;
      }
      const half = (BigInt(b.grossCents) * 5000n * 2n + 10_000n) / 20_000n;
      expected += netOf(half, { method: 'pix', feeBps: b.costBps, commissionBps: 0, lagDays: 0 }).netCents;
    }
    expect(base.saleBasis.length).toBeGreaterThan(0);
    expect(run.alternativeProjection.points.reduce((sum, p) => sum + p.incomingCents, 0n)).toBe(expected);
  });

  it('a simulação não altera a base nem os lançamentos de origem', () => {
    const before = JSON.stringify(r.projectionEntries);
    simulate(base, [{ id: 'd', kind: 'delay_receipt', entryId: 'demo-receita-02', days: 2 }]);
    expect(JSON.stringify(r.projectionEntries)).toBe(before);
  });
});

describe('parsePercentBps', () => {
  it.each([
    ['80', 8000],
    ['80,5', 8050],
    ['80,05', 8005],
    ['120,25%', 12025],
    [' 100 ', 10000],
    ['0', 0],
    ['1000', 100000],
  ])('%s → %s bps', (text, bps) => {
    expect(parsePercentBps(text)).toEqual({ ok: true, bps });
  });
  it.each([['80.5'], ['abc'], [''], ['-5'], ['1001'], ['80,555'], ['1000,01']])('%s é inválido', (text) => {
    expect(parsePercentBps(text).ok).toBe(false);
  });
});

describe('describeAdjustment', () => {
  const entries = new Map(demo.entries.map((e) => [e.id, e]));
  it('descreve atraso, choque de vendas e de despesas em texto', () => {
    const a: Adjustment[] = [
      { id: '1', kind: 'delay_receipt', entryId: 'demo-receita-02', days: 2 },
      { id: '2', kind: 'delay_receipt', entryId: 'demo-receita-02', days: 1 },
      { id: '3', kind: 'scale_sales', from: '2026-11-12', to: '2026-11-20', change: { mode: 'factor', factorBps: 8000 } },
      { id: '4', kind: 'scale_expense', from: '2026-11-12', to: '2026-11-20', category: 'Aluguel', change: { mode: 'factor', factorBps: 11000 } },
      { id: '5', kind: 'scale_expense', from: '2026-11-12', to: '2026-11-20', category: '', change: { mode: 'factor', factorBps: 5000 } },
      { id: '6', kind: 'scale_expense', from: '2026-11-12', to: '2026-11-20', change: { mode: 'amount', deltaCents: '500' } },
      { id: '7', kind: 'hiring' },
    ];
    expect(a.map((x) => describeAdjustment(x, entries))).toEqual([
      'Atrasar "Recebimento agendado fictício" (R$ 4.000,00, 15/11/2026) em 2 dias',
      'Atrasar "Recebimento agendado fictício" (R$ 4.000,00, 15/11/2026) em 1 dia',
      'Repasses de vendas de 12/11/2026 a 20/11/2026 ficam em 80%',
      'Despesas de "Aluguel" de 12/11/2026 a 20/11/2026 ficam em 110%',
      'Despesas de "Sem categoria" de 12/11/2026 a 20/11/2026 ficam em 50%',
      'Despesas de 12/11/2026 a 20/11/2026 variam R$ 5,00 por lançamento',
      'Ajuste 7',
    ]);
  });
});
