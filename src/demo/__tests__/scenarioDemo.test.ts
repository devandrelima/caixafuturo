import { describe, expect, it } from 'vitest';
import { createRestaurantDemo } from '../restaurant';
import { project } from '../../domain/finance/projection';
import { simulate } from '../../domain/scenarios/engine';
import type { Adjustment } from '../../domain/scenarios/types';
import { createScenarioDemoBase, createScenarioDemoEntries, SCENARIO_DEMO_SETTINGS } from '../scenarioDemo';

const close = (r: { points: { date: string; closingCents: bigint }[] }, date: string) => r.points.find((p) => p.date === date)?.closingCents;
const dates = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];

describe('base fictícia do simulador (valores calculados à mão)', () => {
  const base = createScenarioDemoBase();

  it('Original: 3.000,00 · 800,00 · 2.600,00 · 2.600,00 · 3.560,10 · 2.060,10 · 3.980,30 · 3.980,30 · 3.180,30', () => {
    const r = simulate(base, []);
    expect(dates.map((d) => close(r.baseProjection, d))).toEqual([300_000n, 80_000n, 260_000n, 260_000n, 356_010n, 206_010n, 398_030n, 398_030n, 318_030n]);
    expect(r.baseProjection.summary.firstRisk?.date).toBe('2026-11-13'); // 800,00 < mínimo 1.000,00
    expect(r.baseProjection.summary.firstNegative).toBeNull();
    expect(r.baseProjection.summary.endingCents).toBe(318_030n);
  });

  it('atraso de 3 dias na conta de R$ 1.800,00 (14/11 → 17/11): diferença −1.800,00 em 14, 15 e 16/11 e zero depois', () => {
    const r = simulate(base, [{ id: 'a', kind: 'delay_receipt', entryId: 'cen-conta-01', days: 3 }]);
    expect(dates.map((d) => close(r.alternativeProjection, d))).toEqual([300_000n, 80_000n, 80_000n, 80_000n, 176_010n, 206_010n, 398_030n, 398_030n, 318_030n]);
    expect(dates.map((d) => r.deltaByDate.find((x) => x.date === d)?.deltaCents)).toEqual([0n, 0n, -180_000n, -180_000n, -180_000n, 0n, 0n, 0n, 0n]);
    expect(r.riskDiff.newRiskDates).toEqual(['2026-11-14', '2026-11-15']);
    expect(r.riskDiff.resolvedRiskDates).toEqual([]);
  });

  it('despesas de Fornecedores a 110%: −220,00 em 13/11 (R$ 2.200 → 2.420) e −300,00 a partir de 20/11 (R$ 800 → 880)', () => {
    const r = simulate(base, [{ id: 'f', kind: 'scale_expense', from: '2026-11-12', to: '2026-11-30', category: 'Fornecedores', change: { mode: 'factor', factorBps: 11_000 } }]);
    expect(dates.map((d) => r.deltaByDate.find((x) => x.date === d)?.deltaCents)).toEqual([0n, -22_000n, -22_000n, -22_000n, -22_000n, -22_000n, -22_000n, -22_000n, -30_000n]);
  });

  it('vendas a 70% do bruto: repasses R$ 960,10 → 672,07 e R$ 1.920,20 → 1.344,14 (diferença −288,03 em 16/11 e −864,09 a partir de 18/11)', () => {
    const r = simulate(base, [{ id: 'v', kind: 'scale_sales', from: '2026-11-12', to: '2026-11-30', change: { mode: 'factor', factorBps: 7000 } }]);
    // 2.000,00 × 70% = 1.400,00; custo 3,99% = 55,86; líquido 1.344,14 (perda 576,06). 1.000,00 × 70%: custo 27,93 → 672,07 (perda 288,03)
    expect(dates.map((d) => r.deltaByDate.find((x) => x.date === d)?.deltaCents)).toEqual([0n, 0n, 0n, 0n, -28_803n, -28_803n, -86_409n, -86_409n, -86_409n]);
  });

  it('combinar as três hipóteses soma efeitos independentes (não há sobreposição entre elas)', () => {
    const adjustments: Adjustment[] = [
      { id: 'a', kind: 'delay_receipt', entryId: 'cen-conta-01', days: 3 },
      { id: 'f', kind: 'scale_expense', from: '2026-11-12', to: '2026-11-30', category: 'Fornecedores', change: { mode: 'factor', factorBps: 11_000 } },
      { id: 'v', kind: 'scale_sales', from: '2026-11-12', to: '2026-11-30', change: { mode: 'factor', factorBps: 7000 } },
    ];
    const r = simulate(base, adjustments);
    // 16/11: −1.800,00 (atraso) −220,00 (fornecedor 13/11) −288,03 (repasse 1) = −2.308,03
    expect(r.deltaByDate.find((x) => x.date === '2026-11-16')?.deltaCents).toBe(-230_803n);
    // 20/11 (tudo já aplicado): −220,00 −80,00 −288,03 −576,06 = −1.164,09; o atraso já foi recuperado em 17/11
    expect(r.deltaByDate.find((x) => x.date === '2026-11-20')?.deltaCents).toBe(-116_409n);
    expect(r.effects.every((x) => x.status === 'applied')).toBe(true);
  });

  it('a fixture não interfere nos demos anteriores (S01 segue 500 · 1.300 · −700 · 3.300)', () => {
    const s01 = createRestaurantDemo();
    const r = project(s01.settings, s01.entries);
    expect(r.points.slice(0, 4).map((p) => p.closingCents)).toEqual([50_000n, 130_000n, -70_000n, 330_000n]);
    expect(SCENARIO_DEMO_SETTINGS.baseDate).toBe(s01.settings.baseDate);
    expect(createScenarioDemoEntries().every((x) => x.id.startsWith('cen-'))).toBe(true);
  });
});
