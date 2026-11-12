import { describe, expect, it } from 'vitest';
import { buildSalesSeries } from '../../domain/forecast/baseline';
import { analyzeSeasonality } from '../../domain/forecast/seasonality';
import { runBacktest } from '../../domain/forecast/backtest';
import { formatBRL } from '../../domain/finance/money';
import { totalGrossCents } from '../../domain/sales/importSales';
import { createSalesDemo } from '../salesDemo';
import {
  createForecastDemo,
  FORECAST_DEMO_FIRST_DAY,
  FORECAST_DEMO_GAP_DAY,
  FORECAST_DEMO_LAST_DAY,
  FORECAST_DEMO_OUTLIER_DAY,
} from '../forecastDemo';

describe('createForecastDemo — histórico fictício de 12 semanas (determinístico)', () => {
  const demo = createForecastDemo();

  it('84 dias corridos, 1 dia sem venda (lacuna) ⇒ 83 dias × 3 meios = 249 vendas', () => {
    expect(FORECAST_DEMO_FIRST_DAY).toBe('2026-08-20'); // quinta-feira
    expect(FORECAST_DEMO_LAST_DAY).toBe('2026-11-11'); // quarta-feira, data-base da demonstração
    expect(demo.sales).toHaveLength(249);
    const series = buildSalesSeries(demo.sales);
    expect(series).toHaveLength(84);
    expect(series.filter((p) => p.filled).map((p) => p.date)).toEqual([FORECAST_DEMO_GAP_DAY]);
  });

  it('total à mão: 8 semanas anteriores 27.957,15 + evento +1.711,20 − lacuna 346,50 + 28 dias da demo S02 14.580,00 = R$ 43.901,85', () => {
    /*
     * Qualquer janela de 7 dias contém cada dia da semana uma vez: R$ 3.645,00 (Dom 760 · Seg 350 · Ter 300 · Qua 325 · Qui 380 · Sex 610 · Sáb 920).
     * Fatores semanais (milésimos) das 8 semanas anteriores: 900, 920, 950, 930, 970, 990, 1000, 1010 (soma 7.670) ⇒ 3.645 × 7,670 = 27.957,15.
     * Evento: sábado 12/09 (semana de fator 930) vendeu 3× ⇒ +2 × (920 × 0,930) = +1.711,20.
     * Lacuna: segunda 28/09 (semana de fator 990) sem vendas ⇒ − 350 × 0,990 = −346,50.
     */
    expect(formatBRL(totalGrossCents(demo.sales))).toBe('R$ 43.901,85');
    expect(totalGrossCents(demo.sales)).toBe(4390185n);
  });

  it('as 4 últimas semanas são IDÊNTICAS à demonstração da S02 (mesmos ids e valores ⇒ importar os dois não duplica)', () => {
    const s02 = createSalesDemo().sales;
    const last28 = demo.sales.filter((s) => s.saleDate >= '2026-10-15');
    expect(last28).toHaveLength(84);
    expect(new Map(last28.map((s) => [s.id, s.grossCents]))).toEqual(new Map(s02.map((s) => [s.id, s.grossCents])));
    expect(formatBRL(totalGrossCents(last28))).toBe('R$ 14.580,00');
  });

  it('createSalesDemo (S02) segue com os mesmos números: 84 vendas, R$ 14.580,00', () => {
    const s02 = createSalesDemo();
    expect(s02.sales).toHaveLength(84);
    expect(formatBRL(totalGrossCents(s02.sales))).toBe('R$ 14.580,00');
  });

  it('o evento (sábado 12/09 = 3×) é sinalizado como outlier e a lacuna como dia preenchido; o padrão semanal é detectado', () => {
    // sábado 12/09: 920 × 0,930 × 3 = R$ 2.566,80
    const sat = demo.sales.filter((s) => s.saleDate === FORECAST_DEMO_OUTLIER_DAY).reduce((a, s) => a + BigInt(s.grossCents), 0n);
    expect(sat).toBe(256680n);
    const r = analyzeSeasonality(demo.sales, { cutoff: FORECAST_DEMO_LAST_DAY });
    expect(r.outliers.map((o) => [o.date, o.filled])).toEqual([
      [FORECAST_DEMO_OUTLIER_DAY, false],
      [FORECAST_DEMO_GAP_DAY, true],
    ]);
    expect(r.weekly.status).toBe('seasonal');
    expect(r.filledDays).toBe(1);
    expect(r.monthly.status).toBe('insufficient_data'); // só ~2,7 meses
  });

  it('backtesting na data-base: 8 dobras possíveis, 6 comparáveis, todos os modelos medidos; previsões finais conferidas à mão', () => {
    const r = runBacktest(demo.sales, { asOf: FORECAST_DEMO_LAST_DAY, horizonDays: 7 });
    expect(r.folds).toHaveLength(8);
    expect(r.comparison.status).toBe('ok');
    expect(r.comparison.comparableFolds).toBe(6);
    expect(r.comparison.comparedModels).toHaveLength(4);
    const byId = (id: string) => r.models.find((m) => m.id === id)!;
    // média móvel: últimos 7 dias = semana completa = 3.645,00 / 7 = 520,7143 ⇒ R$ 520,71 (igual à média da S02)
    expect(byId('moving_average_7').forecast[0]?.centralCents).toBe(52071n);
    // ingênuo: quarta-feira 11/11 = 110 + 75 + 140 = R$ 325,00
    expect(byId('naive_last').forecast[0]?.centralCents).toBe(32500n);
    // sazonal: últimas 4 quintas (semanas idênticas da S02) ⇒ quinta 12/11 = 130 + 90 + 160 = R$ 380,00
    expect(byId('seasonal_weekday_mean').forecast[0]?.date).toBe('2026-11-12');
    expect(byId('seasonal_weekday_mean').forecast[0]?.centralCents).toBe(38000n);
  });
});
