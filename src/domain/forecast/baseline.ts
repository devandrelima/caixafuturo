import { addDays, compareISO, daysBetween, isValidISODate, rangeAfter } from '../finance/dates';
import { centsFromString } from '../finance/money';
import type { ISODate } from '../finance/types';
import type { Sale } from '../sales/types';

/**
 * Médias, tendência simples e baseline de FATURAMENTO BRUTO (contrato: contratos/previsoes.md, S02).
 * Nada aqui é dinheiro disponível: a conversão para caixa só ocorre pela regra de repasse (taxas e prazos).
 * Nenhum modelo é validado nesta sprint (backtesting é da S03): `validated` é sempre false.
 */

/** Abaixo disso (dias COM venda) não há previsão: aviso no lugar de precisão inventada. */
export const MIN_BASELINE_DAYS = 7;
/** Abaixo disso (dias de período) o histórico é "série curta": projeta, mas avisa. */
export const SHORT_SERIES_DAYS = 28;
/** Janela da tendência: últimos N dias vs N dias anteriores (múltiplo de 7 neutraliza o dia da semana). */
export const TREND_WINDOW_DAYS = 7;
/** Variação menor que isto (±5%, em pontos-base) é "estável". */
export const FLAT_TREND_BPS = 500;
/** Atraso máximo aceitável entre a última venda e a data-base antes de avisar. */
export const STALE_AFTER_DAYS = 7;
export const MAX_FORECAST_DAYS = 90;
export const DEFAULT_FORECAST_DAYS = 30;

/** Dia sem nenhuma venda: `zero` = dia sem movimento (R$ 0, marcado como preenchido); `ignore` = falta de dado. */
export type MissingDayPolicy = 'zero' | 'ignore';

export interface SalesPoint {
  date: ISODate;
  grossCents: bigint;
  saleIds: string[];
  /** true = dia sem venda preenchido com zero pela política. */
  filled: boolean;
}

export interface WeekdayMean {
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  days: number;
  meanCents: bigint | null;
}

export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';
export interface Trend {
  recentMeanCents: bigint | null;
  previousMeanCents: bigint | null;
  /** Variação em pontos-base (1000 = +10%); null quando não calculável. */
  changeBps: number | null;
  direction: TrendDirection;
}

export interface SeriesStats {
  fromDate: ISODate;
  toDate: ISODate;
  /** Dias na série (inclui os preenchidos com zero; com a política "ignore" só os observados). */
  days: number;
  observedDays: number;
  filledDays: number;
  totalCents: bigint;
  meanCents: bigint;
  weekdayMeans: WeekdayMean[];
  trend: Trend;
}

export type ForecastMethod = 'baseline_mean' | 'manual_hypothesis' | 'manual_adjustment';

export interface ForecastPoint {
  date: ISODate;
  centralCents: bigint;
  /** Sem faixas na S02: só com erro histórico medido (S03). */
  lowerCents: null;
  upperCents: null;
  method: ForecastMethod;
  /** Última data de venda usada; null em hipótese manual. */
  trainEnd: ISODate | null;
  sampleDays: number;
  /** true = suposição do usuário (manual). */
  isHypothesis: boolean;
  /** Nenhum modelo foi validado por backtesting. */
  validated: false;
  /** Sempre faturamento bruto, nunca caixa. */
  unit: 'gross_sales';
  label: string;
}

export type WarningCode = 'insufficient_history' | 'short_series' | 'stale_history' | 'zero_filled';
export interface ForecastWarning {
  code: WarningCode;
  message: string;
}

export interface BaselineResult {
  points: ForecastPoint[];
  stats: SeriesStats | null;
  warnings: ForecastWarning[];
}

export interface BaselineOptions {
  /** Data-base: a previsão começa no dia seguinte. */
  asOf: ISODate;
  horizonDays?: number;
  missingDays?: MissingDayPolicy;
}

const LABEL_BASELINE = 'Média histórica (baseline não validado)';
const LABEL_MANUAL = 'Hipótese manual — não é previsão validada';
const LABEL_ADJUST = 'Hipótese manual sobre o baseline — não é previsão validada';

/** Divisão inteira arredondando ao mais próximo, meio longe do zero (exportada: reutilizada por sazonalidade, modelos e backtest). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

/** Agrega vendas por dia (ordem cronológica) e aplica a política de dia sem venda entre a 1ª e a última venda. */
export function buildSalesSeries(sales: readonly Sale[], policy: MissingDayPolicy = 'zero'): SalesPoint[] {
  const byDay = new Map<ISODate, SalesPoint>();
  for (const s of sales) {
    const point = byDay.get(s.saleDate) ?? { date: s.saleDate, grossCents: 0n, saleIds: [], filled: false };
    point.grossCents += centsFromString(s.grossCents);
    point.saleIds.push(s.id);
    byDay.set(s.saleDate, point);
  }
  const observed = [...byDay.values()].sort((a, b) => compareISO(a.date, b.date));
  if (policy === 'ignore' || observed.length === 0) return observed;
  const first = observed[0] as SalesPoint;
  const last = observed[observed.length - 1] as SalesPoint;
  const total = daysBetween(first.date, last.date) + 1;
  const series: SalesPoint[] = [];
  for (let i = 0; i < total; i += 1) {
    const date = addDays(first.date, i);
    series.push(byDay.get(date) ?? { date, grossCents: 0n, saleIds: [], filled: true });
  }
  return series;
}

/** 0 = domingo … 6 = sábado (data civil, sem fuso). */
export function weekdayOf(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function meanOf(points: readonly SalesPoint[]): bigint | null {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => acc + p.grossCents, 0n);
  return divRound(sum, BigInt(points.length));
}

function trendOf(series: readonly SalesPoint[], toDate: ISODate, days: number): Trend {
  const unknown: Trend = { recentMeanCents: null, previousMeanCents: null, changeBps: null, direction: 'unknown' };
  if (days < TREND_WINDOW_DAYS * 2) return unknown;
  const recentFrom = addDays(toDate, -(TREND_WINDOW_DAYS - 1));
  const previousFrom = addDays(toDate, -(TREND_WINDOW_DAYS * 2 - 1));
  const recent = series.filter((p) => p.date >= recentFrom);
  const previous = series.filter((p) => p.date >= previousFrom && p.date < recentFrom);
  const recentMean = meanOf(recent);
  const previousMean = meanOf(previous);
  if (recentMean === null || previousMean === null || previousMean === 0n) {
    return { recentMeanCents: recentMean, previousMeanCents: previousMean, changeBps: null, direction: 'unknown' };
  }
  const changeBps = Number(divRound((recentMean - previousMean) * 10_000n, previousMean));
  const direction: TrendDirection = Math.abs(changeBps) < FLAT_TREND_BPS ? 'flat' : changeBps > 0 ? 'up' : 'down';
  return { recentMeanCents: recentMean, previousMeanCents: previousMean, changeBps, direction };
}

/** Média diária, média por dia da semana e tendência simples. Todos os números são reproduzíveis à mão. */
export function seriesStats(series: readonly SalesPoint[]): SeriesStats | null {
  if (series.length === 0) return null;
  const fromDate = (series[0] as SalesPoint).date;
  const toDate = (series[series.length - 1] as SalesPoint).date;
  const filledDays = series.filter((p) => p.filled).length;
  const totalCents = series.reduce((acc, p) => acc + p.grossCents, 0n);
  const weekdayMeans: WeekdayMean[] = Array.from({ length: 7 }, (_, weekday) => {
    const points = series.filter((p) => weekdayOf(p.date) === weekday);
    return { weekday, days: points.length, meanCents: meanOf(points) };
  });
  // Com a política "ignore" a série pode ter buracos: a tendência usa o período em dias corridos.
  const calendarDays = daysBetween(fromDate, toDate) + 1;
  return {
    fromDate,
    toDate,
    days: series.length,
    observedDays: series.length - filledDays,
    filledDays,
    totalCents,
    meanCents: divRound(totalCents, BigInt(series.length)),
    weekdayMeans,
    trend: trendOf(series, toDate, calendarDays),
  };
}

/** Baseline por média diária do período observado, com avisos; abaixo do mínimo não projeta. */
export function baselineForecast(sales: readonly Sale[], options: BaselineOptions): BaselineResult {
  const { asOf, horizonDays = DEFAULT_FORECAST_DAYS, missingDays = 'zero' } = options;
  if (!isValidISODate(asOf)) throw new RangeError(`Data-base inválida: ${JSON.stringify(asOf)}`);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > MAX_FORECAST_DAYS) {
    throw new RangeError(`Horizonte deve ser um inteiro entre 1 e ${MAX_FORECAST_DAYS} dias.`);
  }
  const series = buildSalesSeries(sales, missingDays);
  const stats = seriesStats(series);
  const warnings: ForecastWarning[] = [];
  const observed = stats?.observedDays ?? 0;

  if (stats === null || observed < MIN_BASELINE_DAYS) {
    warnings.push({
      code: 'insufficient_history',
      message: `Histórico insuficiente: ${observed} dias com vendas; são necessários ao menos ${MIN_BASELINE_DAYS} para um baseline. Nenhuma previsão foi gerada.`,
    });
    return { points: [], stats, warnings };
  }

  if (stats.days < SHORT_SERIES_DAYS) {
    warnings.push({
      code: 'short_series',
      message: `Série curta: ${stats.days} dias de histórico (recomendado: ${SHORT_SERIES_DAYS} ou mais). A média pode não representar o padrão semanal.`,
    });
  }
  if (stats.filledDays > 0) {
    warnings.push({
      code: 'zero_filled',
      message: `${stats.filledDays} de ${stats.days} dias sem venda foram tratados como R$ 0 (dia sem movimento). Confira se eram dias fechados ou falta de dados.`,
    });
  }
  if (daysBetween(stats.toDate, asOf) > STALE_AFTER_DAYS) {
    warnings.push({
      code: 'stale_history',
      message: `A última venda é de ${stats.toDate}, mais de ${STALE_AFTER_DAYS} dias antes da data-base (${asOf}); a média pode estar desatualizada.`,
    });
  }

  const points: ForecastPoint[] = rangeAfter(asOf, horizonDays).map((date) => ({
    date,
    centralCents: stats.meanCents,
    lowerCents: null,
    upperCents: null,
    method: 'baseline_mean',
    trainEnd: stats.toDate,
    sampleDays: stats.days,
    isHypothesis: false,
    validated: false,
    unit: 'gross_sales',
    label: LABEL_BASELINE,
  }));
  return { points, stats, warnings };
}

export interface ManualProjectionInput {
  startDate: ISODate;
  days: number;
  dailyGrossCents: bigint;
}
export type ManualProjectionResult = { ok: true; points: ForecastPoint[] } | { ok: false; reason: string };

/** Projeção manual: faturamento diário informado pelo usuário. Sempre hipótese, sem dados de treino. */
export function manualProjection(input: ManualProjectionInput): ManualProjectionResult {
  const { startDate, days, dailyGrossCents } = input;
  if (!isValidISODate(startDate)) return { ok: false, reason: 'Data inicial inválida.' };
  if (!Number.isInteger(days) || days < 1 || days > MAX_FORECAST_DAYS) {
    return { ok: false, reason: `Informe de 1 a ${MAX_FORECAST_DAYS} dias.` };
  }
  if (dailyGrossCents < 0n) return { ok: false, reason: 'O faturamento diário não pode ser negativo.' };
  const points: ForecastPoint[] = Array.from({ length: days }, (_, i) => ({
    date: addDays(startDate, i),
    centralCents: dailyGrossCents,
    lowerCents: null,
    upperCents: null,
    method: 'manual_hypothesis',
    trainEnd: null,
    sampleDays: 0,
    isHypothesis: true,
    validated: false,
    unit: 'gross_sales',
    label: LABEL_MANUAL,
  }));
  return { ok: true, points };
}

/** Ajusta pontos (ex.: baseline) por um percentual em pontos-base; o resultado é hipótese, o original não muda. */
export function adjustForecast(points: readonly ForecastPoint[], bps: number): ForecastPoint[] {
  if (!Number.isInteger(bps) || bps < -10_000) {
    throw new RangeError('O ajuste deve ser um inteiro em pontos-base, no mínimo -10000 (-100%).');
  }
  const factor = BigInt(10_000 + bps);
  return points.map((p) => ({
    ...p,
    centralCents: divRound(p.centralCents * factor, 10_000n),
    method: 'manual_adjustment',
    isHypothesis: true,
    label: LABEL_ADJUST,
  }));
}
