import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../../finance/dates';
import type { CashEntry, CashSettings } from '../../finance/types';
import { createBaseSnapshot, simulate } from '../engine';
import { ScenarioError } from '../types';
import type { Adjustment, BaseSnapshot, ShiftVendorDueAdjustment } from '../types';

const settings: CashSettings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };
const entry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string, extra: Partial<CashEntry> = {}): CashEntry => ({ id, direction, amountCents, dueDate, description: `L ${id}`, category: '', origin: 'manual', sourceKey: `manual:${id}`, state: 'scheduled', ...extra });
// Demo S01 (à mão): 12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 · 15/11 R$ 3.300.
const demo = (): CashEntry[] => [entry('demo-despesa-01', 'out', '250000', '2026-11-12'), entry('demo-receita-01', 'in', '80000', '2026-11-13'), entry('demo-despesa-02', 'out', '200000', '2026-11-14'), entry('demo-receita-02', 'in', '400000', '2026-11-15')];
const snap = (entries: CashEntry[] = demo(), horizonDays = 30): BaseSnapshot => createBaseSnapshot({ settings, entries, horizonDays });
const shift = (entryId: string, newDate: string, id = 's1'): ShiftVendorDueAdjustment => ({ id, kind: 'shift_vendor_due', entryId, newDate });
const closes = (r: { points: { closingCents: bigint }[] }) => r.points.map((p) => p.closingCents);
const closing = (r: { points: { date: string; closingCents: bigint }[] }, date: string) => r.points.find((p) => p.date === date)?.closingCents;

describe('shift_vendor_due — adiar o vencimento de uma saída (só a data muda)', () => {
  it('Aluguel R$ 2.000 de 14/11 para 21/11: 14/11 vai de −R$ 700 para R$ 1.300 (à mão) e o risco some; 21/11 volta a igualar a base', () => {
    const s = snap();
    const before = JSON.stringify(s);
    const r = simulate(s, [shift('demo-despesa-02', '2026-11-21')]);
    expect(closing(r.baseProjection, '2026-11-14')).toBe(-70_000n);
    expect(closing(r.alternativeProjection, '2026-11-14')).toBe(130_000n);
    expect(closing(r.alternativeProjection, '2026-11-15')).toBe(530_000n);
    expect(closing(r.alternativeProjection, '2026-11-20')).toBe(530_000n);
    expect(closing(r.alternativeProjection, '2026-11-21')).toBe(330_000n); // a saída chega em 21/11: o saldo volta ao da base
    expect(r.deltaByDate.slice(2, 10).map((d) => d.deltaCents)).toEqual([200_000n, 200_000n, 200_000n, 200_000n, 200_000n, 200_000n, 200_000n, 0n]);
    expect(r.riskDiff.resolvedRiskDates).toEqual(['2026-11-14']);
    expect(r.riskDiff.newRiskDates).toEqual([]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('só a DATA muda: valor igual, mesmo lançamento (id), nenhuma criação nem retirada; a trilha guarda a data original', () => {
    const r = simulate(snap(), [shift('demo-despesa-02', '2026-11-21')]);
    expect(r.effects[0]?.status).toBe('applied');
    expect(r.effects[0]?.changes).toEqual([{ entryId: 'demo-despesa-02', description: 'L demo-despesa-02', field: 'dueDate', from: '2026-11-14', to: '2026-11-21' }]);
    expect(r.effects[0]?.changedEntryIds).toEqual(['demo-despesa-02']);
    expect(r.createdEntries).toEqual([]);
    expect(r.removedEntryIds).toEqual([]);
    expect(r.alternativeProjection.summary.totalOutgoingCents).toBe(r.baseProjection.summary.totalOutgoingCents); // mesma soma de saídas
    expect(r.alternativeProjection.points.find((p) => p.date === '2026-11-21')?.entryIds).toEqual(['demo-despesa-02']);
  });

  it('o texto mostra a trilha "de 14/11/2026 para 21/11/2026", o valor mantido e que nada é renegociado', () => {
    const text = simulate(snap(), [shift('demo-despesa-02', '2026-11-21')]).assumptions.join(' ');
    expect(text).toContain('de 14/11/2026 para 21/11/2026');
    expect(text).toContain('7 dias depois');
    expect(text).toContain('R$ 2.000,00');
    expect(text).toMatch(/só a data muda/);
    expect(text).toMatch(/Nada é renegociado, solicitado ou comunicado/);
    expect(text).toMatch(/juros e multas/);
    expect(text).not.toMatch(/\b(renegocie|pague|confirme|solicite)\b/i);
  });

  it('antecipar o pagamento (data anterior) também é permitido, piora o saldo e é dito: "1 dia antes"', () => {
    const r = simulate(snap(), [shift('demo-despesa-02', '2026-11-12')]);
    expect(closing(r.alternativeProjection, '2026-11-12')).toBe(-150_000n); // 3.000 − 2.500 − 2.000
    expect(closing(r.alternativeProjection, '2026-11-13')).toBe(-70_000n);
    expect(closing(r.alternativeProjection, '2026-11-14')).toBe(-70_000n);
    expect(closing(r.alternativeProjection, '2026-11-15')).toBe(330_000n);
    expect(r.assumptions.join(' ')).toContain('2 dias antes');
    expect(simulate(snap(), [shift('demo-despesa-02', '2026-11-13')]).assumptions.join(' ')).toContain('1 dia antes');
    expect(simulate(snap(), [shift('demo-despesa-02', '2026-11-15')]).assumptions.join(' ')).toContain('1 dia depois');
  });

  it('nova data depois do horizonte: o valor sai do saldo projetado e isso é dito (não some)', () => {
    const r = simulate(snap(), [shift('demo-despesa-02', '2026-12-20')]);
    expect(r.alternativeProjection.summary.beyondHorizon).toBe(1);
    expect(closing(r.alternativeProjection, '2026-12-11')).toBe(530_000n);
    const w = r.warnings.join(' ');
    expect(w).toContain('R$ 2.000,00');
    expect(w).toMatch(/20\/12\/2026.*depois do horizonte/);
  });

  it('o último dia do horizonte ainda conta (11/12); um dia depois fica de fora', () => {
    const on = simulate(snap(), [shift('demo-despesa-02', '2026-12-11')]);
    expect(on.alternativeProjection.summary.beyondHorizon).toBe(0);
    expect(closing(on.alternativeProjection, '2026-12-11')).toBe(330_000n);
    expect(on.warnings.join(' ')).not.toMatch(/depois do horizonte/);
    expect(simulate(snap(), [shift('demo-despesa-02', '2026-12-12')]).alternativeProjection.summary.beyondHorizon).toBe(1);
  });

  it('é ignorado com aviso, sem mudar nada: saída inexistente, entrada (recebível), liquidada, vencida até a data-base, mesma data, nova data até a data-base', () => {
    const entries = [...demo(), entry('liq', 'out', '5000', '2026-11-20', { state: 'settled', settledAt: '2026-11-10' }), entry('velha', 'out', '7000', '2026-11-11')];
    const run = (a: ShiftVendorDueAdjustment) => simulate(snap(entries), [a]);
    const cases: [ShiftVendorDueAdjustment, RegExp][] = [
      [shift('nao-existe', '2026-11-21'), /não existe na base/],
      [shift('demo-receita-02', '2026-11-21'), /não é uma saída/],
      [shift('liq', '2026-11-21'), /já foi liquidada/],
      [shift('velha', '2026-11-21'), /até a data-base/],
      [shift('demo-despesa-02', '2026-11-14'), /mesma data/],
      [shift('demo-despesa-02', '2026-11-11'), /nova data.*até a data-base/i],
      [shift('demo-despesa-02', '2026-11-10'), /nova data.*até a data-base/i],
    ];
    for (const [adj, re] of cases) {
      const r = run(adj);
      expect(r.effects[0]?.status, adj.entryId + adj.newDate).toBe('ignored');
      expect(r.warnings.join(' ')).toMatch(re);
      expect(closes(r.alternativeProjection)).toEqual(closes(r.baseProjection));
      expect(r.createdEntries).toEqual([]);
    }
  });

  it('entradas inválidas viram ScenarioError', () => {
    expect(() => simulate(snap(), [shift('', '2026-11-21')])).toThrow(ScenarioError);
    expect(() => simulate(snap(), [shift('  ', '2026-11-21')])).toThrow(ScenarioError);
    expect(() => simulate(snap(), [shift('demo-despesa-02', '2026-02-30')])).toThrow(/data/i);
    expect(() => simulate(snap(), [shift('demo-despesa-02', '')])).toThrow(ScenarioError);
  });

  it('conflito: dois ajustes de data no mesmo lançamento — o primeiro vence, o segundo é ignorado com aviso (sem soma dupla)', () => {
    const r = simulate(snap(), [shift('demo-despesa-02', '2026-11-21', 's1'), shift('demo-despesa-02', '2026-11-25', 's2')]);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(r.warnings.join(' ')).toMatch(/Ajuste s2 ignorado em demo-despesa-02 \(data\): já alterado por/);
    expect(closing(r.alternativeProjection, '2026-11-21')).toBe(330_000n);
    expect(r.alternativeProjection.points.flatMap((p) => p.entryIds).filter((id) => id === 'demo-despesa-02')).toHaveLength(1);
  });

  it('coexiste com choque de despesas (S05) no mesmo lançamento: data e valor são campos diferentes, cada um muda uma vez, a partir do original', () => {
    const adj: Adjustment[] = [shift('demo-despesa-02', '2026-11-21'), { id: 'x', kind: 'scale_expense', from: '2026-11-14', to: '2026-11-14', change: { mode: 'factor', factorBps: 11_000 } }];
    const r = simulate(snap(), adj);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'applied']);
    // 110% de R$ 2.000 = R$ 2.200, pago em 21/11 (o período do choque refere-se ao vencimento ORIGINAL, 14/11)
    expect(closing(r.alternativeProjection, '2026-11-20')).toBe(530_000n);
    expect(closing(r.alternativeProjection, '2026-11-21')).toBe(310_000n);
    expect(r.alternativeProjection.points.flatMap((p) => p.entryIds).filter((id) => id === 'demo-despesa-02')).toHaveLength(1);
  });

  it('PROPRIEDADE (300 casos determinísticos): adiar uma saída NUNCA piora nenhum dia (o oposto do atraso de recebível); antecipar NUNCA melhora; só a data muda', () => {
    let seed = 13_112_026;
    const next = (max: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % max;
    };
    for (let i = 0; i < 300; i += 1) {
      const entries: CashEntry[] = [];
      const n = 3 + next(8);
      for (let k = 0; k < n; k += 1) entries.push(entry(`e${k}`, next(3) === 0 ? 'in' : 'out', String(100 + next(900_000)), addDays('2026-11-11', 1 + next(40))));
      const outs = entries.filter((e) => e.direction === 'out');
      if (outs.length === 0) continue;
      const target = outs[next(outs.length)] as CashEntry;
      const s = snap(entries, 45);
      const later = addDays(target.dueDate, 1 + next(30));
      const span = daysBetween('2026-11-11', target.dueDate) - 1; // datas possíveis antes do vencimento: data-base+1 … vencimento−1
      const earlier = span >= 1 ? addDays('2026-11-11', 1 + next(span)) : null;
      const postponed = simulate(s, [shift(target.id, later)]);
      postponed.deltaByDate.forEach((d) => expect(d.deltaCents >= 0n).toBe(true));
      expect(postponed.effects[0]?.changes.every((c) => c.field === 'dueDate')).toBe(true);
      if (earlier !== null) {
        const anticipated = simulate(s, [shift(target.id, earlier)]);
        anticipated.deltaByDate.forEach((d) => expect(d.deltaCents <= 0n).toBe(true));
      }
    }
  });

  it('é determinístico e a base congelada não muda', () => {
    const s = snap();
    const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
    expect(json(simulate(s, [shift('demo-despesa-02', '2026-11-21')]))).toBe(json(simulate(s, [shift('demo-despesa-02', '2026-11-21')])));
    expect(Object.isFrozen(s.entries[0])).toBe(true);
  });
});
