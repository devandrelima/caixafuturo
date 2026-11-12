import { addDays, daysBetween, isValidISODate, rangeAfter } from '../finance/dates';
import type { ISODate } from '../finance/types';
import type { Sale } from '../sales/types';
import { divRound, MAX_FORECAST_DAYS } from './baseline';
import type { ForecastPoint, MissingDayPolicy, SalesPoint } from './baseline';
import { applyBand, residualBand } from './intervals';
import type { ResidualBand } from './intervals';
import { forecastModels, MODEL_IDS } from './models';
import type { ModelId, ModelPoint, ModelResult, TrainingWindow } from './models';
import { buildTrainingSeries } from './seasonality';

/**
 * Backtesting rolling-origin (ADR-0007, D4). Em cada dobra o modelo recebe SÓ as vendas até a origem, prevê os `h`
 * dias seguintes e é comparado com o faturamento bruto REALMENTE importado desses dias. O "previsto" é uma
 * previsão RETROSPECTIVA recalculada de forma determinística com os dados até a origem (não uma previsão gravada
 * na época). Isto mede o erro do método NESTES dados; não prova precisão futura. Nada aqui é dinheiro disponível.
 */

/** Treino mínimo (dias) na primeira origem: 4 ciclos semanais. */
export const BACKTEST_MIN_TRAIN_DAYS = 28;
/** Passo entre origens (dias): uma semana, para cada origem cair no mesmo dia da semana. */
export const BACKTEST_STEP_DAYS = 7;
/** Dobras comuns exigidas para medir/comparar modelos (e, em `intervals`, para a faixa). */
export const MIN_COMPARABLE_FOLDS = 4;
/** Abaixo disto o app avisa que a medição de erro é instável (poucas dobras). */
const FEW_FOLDS = 8;

export interface BacktestOptions {
  /** Data-base: última data cujo faturamento realizado é conhecido; a previsão final começa no dia seguinte. */
  asOf: ISODate;
  /** Horizonte da previsão exibida = horizonte avaliado em cada dobra. */
  horizonDays: number;
  missingDays?: MissingDayPolicy;
}

export interface BacktestPoint {
  date: ISODate;
  predictedCents: bigint;
  actualCents: bigint;
  /** realizado − previsto (positivo = o modelo subestimou). */
  errorCents: bigint;
  /** true = o realizado é um dia sem venda preenchido com R$ 0. */
  filled: boolean;
}

export interface FoldDetail {
  origin: ISODate;
  evalFrom: ISODate;
  evalTo: ISODate;
  points: BacktestPoint[];
  predictedCents: bigint;
  actualCents: bigint;
  absErrorCents: bigint;
  /** Σ|erro| ÷ Σ realizado da dobra, em bps; null quando o realizado da dobra é R$ 0. */
  wapeBps: number | null;
}

export interface BacktestMetrics {
  folds: number;
  /** Pares (previsto, realizado) avaliados. Com horizonte > 7 as janelas se sobrepõem e o mesmo dia pode repetir. */
  points: number;
  absErrorSumCents: bigint;
  actualSumCents: bigint;
  /** MAE: Σ|erro| ÷ n, em centavos (meio longe do zero). */
  maeCents: bigint;
  /** WAPE: Σ|erro| ÷ Σ realizado em bps; null (indefinido) quando Σ realizado = 0. */
  wapeBps: number | null;
  wapeNote: string | null;
  /** Erro médio COM sinal (realizado − previsto), em centavos: viés do modelo no período. */
  biasCents: bigint;
}

export interface FoldSummary {
  origin: ISODate;
  trainFrom: ISODate;
  /** Sempre igual à origem: o treino NUNCA inclui o período avaliado. */
  trainTo: ISODate;
  evalFrom: ISODate;
  evalTo: ISODate;
  /** true = entra no conjunto de dobras comuns usado nas métricas. */
  comparable: boolean;
}

export interface ModelBacktest {
  id: ModelId;
  label: string;
  description: string;
  params: Record<string, number>;
  /** Elegível na data-base (previsão final existe). */
  eligible: boolean;
  reason: string | null;
  /** Previsão central na data-base (vazia se inelegível). */
  forecast: ModelPoint[];
  /** null quando o modelo não foi medido (inelegível, histórico curto, poucas dobras próprias). */
  metrics: BacktestMetrics | null;
  band: ResidualBand | null;
  folds: FoldDetail[];
  /** Por que um modelo elegível não tem erro medido; null quando medido ou inelegível. */
  backtestNote: string | null;
}

export interface BacktestComparison {
  status: 'ok' | 'insufficient';
  reason: string | null;
  comparedModels: ModelId[];
  comparableFolds: number;
  points: number;
  /** Menor erro absoluto no período avaliado (empate: o mais simples). Só com ≥ 2 modelos comparados. */
  lowestErrorModel: ModelId | null;
}

export interface BacktestReport {
  asOf: ISODate;
  horizonDays: number;
  window: TrainingWindow;
  evaluation: {
    horizonDays: number;
    minTrainDays: number;
    stepDays: number;
    firstOrigin: ISODate | null;
    lastOrigin: ISODate | null;
    evalFrom: ISODate | null;
    evalTo: ISODate | null;
  };
  folds: FoldSummary[];
  comparison: BacktestComparison;
  models: ModelBacktest[];
  warnings: string[];
}

interface RawFold {
  origin: ISODate;
  trainFrom: ISODate;
  evalFrom: ISODate;
  evalTo: ISODate;
  /** Datas avaliáveis (com realizado conhecido) e seus valores. */
  evaluable: { date: ISODate; actual: SalesPoint }[];
  models: Map<ModelId, ModelResult>;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function metricsOf(details: readonly FoldDetail[]): BacktestMetrics {
  const points = details.reduce((n, f) => n + f.points.length, 0);
  const abs = details.reduce((a, f) => a + f.absErrorCents, 0n);
  const actual = details.reduce((a, f) => a + f.actualCents, 0n);
  const signed = details.reduce((a, f) => a + f.points.reduce((b, p) => b + p.errorCents, 0n), 0n);
  return {
    folds: details.length,
    points,
    absErrorSumCents: abs,
    actualSumCents: actual,
    maeCents: divRound(abs, BigInt(points)),
    wapeBps: actual === 0n ? null : Number(divRound(abs * 10_000n, actual)),
    wapeNote: actual === 0n ? 'Indefinido: o faturamento realizado do período avaliado é R$ 0 (denominador zero).' : null,
    biasCents: divRound(signed, BigInt(points)),
  };
}

/**
 * Roda o backtesting e a previsão final. Lança RangeError para data-base/horizonte inválidos; falta de dados nunca
 * lança: devolve `comparison.status: 'insufficient'` com o motivo, sem métricas e sem faixas.
 */
export function runBacktest(sales: readonly Sale[], options: BacktestOptions): BacktestReport {
  const { asOf, horizonDays, missingDays = 'zero' } = options;
  if (!isValidISODate(asOf)) throw new RangeError(`Data-base inválida: ${JSON.stringify(asOf)}`);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > MAX_FORECAST_DAYS) {
    throw new RangeError(`Horizonte deve ser um inteiro entre 1 e ${MAX_FORECAST_DAYS} dias.`);
  }

  const final = forecastModels(sales, { cutoff: asOf, horizonDays, missingDays });
  const realizedSeries = buildTrainingSeries(sales, asOf, missingDays);
  const realized = new Map(realizedSeries.map((p) => [p.date, p] as const));
  const firstDate = realizedSeries[0]?.date;

  // dobras: origens semanais a partir de 28 dias de treino, enquanto a avaliação couber até a data-base
  const raw: RawFold[] = [];
  if (firstDate !== undefined) {
    for (let origin = addDays(firstDate, BACKTEST_MIN_TRAIN_DAYS - 1); addDays(origin, horizonDays) <= asOf; origin = addDays(origin, BACKTEST_STEP_DAYS)) {
      const evalDates = rangeAfter(origin, horizonDays);
      const run = forecastModels(sales, { cutoff: origin, horizonDays, missingDays });
      raw.push({
        origin,
        trainFrom: firstDate,
        evalFrom: evalDates[0] as ISODate,
        evalTo: evalDates[evalDates.length - 1] as ISODate,
        evaluable: evalDates.flatMap((date) => {
          const actual = realized.get(date);
          return actual ? [{ date, actual }] : [];
        }),
        models: new Map(run.models.map((m) => [m.id, m] as const)),
      });
    }
  }
  const usable = raw.filter((f) => f.evaluable.length > 0);

  const eligibleFinal = final.models.filter((m) => m.eligible).map((m) => m.id);
  const ownFolds = (id: ModelId): RawFold[] => usable.filter((f) => f.models.get(id)?.eligible);
  const candidates = eligibleFinal.filter((id) => ownFolds(id).length >= MIN_COMPARABLE_FOLDS);
  const common = usable.filter((f) => candidates.every((id) => f.models.get(id)?.eligible));

  let insufficientReason: string | null = null;
  if (eligibleFinal.length === 0) {
    insufficientReason = final.models[0]?.reason ?? 'Nenhum modelo elegível na data-base.';
  } else if (usable.length < MIN_COMPARABLE_FOLDS) {
    insufficientReason =
      usable.length === 0
        ? `Histórico de ${final.window.days} dias; são necessários ao menos ${BACKTEST_MIN_TRAIN_DAYS + horizonDays} dias (${BACKTEST_MIN_TRAIN_DAYS} de treino + horizonte de ${horizonDays}) para uma dobra de backtesting. Nenhum erro foi medido.`
        : `O histórico permite só ${plural(usable.length, 'dobra', 'dobras')} de backtesting com horizonte de ${horizonDays} dias (mínimo ${MIN_COMPARABLE_FOLDS}). Nenhum erro foi medido.`;
  } else if (candidates.length === 0 || common.length < MIN_COMPARABLE_FOLDS) {
    insufficientReason = `Os modelos elegíveis não têm ${MIN_COMPARABLE_FOLDS} dobras em comum com o horizonte de ${horizonDays} dias. Nenhum erro foi comparado.`;
  }

  const comparable = insufficientReason === null ? new Set(common.map((f) => f.origin)) : new Set<ISODate>();
  const compared = insufficientReason === null ? candidates : [];

  const detailsOf = (id: ModelId): FoldDetail[] =>
    common.map((f) => {
      const forecast = (f.models.get(id) as ModelResult).points;
      const points: BacktestPoint[] = f.evaluable.map(({ date, actual }) => {
        const predicted = (forecast.find((p) => p.date === date) as ModelPoint).centralCents;
        return {
          date,
          predictedCents: predicted,
          actualCents: actual.grossCents,
          errorCents: actual.grossCents - predicted,
          filled: actual.filled,
        };
      });
      const abs = points.reduce((a, p) => a + (p.errorCents < 0n ? -p.errorCents : p.errorCents), 0n);
      const actualSum = points.reduce((a, p) => a + p.actualCents, 0n);
      return {
        origin: f.origin,
        evalFrom: f.evalFrom,
        evalTo: f.evalTo,
        points,
        predictedCents: points.reduce((a, p) => a + p.predictedCents, 0n),
        actualCents: actualSum,
        absErrorCents: abs,
        wapeBps: actualSum === 0n ? null : Number(divRound(abs * 10_000n, actualSum)),
      };
    });

  const models: ModelBacktest[] = final.models.map((m) => {
    const isCompared = compared.includes(m.id);
    const folds = isCompared ? detailsOf(m.id) : [];
    let backtestNote: string | null = null;
    if (m.eligible && !isCompared) {
      backtestNote =
        insufficientReason ??
        `Sem erro medido: elegível em só ${plural(ownFolds(m.id).length, 'dobra', 'dobras')} de backtesting (mínimo ${MIN_COMPARABLE_FOLDS}); fica fora da comparação.`;
    }
    return {
      id: m.id,
      label: m.label,
      description: m.description,
      params: m.params,
      eligible: m.eligible,
      reason: m.reason,
      forecast: m.points,
      metrics: isCompared ? metricsOf(folds) : null,
      band: isCompared ? residualBand(folds.flatMap((f) => f.points.map((p) => p.errorCents)), folds.length) : null,
      folds,
      backtestNote,
    };
  });

  let lowestErrorModel: ModelId | null = null;
  if (compared.length >= 2) {
    lowestErrorModel = MODEL_IDS.filter((id) => compared.includes(id)).reduce((best, id) =>
      (models.find((m) => m.id === id)?.metrics?.absErrorSumCents as bigint) < (models.find((m) => m.id === best)?.metrics?.absErrorSumCents as bigint)
        ? id
        : best,
    );
  }

  const warnings: string[] = [...final.warnings];
  if (insufficientReason === null && common.length < FEW_FOLDS) {
    warnings.push(`Poucas dobras (${common.length}): a medição de erro é instável e muda bastante com novos dados.`);
  }
  if (insufficientReason === null && horizonDays > BACKTEST_STEP_DAYS) {
    warnings.push(`Com horizonte de ${horizonDays} dias as janelas avaliadas se sobrepõem: o mesmo dia aparece em mais de uma dobra.`);
  }
  if (insufficientReason === null && models.some((m) => m.metrics?.actualSumCents === 0n)) {
    warnings.push('O faturamento realizado do período avaliado é R$ 0: WAPE indefinido (denominador zero); só o MAE é calculado.');
  }

  const first = common[0];
  const last = common[common.length - 1];
  return {
    asOf,
    horizonDays,
    window: final.window,
    evaluation: {
      horizonDays,
      minTrainDays: BACKTEST_MIN_TRAIN_DAYS,
      stepDays: BACKTEST_STEP_DAYS,
      firstOrigin: insufficientReason === null && first ? first.origin : null,
      lastOrigin: insufficientReason === null && last ? last.origin : null,
      evalFrom: insufficientReason === null && first ? first.evalFrom : null,
      evalTo: insufficientReason === null && last ? last.evalTo : null,
    },
    folds: raw.map((f) => ({
      origin: f.origin,
      trainFrom: f.trainFrom,
      trainTo: f.origin,
      evalFrom: f.evalFrom,
      evalTo: f.evalTo,
      comparable: comparable.has(f.origin),
    })),
    comparison: {
      status: insufficientReason === null ? 'ok' : 'insufficient',
      reason: insufficientReason,
      comparedModels: compared,
      comparableFolds: comparable.size,
      points: insufficientReason === null ? models.find((m) => compared.includes(m.id))?.metrics?.points ?? 0 : 0,
      lowestErrorModel,
    },
    models,
    warnings,
  };
}

/**
 * Previsão final de um modelo no formato `ForecastPoint` (faturamento bruto). A faixa só existe com histórico de
 * erro suficiente; `validated` = true apenas quando o erro do modelo foi medido (não é garantia de acerto).
 */
export function toForecastPoints(report: BacktestReport, id: ModelId): ForecastPoint[] {
  const m = report.models.find((x) => x.id === id);
  if (!m || !m.eligible) return [];
  const banded = applyBand(m.forecast, m.band ?? { status: 'insufficient', reason: '', residuals: 0, folds: 0 });
  return banded.map((p) => ({
    date: p.date,
    centralCents: p.centralCents,
    lowerCents: p.lowerCents,
    upperCents: p.upperCents,
    method: id,
    trainEnd: report.window.to,
    sampleDays: report.window.days,
    isHypothesis: false,
    validated: m.metrics !== null,
    unit: 'gross_sales',
    label: m.label,
  }));
}

/** Utilitário de exibição/teste: número de dias entre duas datas de uma dobra. */
export const foldSpanDays = (f: Pick<FoldSummary, 'trainFrom' | 'trainTo'>): number => daysBetween(f.trainFrom, f.trainTo) + 1;
