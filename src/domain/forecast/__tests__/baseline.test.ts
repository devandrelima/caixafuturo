import { describe, expect, it } from 'vitest';
import { addDays } from '../../finance/dates';
import type { Sale } from '../../sales/types';
import {
  adjustForecast,
  baselineForecast,
  buildSalesSeries,
  manualProjection,
  MAX_FORECAST_DAYS,
  MIN_BASELINE_DAYS,
  seriesStats,
  SHORT_SERIES_DAYS,
} from '../baseline';

let seq = 0;
/** Venda fictícia: `reais` em reais inteiros (convertido para centavos). */
const sale = (saleDate: string, cents: number | bigint): Sale => {
  seq += 1;
  return {
    id: `sale_${seq}`,
    saleKey: `sale:T${seq}`,
    externalId: `T${seq}`,
    saleDate,
    grossCents: cents.toString(),
    method: 'pix',
    category: '',
  };
};

/**
 * Amostra sintética (contas à mão). Semana 1 = seg 26/10 a dom 01/11: R$ 100…700 (soma 2.800, média 400).
 * Semana 2 = seg 02/11 a dom 08/11: R$ 110…770 (soma 3.080, média 440). Total 5.880 / 14 dias = R$ 420,00.
 * Cada dia é dividido em duas vendas para provar a agregação por dia.
 */
function twoWeeks(): Sale[] {
  const week1 = [100, 200, 300, 400, 500, 600, 700];
  const week2 = [110, 220, 330, 440, 550, 660, 770];
  const out: Sale[] = [];
  [...week1, ...week2].forEach((reais, i) => {
    const date = addDays('2026-10-26', i);
    out.push(sale(date, reais * 100 - 1000), sale(date, 1000));
  });
  return out;
}

describe('buildSalesSeries — política explícita para dia sem venda', () => {
  const sales = [sale('2026-11-02', 10000), sale('2026-11-02', 500), sale('2026-11-05', 7000)];

  it('padrão "zero": dia sem venda dentro do período vira R$ 0 marcado como preenchido', () => {
    const s = buildSalesSeries(sales);
    expect(s.map((p) => p.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    expect(s.map((p) => p.grossCents)).toEqual([10500n, 0n, 0n, 7000n]);
    expect(s.map((p) => p.filled)).toEqual([false, true, true, false]);
    expect(s[0]?.saleIds).toHaveLength(2);
    expect(s[1]?.saleIds).toEqual([]);
  });

  it('política "ignore": só dias com venda; nada é inventado', () => {
    const s = buildSalesSeries(sales, 'ignore');
    expect(s.map((p) => p.date)).toEqual(['2026-11-02', '2026-11-05']);
    expect(s.every((p) => !p.filled)).toBe(true);
  });

  it('sem vendas → série vazia; entrada fora de ordem é ordenada', () => {
    expect(buildSalesSeries([])).toEqual([]);
    const s = buildSalesSeries([sale('2026-11-05', 1), sale('2026-11-02', 2)], 'ignore');
    expect(s.map((p) => p.date)).toEqual(['2026-11-02', '2026-11-05']);
  });

  it('não perde precisão acima de 2^53 centavos', () => {
    const s = buildSalesSeries([sale('2026-11-02', 9007199254740993n), sale('2026-11-02', 1)]);
    expect(s[0]?.grossCents).toBe(9007199254740994n);
  });
});

describe('seriesStats — médias e tendência auditáveis', () => {
  const stats = seriesStats(buildSalesSeries(twoWeeks()));

  it('total, dias e média diária batem com a conta manual (R$ 5.880 / 14 = R$ 420,00)', () => {
    expect(stats).not.toBeNull();
    expect(stats).toMatchObject({
      fromDate: '2026-10-26',
      toDate: '2026-11-08',
      days: 14,
      observedDays: 14,
      filledDays: 0,
      totalCents: 588000n,
      meanCents: 42000n,
    });
  });

  it('média por dia da semana: segunda (100+110)/2 = 105 … domingo (700+770)/2 = 735', () => {
    const w = stats?.weekdayMeans ?? [];
    expect(w).toHaveLength(7);
    expect(w[1]).toEqual({ weekday: 1, days: 2, meanCents: 10500n }); // segunda
    expect(w[2]?.meanCents).toBe(21000n);
    expect(w[0]).toEqual({ weekday: 0, days: 2, meanCents: 73500n }); // domingo
  });

  it('tendência: últimos 7 dias (média 440) vs 7 anteriores (média 400) = +1000 bps = +10%', () => {
    expect(stats?.trend).toEqual({
      recentMeanCents: 44000n,
      previousMeanCents: 40000n,
      changeBps: 1000,
      direction: 'up',
    });
  });

  it('tendência de queda e estável (limite de ±5%)', () => {
    const mk = (a: number, b: number) =>
      seriesStats(buildSalesSeries([...Array(7).keys()].flatMap((i) => [sale(addDays('2026-11-01', i), a), sale(addDays('2026-11-08', i), b)])));
    expect(mk(10000, 8000)?.trend).toMatchObject({ changeBps: -2000, direction: 'down' });
    expect(mk(10000, 10499)?.trend).toMatchObject({ changeBps: 499, direction: 'flat' });
    expect(mk(10000, 10500)?.trend).toMatchObject({ changeBps: 500, direction: 'up' });
  });

  it('tendência desconhecida com menos de 14 dias ou período anterior zerado', () => {
    const short = seriesStats(buildSalesSeries(twoWeeks().slice(0, 20)));
    expect(short?.days).toBe(10);
    expect(short?.trend).toEqual({ recentMeanCents: null, previousMeanCents: null, changeBps: null, direction: 'unknown' });
    const zeros = seriesStats(buildSalesSeries([sale('2026-11-01', 0), sale('2026-11-14', 5000)]));
    expect(zeros?.trend.changeBps).toBeNull();
    expect(zeros?.trend.direction).toBe('unknown');
  });

  it('arredonda a média para o centavo mais próximo (meio sobe): 5 centavos em 2 dias → 3', () => {
    const s = seriesStats(buildSalesSeries([sale('2026-11-01', 2), sale('2026-11-02', 3)]));
    expect(s?.meanCents).toBe(3n);
    const t = seriesStats(buildSalesSeries([sale('2026-11-01', 10000), sale('2026-11-02', 10000), sale('2026-11-03', 10001)]));
    expect(t?.meanCents).toBe(10000n); // 30001 / 3 = 10000,33
  });

  it('dias preenchidos entram na média como zero e são contados: (100 + 0 + 0 + 70) / 4 = 42,50', () => {
    const s = seriesStats(buildSalesSeries([sale('2026-11-02', 10000), sale('2026-11-05', 7000)]));
    expect(s).toMatchObject({ days: 4, observedDays: 2, filledDays: 2, meanCents: 4250n });
    const i = seriesStats(buildSalesSeries([sale('2026-11-02', 10000), sale('2026-11-05', 7000)], 'ignore'));
    expect(i).toMatchObject({ days: 2, observedDays: 2, filledDays: 0, meanCents: 8500n });
  });

  it('série vazia → null', () => {
    expect(seriesStats([])).toBeNull();
  });
});

describe('baselineForecast — baseline por média, sem precisão inventada', () => {
  it('amostra de 14 dias: 30 pontos a partir de asOf+1, valor central = média R$ 420,00, sem faixa', () => {
    const r = baselineForecast(twoWeeks(), { asOf: '2026-11-08' });
    expect(r.points).toHaveLength(30);
    expect(r.points[0]?.date).toBe('2026-11-09');
    expect(r.points[29]?.date).toBe('2026-12-08');
    expect(r.points.every((p) => p.centralCents === 42000n)).toBe(true);
    expect(r.points[0]).toMatchObject({
      lowerCents: null,
      upperCents: null,
      method: 'baseline_mean',
      trainEnd: '2026-11-08',
      sampleDays: 14,
      isHypothesis: false,
      validated: false,
    });
    expect(r.points[0]?.label).toMatch(/não validad/i);
    expect(r.stats?.meanCents).toBe(42000n);
  });

  it('14 dias é série curta (< 28): avisa, mas ainda projeta', () => {
    const r = baselineForecast(twoWeeks(), { asOf: '2026-11-08' });
    expect(r.warnings.map((w) => w.code)).toContain('short_series');
    expect(r.warnings.find((w) => w.code === 'short_series')?.message).toMatch(/14 dias/);
    expect(r.points.length).toBeGreaterThan(0);
  });

  it('28 dias ou mais: sem aviso de série curta', () => {
    const sales = Array.from({ length: SHORT_SERIES_DAYS }, (_, i) => sale(addDays('2026-10-12', i), 10000));
    const r = baselineForecast(sales, { asOf: addDays('2026-10-12', SHORT_SERIES_DAYS - 1) });
    expect(r.warnings).toEqual([]);
    expect(r.points[0]?.centralCents).toBe(10000n);
  });

  it(`menos de ${MIN_BASELINE_DAYS} dias: NENHUM ponto e aviso de histórico insuficiente (sem precisão inventada)`, () => {
    const sales = Array.from({ length: MIN_BASELINE_DAYS - 1 }, (_, i) => sale(addDays('2026-11-01', i), 10000));
    const r = baselineForecast(sales, { asOf: '2026-11-06' });
    expect(r.points).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['insufficient_history']);
    expect(r.warnings[0]?.message).toMatch(/6 dias com vendas/);
    expect(r.stats?.days).toBe(6);
  });

  it(`exatamente ${MIN_BASELINE_DAYS} dias já projeta (com aviso de série curta)`, () => {
    const sales = Array.from({ length: MIN_BASELINE_DAYS }, (_, i) => sale(addDays('2026-11-01', i), 10000));
    const r = baselineForecast(sales, { asOf: '2026-11-07' });
    expect(r.points).toHaveLength(30);
    expect(r.warnings.map((w) => w.code)).toEqual(['short_series']);
  });

  it('sem vendas: nenhum ponto, aviso de histórico insuficiente, stats nulo', () => {
    const r = baselineForecast([], { asOf: '2026-11-08' });
    expect(r).toMatchObject({ points: [], stats: null });
    expect(r.warnings.map((w) => w.code)).toEqual(['insufficient_history']);
  });

  it('dias sem venda tratados como zero geram aviso explícito e entram na média', () => {
    // 7 dias seguidos com venda (01–07/11), 08 e 09/11 sem venda, e venda em 10/11: período de 10 dias, 2 preenchidos.
    const sales = [...Array.from({ length: 7 }, (_, i) => sale(addDays('2026-11-01', i), 10000)), sale('2026-11-10', 10000)];
    const r = baselineForecast(sales, { asOf: '2026-11-10' });
    expect(r.warnings.map((w) => w.code)).toContain('zero_filled');
    expect(r.warnings.find((w) => w.code === 'zero_filled')?.message).toMatch(/2 de 10 dias/);
    expect(r.points[0]?.centralCents).toBe(8000n); // 80000 / 10
    expect(r.stats).toMatchObject({ days: 10, observedDays: 8, filledDays: 2 });
    const ignored = baselineForecast(sales, { asOf: '2026-11-10', missingDays: 'ignore' });
    expect(ignored.points[0]?.centralCents).toBe(10000n); // 80000 / 8 dias observados
    expect(ignored.warnings.map((w) => w.code)).not.toContain('zero_filled');
  });

  it('suficiência conta dias COM venda: 2 vendas em 8 dias não geram previsão, mesmo preenchendo zeros', () => {
    const sales = [sale('2026-11-01', 10000), sale('2026-11-08', 10000)];
    const r = baselineForecast(sales, { asOf: '2026-11-08' });
    expect(r.points).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['insufficient_history']);
    expect(r.warnings[0]?.message).toMatch(/2 dias com vendas/);
    expect(r.stats).toMatchObject({ days: 8, observedDays: 2, filledDays: 6 });
  });

  it('histórico antigo (> 7 dias antes da data-base) gera aviso de defasagem', () => {
    const sales = Array.from({ length: 14 }, (_, i) => sale(addDays('2026-10-01', i), 10000)); // termina 14/10
    const r = baselineForecast(sales, { asOf: '2026-11-08' });
    expect(r.warnings.map((w) => w.code)).toContain('stale_history');
    expect(r.points[0]?.trainEnd).toBe('2026-10-14');
    expect(r.points[0]?.date).toBe('2026-11-09');
  });

  it('horizonte configurável e validado; vendas não viram dinheiro (unidade é faturamento)', () => {
    const r = baselineForecast(twoWeeks(), { asOf: '2026-11-08', horizonDays: 7 });
    expect(r.points).toHaveLength(7);
    expect(r.points.every((p) => p.unit === 'gross_sales')).toBe(true);
    expect(() => baselineForecast(twoWeeks(), { asOf: '2026-11-08', horizonDays: 0 })).toThrow(RangeError);
    expect(() => baselineForecast(twoWeeks(), { asOf: '2026-11-08', horizonDays: MAX_FORECAST_DAYS + 1 })).toThrow(RangeError);
    expect(() => baselineForecast(twoWeeks(), { asOf: '2026-02-30' })).toThrow(/data/i);
  });

  it('a previsão não altera a série de entrada (cronologia: usa só vendas existentes)', () => {
    const input = twoWeeks();
    const copy = JSON.stringify(input);
    baselineForecast(input, { asOf: '2026-11-08' });
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe('projeção manual — sempre hipótese, nunca modelo validado', () => {
  it('valor diário informado: pontos marcados como hipótese, sem dados de treino', () => {
    const r = manualProjection({ startDate: '2026-11-09', days: 3, dailyGrossCents: 50000n });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points.map((p) => p.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    for (const p of r.points) {
      expect(p).toMatchObject({
        centralCents: 50000n,
        lowerCents: null,
        upperCents: null,
        method: 'manual_hypothesis',
        trainEnd: null,
        sampleDays: 0,
        isHypothesis: true,
        validated: false,
        unit: 'gross_sales',
      });
      expect(p.label).toMatch(/hipótese/i);
    }
  });

  it('aceita zero (loja fechada) e recusa negativo, dias inválidos e data inválida', () => {
    expect(manualProjection({ startDate: '2026-11-09', days: 1, dailyGrossCents: 0n }).ok).toBe(true);
    expect(manualProjection({ startDate: '2026-11-09', days: 1, dailyGrossCents: -1n })).toEqual({
      ok: false,
      reason: expect.stringMatching(/negativ/i),
    });
    expect(manualProjection({ startDate: '2026-11-09', days: 0, dailyGrossCents: 1n }).ok).toBe(false);
    expect(manualProjection({ startDate: '2026-11-09', days: MAX_FORECAST_DAYS + 1, dailyGrossCents: 1n }).ok).toBe(false);
    expect(manualProjection({ startDate: '2026-11-09', days: 1.5, dailyGrossCents: 1n }).ok).toBe(false);
    expect(manualProjection({ startDate: 'amanhã', days: 1, dailyGrossCents: 1n })).toEqual({
      ok: false,
      reason: expect.stringMatching(/data/i),
    });
  });

  it('ajuste manual do baseline (+10% = 1000 bps): R$ 420,00 → R$ 462,00 e vira hipótese', () => {
    const base = baselineForecast(twoWeeks(), { asOf: '2026-11-08', horizonDays: 2 }).points;
    const adjusted = adjustForecast(base, 1000);
    expect(adjusted.map((p) => p.centralCents)).toEqual([46200n, 46200n]);
    expect(adjusted[0]).toMatchObject({ method: 'manual_adjustment', isHypothesis: true, validated: false, sampleDays: 14 });
    expect(adjusted[0]?.label).toMatch(/hipótese/i);
    expect(base[0]?.isHypothesis).toBe(false); // original intacto
    expect(adjustForecast(base, -2500)[0]?.centralCents).toBe(31500n);
    expect(adjustForecast(base, 33)[0]?.centralCents).toBe(42139n); // 42000 * 1,0033 = 42138,6 → 42139
  });

  it('ajuste que levaria a valor negativo (< -100%) é recusado', () => {
    const base = baselineForecast(twoWeeks(), { asOf: '2026-11-08', horizonDays: 1 }).points;
    expect(() => adjustForecast(base, -10001)).toThrow(RangeError);
    expect(adjustForecast(base, -10000)[0]?.centralCents).toBe(0n);
    expect(() => adjustForecast(base, 1.5)).toThrow(RangeError);
  });
});
