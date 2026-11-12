import { addDays, daysBetween } from './dates';
import { project, type ProjectionResult } from './projection';
import type { CashEntry, CashSettings, DailyPoint, ISODate, RiskLevel } from './types';

/**
 * Visão semanal de até 13 semanas (S04). Contrato: financeiro.md e ADR-0008 D9.
 *
 * NÃO existe fórmula de saldo aqui: a visão só AGREGA os pontos diários do mesmo `project()` e confere
 * que eles fecham a conta. O saldo de cada semana é, exatamente, o fechamento diário do seu último dia.
 */

export const WEEKLY_MAX_WEEKS = 13;

export const WEEKLY_UNCERTAINTY_NOTE =
  'A incerteza cresce com o horizonte: quanto mais distante a semana, mais o saldo depende de lançamentos ainda não confirmados, de datas que podem mudar e de repasses calculados por regra.';

export const WEEKLY_PREMISES: readonly string[] = [
  'Lançamentos agendados (inclui recorrências calculadas pela regra).',
  'Repasses derivados das vendas, pela regra de taxa e prazo configurada.',
  'Nunca entram previsão de faturamento nem hipóteses manuais.',
];

export class WeeklyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeeklyError';
  }
}

export interface WeekSummary {
  /** 1 = semana que contém a data-base + 1. */
  index: number;
  /** Segunda-feira da semana de calendário (pode ser anterior ao primeiro dia coberto na semana 1). */
  weekStart: ISODate;
  /** Primeiro e último dia COBERTOS pela projeção nesta semana. */
  startDate: ISODate;
  endDate: ISODate;
  days: number;
  /** Menos de 7 dias (só a 1ª semana, ou o recorte de um horizonte curto). */
  partial: boolean;
  openingCents: bigint;
  incomingCents: bigint;
  outgoingCents: bigint;
  /** = fechamento diário do último dia da semana. */
  closingCents: bigint;
  /** Pior fechamento diário da semana: o saldo final pode estar ok mesmo com um dia negativo no meio. */
  lowestClosingCents: bigint;
  lowestDate: ISODate;
  /** Pior risco entre os dias da semana. */
  risk: RiskLevel;
  riskDays: number;
  worstShortfallCents: bigint;
  entryIds: string[];
}

export interface WeeklyView {
  weeks: WeekSummary[];
  totalIncomingCents: bigint;
  totalOutgoingCents: bigint;
  /** Lançamentos agendados válidos depois do último dia coberto (não entram em nenhuma semana). */
  beyondHorizon: number;
  uncertaintyNote: string;
  premises: readonly string[];
}

// 5/1/1970 foi uma segunda-feira.
const MONDAY_ANCHOR = '1970-01-05';

/** Segunda-feira da semana (segunda a domingo) que contém a data. */
export function weekStartOf(date: ISODate): ISODate {
  const dow = ((daysBetween(MONDAY_ANCHOR, date) % 7) + 7) % 7;
  return addDays(date, -dow);
}

function assertWeeks(weeks: number): void {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > WEEKLY_MAX_WEEKS) {
    throw new RangeError(`O número de semanas deve ser um inteiro de 1 a ${WEEKLY_MAX_WEEKS}.`);
  }
}

/** Dias a pedir ao motor para cobrir `weeks` semanas: até o domingo da última (no máximo 91). */
export function weeklyHorizonDays(baseDate: ISODate, weeks: number = WEEKLY_MAX_WEEKS): number {
  assertWeeks(weeks);
  const lastDay = addDays(weekStartOf(addDays(baseDate, 1)), 7 * weeks - 1);
  return daysBetween(baseDate, lastDay);
}

const RISK_RANK: Record<RiskLevel, number> = { ok: 0, below_minimum: 1, negative: 2 };

export interface AggregateOptions {
  maxWeeks?: number;
  beyondHorizon?: number;
}

/**
 * Agrega pontos diários consecutivos (a partir de baseDate + 1) em semanas segunda–domingo.
 * Pontos depois da última semana permitida são ignorados. Lança WeeklyError se os pontos não forem
 * consecutivos ou não fecharem a conta (dado corrompido não passa em silêncio).
 */
export function aggregateWeekly(points: readonly DailyPoint[], baseDate: ISODate, options: AggregateOptions = {}): WeeklyView {
  const maxWeeks = options.maxWeeks ?? WEEKLY_MAX_WEEKS;
  assertWeeks(maxWeeks);

  const weeks: WeekSummary[] = [];
  let current: WeekSummary | null = null;
  let previous: DailyPoint | null = null;

  for (const point of points) {
    const expectedDate = previous ? addDays(previous.date, 1) : addDays(baseDate, 1);
    if (point.date !== expectedDate) throw new WeeklyError(`Pontos diários não consecutivos: esperado ${expectedDate}, recebido ${point.date}.`);
    if (point.closingCents !== point.openingCents + point.incomingCents - point.outgoingCents) {
      throw new WeeklyError(`O ponto de ${point.date} não fecha: fechamento ≠ abertura + entradas − saídas.`);
    }
    if (previous && point.openingCents !== previous.closingCents) {
      throw new WeeklyError(`A abertura de ${point.date} não é o fechamento do dia anterior.`);
    }
    previous = point;

    const weekStart = weekStartOf(point.date);
    if (!current || current.weekStart !== weekStart) {
      if (weeks.length >= maxWeeks) break; // corte: o restante está além da última semana
      current = {
        index: weeks.length + 1,
        weekStart,
        startDate: point.date,
        endDate: point.date,
        days: 0,
        partial: false,
        openingCents: point.openingCents,
        incomingCents: 0n,
        outgoingCents: 0n,
        closingCents: point.closingCents,
        lowestClosingCents: point.closingCents,
        lowestDate: point.date,
        risk: 'ok',
        riskDays: 0,
        worstShortfallCents: 0n,
        entryIds: [],
      };
      weeks.push(current);
    }

    current.endDate = point.date;
    current.days += 1;
    current.incomingCents += point.incomingCents;
    current.outgoingCents += point.outgoingCents;
    current.closingCents = point.closingCents;
    if (point.closingCents < current.lowestClosingCents) {
      current.lowestClosingCents = point.closingCents;
      current.lowestDate = point.date;
    }
    if (RISK_RANK[point.risk] > RISK_RANK[current.risk]) current.risk = point.risk;
    if (point.risk !== 'ok') current.riskDays += 1;
    if (point.shortfallCents > current.worstShortfallCents) current.worstShortfallCents = point.shortfallCents;
    current.entryIds.push(...point.entryIds);
  }

  for (const week of weeks) {
    week.partial = week.days < 7;
    week.entryIds.sort();
  }

  return {
    weeks,
    totalIncomingCents: weeks.reduce((sum, w) => sum + w.incomingCents, 0n),
    totalOutgoingCents: weeks.reduce((sum, w) => sum + w.outgoingCents, 0n),
    beyondHorizon: options.beyondHorizon ?? 0,
    uncertaintyNote: WEEKLY_UNCERTAINTY_NOTE,
    premises: WEEKLY_PREMISES,
  };
}

export interface WeeklyProjection {
  projection: ProjectionResult;
  weekly: WeeklyView;
}

/** Roda o MESMO `project()` pelo horizonte das semanas pedidas e agrega o resultado. */
export function projectWeekly(settings: CashSettings, entries: readonly CashEntry[], options: { weeks?: number } = {}): WeeklyProjection {
  const weeks = options.weeks ?? WEEKLY_MAX_WEEKS;
  const projection = project(settings, entries, { horizonDays: weeklyHorizonDays(settings.baseDate, weeks) });
  const weekly = aggregateWeekly(projection.points, settings.baseDate, { maxWeeks: weeks, beyondHorizon: projection.summary.beyondHorizon });
  return { projection, weekly };
}
