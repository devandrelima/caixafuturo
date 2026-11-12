import { daysBetween, isValidISODate, rangeAfter } from '../finance/dates';
import type { ISODate } from '../finance/types';
import type { Sale } from '../sales/types';
import { divRound, MAX_FORECAST_DAYS, MIN_BASELINE_DAYS, STALE_AFTER_DAYS, weekdayOf } from './baseline';
import type { MissingDayPolicy, SalesPoint } from './baseline';
import { analyzeSeasonality, buildTrainingSeries, MAX_FILLED_SHARE_BPS } from './seasonality';

/**
 * Modelos de previsão de FATURAMENTO BRUTO diário (ADR-0007, D3). Parâmetros FIXOS e documentados: nenhum é
 * ajustado olhando o desempenho (sem busca de hiperparâmetros). Todos recebem a MESMA série de treino ao corte.
 * Modelo inelegível devolve motivo e nenhum ponto: sem amostra não há número. Nada aqui é dinheiro disponível.
 */

export const MODEL_IDS = ['naive_last', 'moving_average_7', 'seasonal_weekday_mean', 'holt_winters_additive'] as const;
export type ModelId = (typeof MODEL_IDS)[number];

/** Janela da média móvel: um ciclo semanal inteiro (neutraliza o dia da semana). */
export const MOVING_AVERAGE_WINDOW = 7;
/** Ocorrências do mesmo dia da semana usadas pelo modelo sazonal. */
export const SEASONAL_OCCURRENCES = 4;
/** Holt-Winters aditivo, período semanal; parâmetros em pontos-base (2000 = 0,20). */
export const HW_PERIOD = 7;
export const HW_ALPHA_BPS = 2000;
export const HW_BETA_BPS = 500;
export const HW_GAMMA_BPS = 3000;
/** Série mínima (dias) para o Holt-Winters: 6 ciclos semanais (inicialização usa os 2 primeiros). */
export const HW_MIN_DAYS = 42;

export interface ModelPoint {
  date: ISODate;
  centralCents: bigint;
}

export interface ModelResult {
  id: ModelId;
  label: string;
  /** Regra em uma frase, exibível. */
  description: string;
  params: Record<string, number>;
  eligible: boolean;
  /** Por que não há previsão; null quando elegível. */
  reason: string | null;
  /** Vazio quando inelegível. */
  points: ModelPoint[];
}

export interface TrainingWindow {
  from: ISODate | null;
  to: ISODate | null;
  days: number;
  observedDays: number;
  filledDays: number;
}

export interface ModelsResult {
  cutoff: ISODate;
  horizonDays: number;
  window: TrainingWindow;
  models: ModelResult[];
  warnings: string[];
}

export interface ModelsOptions {
  /** Data de corte (inclusiva); a previsão começa no dia seguinte. */
  cutoff: ISODate;
  horizonDays: number;
  missingDays?: MissingDayPolicy;
}

const META: Record<ModelId, { label: string; description: string; params: Record<string, number> }> = {
  naive_last: {
    label: 'Ingênuo (último dia)',
    description: 'Repete o faturamento do último dia da série.',
    params: {},
  },
  moving_average_7: {
    label: 'Média móvel de 7 dias',
    description: 'Repete a média dos últimos 7 dias da série.',
    params: { window: MOVING_AVERAGE_WINDOW },
  },
  seasonal_weekday_mean: {
    label: 'Sazonal por dia da semana',
    description: `Para cada dia da semana, a média das últimas ${SEASONAL_OCCURRENCES} ocorrências (sem valores atípicos). Só com sazonalidade semanal confirmada.`,
    params: { occurrences: SEASONAL_OCCURRENCES },
  },
  holt_winters_additive: {
    label: 'Holt-Winters aditivo (semanal)',
    description: `Nível, tendência e padrão semanal suavizados (α ${HW_ALPHA_BPS / 10_000}, β ${HW_BETA_BPS / 10_000}, γ ${HW_GAMMA_BPS / 10_000}), parâmetros fixos. Exige ao menos ${HW_MIN_DAYS} dias.`,
    params: { alphaBps: HW_ALPHA_BPS, betaBps: HW_BETA_BPS, gammaBps: HW_GAMMA_BPS, period: HW_PERIOD },
  },
};

const sum = (values: readonly bigint[]): bigint => values.reduce((a, x) => a + x, 0n);

/**
 * Holt-Winters aditivo em inteiros (centavos). Inicialização: nível = média do 1º ciclo; tendência = (média do
 * 2º − média do 1º) ÷ 7; sazonal = valor − nível no 1º ciclo. Recursão a partir do 8º dia; cada passo é arredondado
 * ao centavo (meio longe do zero). Previsão h dias à frente = nível + h × tendência + sazonal do dia, piso em zero.
 */
function holtWinters(x: readonly bigint[], horizon: number): bigint[] {
  const m = HW_PERIOD;
  const alpha = BigInt(HW_ALPHA_BPS);
  const beta = BigInt(HW_BETA_BPS);
  const gamma = BigInt(HW_GAMMA_BPS);
  const first = sum(x.slice(0, m));
  const second = sum(x.slice(m, 2 * m));
  let level = divRound(first, BigInt(m));
  let trend = divRound(second - first, BigInt(m * m));
  const season = x.slice(0, m).map((v) => v - level);
  for (let t = m; t < x.length; t += 1) {
    const i = t % m;
    const prevLevel = level;
    level = divRound(alpha * ((x[t] as bigint) - (season[i] as bigint)) + (10_000n - alpha) * (prevLevel + trend), 10_000n);
    trend = divRound(beta * (level - prevLevel) + (10_000n - beta) * trend, 10_000n);
    season[i] = divRound(gamma * ((x[t] as bigint) - level) + (10_000n - gamma) * (season[i] as bigint), 10_000n);
  }
  const n = x.length;
  return Array.from({ length: horizon }, (_, k) => {
    const h = k + 1;
    const raw = level + BigInt(h) * trend + (season[(n - 1 + h) % m] as bigint);
    return raw < 0n ? 0n : raw;
  });
}

function windowOf(series: readonly SalesPoint[]): TrainingWindow {
  const filledDays = series.filter((p) => p.filled).length;
  return {
    from: series[0]?.date ?? null,
    to: series[series.length - 1]?.date ?? null,
    days: series.length,
    observedDays: series.length - filledDays,
    filledDays,
  };
}

/** Roda todos os modelos sobre a mesma série de treino ao corte. Lança RangeError para corte/horizonte inválidos. */
export function forecastModels(sales: readonly Sale[], options: ModelsOptions): ModelsResult {
  const { cutoff, horizonDays, missingDays = 'zero' } = options;
  if (!isValidISODate(cutoff)) throw new RangeError(`Data de corte inválida: ${JSON.stringify(cutoff)}`);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > MAX_FORECAST_DAYS) {
    throw new RangeError(`Horizonte deve ser um inteiro entre 1 e ${MAX_FORECAST_DAYS} dias.`);
  }
  const series = buildTrainingSeries(sales, cutoff, missingDays);
  const window = windowOf(series);
  const dates = rangeAfter(cutoff, horizonDays);
  const warnings: string[] = [];

  const build = (id: ModelId, reason: string | null, values: readonly bigint[] | null): ModelResult => ({
    id,
    ...META[id],
    eligible: reason === null,
    reason,
    points: reason === null && values ? dates.map((date, i) => ({ date, centralCents: values[i] as bigint })) : [],
  });

  if (window.observedDays < MIN_BASELINE_DAYS) {
    const reason = `Histórico insuficiente: ${window.observedDays} dias com venda; são necessários ao menos ${MIN_BASELINE_DAYS}.`;
    return { cutoff, horizonDays, window, models: MODEL_IDS.map((id) => build(id, reason, null)), warnings };
  }

  const lastObserved = [...series].reverse().find((p) => !p.filled) as SalesPoint;
  if (daysBetween(lastObserved.date, cutoff) > STALE_AFTER_DAYS) {
    warnings.push(
      `Histórico desatualizado: a última venda é de ${lastObserved.date}, mais de ${STALE_AFTER_DAYS} dias antes do corte (${cutoff}). ${
        missingDays === 'zero' ? 'Os dias seguintes entraram como R$ 0.' : 'Os dias seguintes foram ignorados.'
      }`,
    );
  }
  if (window.filledDays > 0) {
    warnings.push(`${window.filledDays} de ${window.days} dias sem venda foram tratados como R$ 0 (dia sem movimento).`);
  }

  const values = series.map((p) => p.grossCents);

  const naive = values[values.length - 1] as bigint;
  const ma = divRound(sum(values.slice(-MOVING_AVERAGE_WINDOW)), BigInt(MOVING_AVERAGE_WINDOW));

  // sazonal: só com sazonalidade semanal confirmada; usa os valores utilizáveis (sem outliers) do mesmo dia da semana
  const seasonality = analyzeSeasonality(sales, { cutoff, missingDays });
  let seasonalReason: string | null = null;
  let seasonalValues: bigint[] | null = null;
  if (seasonality.weekly.status !== 'seasonal') {
    seasonalReason = `Sem sazonalidade semanal confirmada: ${seasonality.weekly.reason ?? 'padrão não detectado.'}`;
  } else {
    const outlierDates = new Set(seasonality.outliers.map((o) => o.date));
    const byWeekday = (w: number): bigint[] =>
      series.filter((p) => weekdayOf(p.date) === w && !outlierDates.has(p.date)).map((p) => p.grossCents);
    seasonalValues = dates.map((date) => {
      const recent = byWeekday(weekdayOf(date)).slice(-SEASONAL_OCCURRENCES);
      return divRound(sum(recent), BigInt(recent.length));
    });
  }

  // Holt-Winters: janela longa, poucas lacunas e dias consecutivos (o período semanal depende da posição)
  let hwReason: string | null = null;
  if (series.length < HW_MIN_DAYS) {
    hwReason = `Holt-Winters exige ao menos ${HW_MIN_DAYS} dias de série (6 ciclos semanais); a janela tem ${series.length} dias.`;
  } else if (window.filledDays * 10_000 > MAX_FILLED_SHARE_BPS * window.days) {
    hwReason = `Holt-Winters recusado: muitas lacunas (${window.filledDays} de ${window.days} dias sem venda; limite ${MAX_FILLED_SHARE_BPS / 100}%).`;
  } else if (daysBetween(window.from as ISODate, window.to as ISODate) + 1 !== series.length) {
    hwReason = 'Holt-Winters exige dias consecutivos; há lacunas e a política escolhida ignora dias sem venda.';
  }

  return {
    cutoff,
    horizonDays,
    window,
    warnings,
    models: [
      build('naive_last', null, dates.map(() => naive)),
      build('moving_average_7', null, dates.map(() => ma)),
      build('seasonal_weekday_mean', seasonalReason, seasonalValues),
      build('holt_winters_additive', hwReason, hwReason === null ? holtWinters(values, horizonDays) : null),
    ],
  };
}
