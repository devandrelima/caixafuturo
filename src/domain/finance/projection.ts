import { addDays, isValidISODate, rangeAfter } from './dates';
import { centsFromString } from './money';
import { classifyRisk, firstNegativePoint, firstRiskPoint, lowestPoint, shortfallCents } from './risk';
import type { CashEntry, CashSettings, DailyPoint, ISODate } from './types';

export const DEFAULT_HORIZON_DAYS = 30;

export class ProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionError';
  }
}

export interface ProjectionOptions {
  horizonDays?: number;
}

export interface FlaggedEntry {
  entryId: string;
  /** Agendado com vencimento até a data-base: já deveria estar refletido no saldo inicial. */
  reason: 'on_or_before_base_date';
}

export interface DuplicateEntry {
  entryId: string;
  sourceKey: string;
  /** Já contado por outro lançamento com o mesmo id ou chave de origem. */
  duplicateOf: string;
}

export interface ProjectionSummary {
  baseDate: ISODate;
  openingCents: bigint;
  endingCents: bigint;
  lowest: DailyPoint;
  firstRisk: DailyPoint | null;
  firstNegative: DailyPoint | null;
  riskDays: number;
  totalIncomingCents: bigint;
  totalOutgoingCents: bigint;
  /** Lançamentos agendados e válidos com vencimento depois do horizonte. */
  beyondHorizon: number;
}

export interface ProjectionResult {
  points: DailyPoint[];
  summary: ProjectionSummary;
  flagged: FlaggedEntry[];
  duplicates: DuplicateEntry[];
}

interface ParsedSettings {
  baseDate: ISODate;
  opening: bigint;
  minimum: bigint;
}

function parseSettings(settings: CashSettings): ParsedSettings {
  if (!isValidISODate(settings.baseDate)) throw new ProjectionError(`Data-base inválida: ${settings.baseDate}`);
  let opening: bigint;
  let minimum: bigint;
  try {
    opening = centsFromString(settings.openingBalanceCents);
    minimum = centsFromString(settings.minimumBalanceCents);
  } catch (error) {
    throw new ProjectionError(error instanceof Error ? error.message : 'Configuração inválida.');
  }
  if (minimum < 0n) throw new ProjectionError('O saldo mínimo não pode ser negativo.');
  return { baseDate: settings.baseDate, opening, minimum };
}

interface ParsedEntry {
  entry: CashEntry;
  cents: bigint;
}

function parseEntry(entry: CashEntry): ParsedEntry {
  const label = `Lançamento ${entry.id}`;
  if (entry.direction !== 'in' && entry.direction !== 'out') throw new ProjectionError(`${label}: direção inválida.`);
  if (entry.state !== 'scheduled' && entry.state !== 'settled') throw new ProjectionError(`${label}: estado inválido.`);
  if (!isValidISODate(entry.dueDate)) throw new ProjectionError(`${label}: vencimento inválido (${entry.dueDate}).`);
  let cents: bigint;
  try {
    cents = centsFromString(entry.amountCents);
  } catch {
    throw new ProjectionError(`${label}: valor em centavos inválido.`);
  }
  if (cents <= 0n) throw new ProjectionError(`${label}: o valor deve ser maior que zero.`);
  return { entry, cents };
}

function compareParsed(a: ParsedEntry, b: ParsedEntry): number {
  const ea = a.entry;
  const eb = b.entry;
  return (
    ea.dueDate.localeCompare(eb.dueDate) ||
    ea.id.localeCompare(eb.id) ||
    ea.direction.localeCompare(eb.direction) ||
    ea.amountCents.localeCompare(eb.amountCents) ||
    ea.sourceKey.localeCompare(eb.sourceKey)
  );
}

/**
 * Projeção determinística do caixa. Função pura: não lê relógio, não grava e não muta entradas.
 * Fechamento do dia = abertura + recebimentos agendados − pagamentos agendados; a abertura do dia
 * seguinte é o fechamento anterior. O saldo inicial é a fotografia ao FINAL da data-base.
 */
export function project(settings: CashSettings, entries: readonly CashEntry[], options: ProjectionOptions = {}): ProjectionResult {
  const horizon = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  if (!Number.isInteger(horizon) || horizon < 1) throw new ProjectionError('Horizonte deve ser um inteiro positivo.');
  const { baseDate, opening, minimum } = parseSettings(settings);
  const lastDate = addDays(baseDate, horizon);

  // Valida todos (dado corrompido não passa em silêncio) e ordena de forma canônica.
  const parsed = entries.map(parseEntry).sort(compareParsed);

  const flagged: FlaggedEntry[] = [];
  const duplicates: DuplicateEntry[] = [];
  const seenIds = new Map<string, string>();
  const seenKeys = new Map<string, string>();
  const byDate = new Map<ISODate, ParsedEntry[]>();
  let beyondHorizon = 0;

  for (const item of parsed) {
    const { entry } = item;
    if (entry.state === 'settled') continue; // já refletido no saldo; nunca somado outra vez

    const dupOf = seenIds.get(entry.id) ?? (entry.sourceKey ? seenKeys.get(entry.sourceKey) : undefined);
    if (dupOf !== undefined) {
      duplicates.push({ entryId: entry.id, sourceKey: entry.sourceKey, duplicateOf: dupOf });
      continue;
    }
    seenIds.set(entry.id, entry.id);
    if (entry.sourceKey) seenKeys.set(entry.sourceKey, entry.id);

    if (entry.dueDate <= baseDate) {
      flagged.push({ entryId: entry.id, reason: 'on_or_before_base_date' });
    } else if (entry.dueDate > lastDate) {
      beyondHorizon += 1;
    } else {
      const bucket = byDate.get(entry.dueDate);
      if (bucket) bucket.push(item);
      else byDate.set(entry.dueDate, [item]);
    }
  }

  const points: DailyPoint[] = [];
  let previousClosing = opening;
  let totalIncoming = 0n;
  let totalOutgoing = 0n;

  for (const date of rangeAfter(baseDate, horizon)) {
    let incoming = 0n;
    let outgoing = 0n;
    const ids: string[] = [];
    for (const { entry, cents } of byDate.get(date) ?? []) {
      if (entry.direction === 'in') incoming += cents;
      else outgoing += cents;
      ids.push(entry.id);
    }
    const closing = previousClosing + incoming - outgoing;
    points.push({
      date,
      openingCents: previousClosing,
      incomingCents: incoming,
      outgoingCents: outgoing,
      closingCents: closing,
      entryIds: ids.sort(),
      risk: classifyRisk(closing, minimum),
      shortfallCents: shortfallCents(closing, minimum),
    });
    totalIncoming += incoming;
    totalOutgoing += outgoing;
    previousClosing = closing;
  }

  return {
    points,
    flagged,
    duplicates,
    summary: {
      baseDate,
      openingCents: opening,
      endingCents: previousClosing,
      lowest: lowestPoint(points),
      firstRisk: firstRiskPoint(points),
      firstNegative: firstNegativePoint(points),
      riskDays: points.filter((p) => p.risk !== 'ok').length,
      totalIncomingCents: totalIncoming,
      totalOutgoingCents: totalOutgoing,
      beyondHorizon,
    },
  };
}
