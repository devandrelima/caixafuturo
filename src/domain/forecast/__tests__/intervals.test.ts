import { describe, expect, it } from 'vitest';
import {
  applyBand,
  LOWER_PERCENTILE_BPS,
  MIN_BAND_FOLDS,
  MIN_BAND_RESIDUALS,
  percentileNearestRank,
  residualBand,
  UPPER_PERCENTILE_BPS,
} from '../intervals';

/** Resíduos −14…+15 reais (30 valores), em centavos, embaralhados de forma determinística. */
const residuals30 = (): bigint[] => {
  const base = Array.from({ length: 30 }, (_, i) => BigInt((i - 14) * 100));
  return [...base.slice(15), ...base.slice(0, 15)];
};

describe('percentileNearestRank (posto mais próximo, inteiros)', () => {
  const sorted = [10n, 20n, 30n, 40n, 50n, 60n, 70n, 80n, 90n, 100n];

  it('p = 10% de 10 valores é o 1º; p = 90% é o 9º; p = 100% é o último', () => {
    expect(percentileNearestRank(sorted, 1000)).toBe(10n);
    expect(percentileNearestRank(sorted, 9000)).toBe(90n);
    expect(percentileNearestRank(sorted, 10_000)).toBe(100n);
  });

  it('arredonda o posto para cima: p = 25% de 10 valores ⇒ posto 3 (2,5 → 3)', () => {
    expect(percentileNearestRank(sorted, 2500)).toBe(30n);
  });

  it('p = 0% devolve o menor; lista vazia ou p inválido lança erro', () => {
    expect(percentileNearestRank(sorted, 0)).toBe(10n);
    expect(() => percentileNearestRank([], 5000)).toThrow(RangeError);
    expect(() => percentileNearestRank(sorted, 10_001)).toThrow(RangeError);
    expect(() => percentileNearestRank(sorted, -1)).toThrow(RangeError);
  });
});

describe('residualBand — só com resíduos suficientes', () => {
  it('parâmetros documentados: 10º e 90º percentis, mínimo de 28 resíduos e 4 dobras', () => {
    expect([LOWER_PERCENTILE_BPS, UPPER_PERCENTILE_BPS]).toEqual([1000, 9000]);
    expect([MIN_BAND_RESIDUALS, MIN_BAND_FOLDS]).toEqual([28, 4]);
  });

  it('30 resíduos em 5 dobras: posto 3 (−R$ 12,00) e posto 27 (+R$ 12,00)', () => {
    // ordenados: −1400, −1300, −1200, … , +1200 (27º), +1300, +1400, +1500
    const band = residualBand(residuals30(), 5);
    expect(band.status).toBe('available');
    expect(band.reason).toBeNull();
    if (band.status !== 'available') throw new Error('esperava faixa disponível');
    expect(band.lowerOffsetCents).toBe(-1200n);
    expect(band.upperOffsetCents).toBe(1200n);
    expect(band.residuals).toBe(30);
    expect(band.folds).toBe(5);
    expect(band.lowerPercentileBps).toBe(1000);
    expect(band.upperPercentileBps).toBe(9000);
  });

  it('27 resíduos ⇒ sem faixa, com motivo e sem números', () => {
    const band = residualBand(residuals30().slice(0, 27), 5);
    expect(band.status).toBe('insufficient');
    expect(band.reason).toContain('27');
    expect(band.reason).toContain(String(MIN_BAND_RESIDUALS));
    expect('lowerOffsetCents' in band).toBe(false);
  });

  it('exatamente 28 resíduos ⇒ faixa disponível (fronteira)', () => {
    expect(residualBand(residuals30().slice(0, 28), 4).status).toBe('available');
  });

  it('3 dobras ⇒ sem faixa mesmo com muitos resíduos (dependência dentro da dobra)', () => {
    const many = Array.from({ length: 90 }, (_, i) => BigInt(i));
    const band = residualBand(many, 3);
    expect(band.status).toBe('insufficient');
    expect(band.reason).toContain('3 dobras');
  });

  it('não altera o vetor recebido e independe da ordem', () => {
    const input = residuals30();
    const copy = [...input];
    const a = residualBand(input, 5);
    expect(input).toEqual(copy);
    expect(residualBand([...input].reverse(), 5)).toEqual(a);
  });

  it('resíduos todos zero (ajuste perfeito em dados sintéticos) ⇒ faixa de largura zero, sem erro', () => {
    const band = residualBand(Array(40).fill(0n), 6);
    expect(band.status).toBe('available');
    if (band.status === 'available') expect([band.lowerOffsetCents, band.upperOffsetCents]).toEqual([0n, 0n]);
  });
});

describe('applyBand', () => {
  const points = [
    { date: '2026-11-12', centralCents: 10000n },
    { date: '2026-11-13', centralCents: 500n },
  ];

  it('soma os deslocamentos à previsão central; central não muda', () => {
    const band = residualBand(residuals30(), 5);
    const out = applyBand(points, band);
    expect(out[0]).toEqual({ date: '2026-11-12', centralCents: 10000n, lowerCents: 8800n, upperCents: 11200n });
    expect(out[0]?.centralCents).toBe(10000n);
  });

  it('piso em zero: faturamento não é negativo', () => {
    const out = applyBand(points, residualBand(residuals30(), 5));
    expect(out[1]).toEqual({ date: '2026-11-13', centralCents: 500n, lowerCents: 0n, upperCents: 1700n });
  });

  it('erro histórico sempre de um lado (viés) ⇒ a central pode ficar FORA da faixa: nada é "corrigido" em silêncio', () => {
    const biased = residualBand(Array.from({ length: 40 }, (_, i) => BigInt(1000 + i)), 6); // sempre subestimou
    const out = applyBand([{ date: '2026-11-12', centralCents: 10000n }], biased);
    expect((out[0]?.lowerCents as bigint) > 10000n).toBe(true);
  });

  it('sem faixa disponível: limites nulos, nunca inventados', () => {
    const out = applyBand(points, residualBand([1n, 2n], 1));
    expect(out.every((p) => p.lowerCents === null && p.upperCents === null)).toBe(true);
    expect(out.map((p) => p.centralCents)).toEqual([10000n, 500n]);
  });
});
