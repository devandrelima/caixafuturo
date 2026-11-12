import { sha256Hex } from '../import/sha256';
import { addDays, daysBetween, isValidISODate } from './dates';
import type { CashEntry, Direction, ISODate } from './types';

/**
 * Recorrências (S04). Contrato: docs/especificacao/contratos/financeiro.md e ADR-0008.
 *
 * Persiste-se a REGRA; as ocorrências são CALCULADAS por função pura (mesmo princípio da ADR-0006) e
 * chegam ao motor como CashEntry comuns (`origin: 'recurring'`). Nada aqui lê relógio, grava ou muta
 * entradas. Dinheiro em centavos (string), datas civis ISO, aritmética só com inteiros.
 */

export const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const MAX_DESCRIPTION = 200;
export const MAX_CATEGORY = 100;
/** Maior janela de expansão aceita (dias). Protege contra laços enormes; o horizonte real é de 91 dias. */
export const MAX_WINDOW_DAYS = 3660;

export interface RecurrenceRule {
  id: string;
  direction: Direction;
  /** Magnitude positiva em centavos inteiros (string decimal). */
  amountCents: string;
  description: string;
  category: string;
  frequency: Frequency;
  /** Primeira ocorrência e âncora do dia do mês (inclusiva). */
  startDate: ISODate;
  /** Última data possível (inclusiva). Ausente = sem fim. */
  endDate?: ISODate;
  /** Ocorrências individuais excluídas (a regra segue valendo nas demais datas). */
  skippedDates?: ISODate[];
}

export type CoverReason = 'materialized' | 'equivalent';

/** Ocorrência que NÃO foi gerada porque já existe lançamento real que a cobre (nunca é silencioso). */
export interface CoveredOccurrence {
  ruleId: string;
  date: ISODate;
  sourceKey: string;
  reason: CoverReason;
  entryId: string;
}

export interface InvalidRule {
  ruleId: string;
  errors: string[];
}

export interface ExpansionResult {
  entries: CashEntry[];
  covered: CoveredOccurrence[];
  invalidRules: InvalidRule[];
}

export interface Window {
  /** Primeiro dia (inclusivo); normalmente data-base + 1. */
  from: ISODate;
  /** Último dia (inclusivo). */
  to: ISODate;
}

const CENTS_PATTERN = /^[1-9]\d*$/;

export function validateRule(rule: RecurrenceRule): string[] {
  const errors: string[] = [];
  if (typeof rule.id !== 'string' || rule.id.trim() === '') errors.push('Identificador da regra obrigatório.');
  if (rule.direction !== 'in' && rule.direction !== 'out') errors.push('Direção inválida: use receita ou despesa.');
  if (typeof rule.amountCents !== 'string' || !CENTS_PATTERN.test(rule.amountCents)) errors.push('Valor inválido: use centavos inteiros maiores que zero.');
  const description = typeof rule.description === 'string' ? rule.description.trim() : '';
  if (description === '') errors.push('Descrição obrigatória.');
  else if (description.length > MAX_DESCRIPTION) errors.push(`Descrição muito longa (máximo ${MAX_DESCRIPTION} caracteres).`);
  if (typeof rule.category === 'string' && rule.category.trim().length > MAX_CATEGORY) errors.push(`Categoria muito longa (máximo ${MAX_CATEGORY} caracteres).`);
  if (!FREQUENCIES.includes(rule.frequency)) errors.push('Periodicidade inválida: use semanal, quinzenal, mensal ou anual.');
  const startOk = typeof rule.startDate === 'string' && isValidISODate(rule.startDate);
  if (!startOk) errors.push('Data inicial inválida.');
  if (rule.endDate !== undefined) {
    if (typeof rule.endDate !== 'string' || !isValidISODate(rule.endDate)) errors.push('Data final inválida.');
    else if (startOk && rule.endDate < rule.startDate) errors.push('A data final não pode ser anterior à data inicial.');
  }
  if (rule.skippedDates !== undefined && (!Array.isArray(rule.skippedDates) || rule.skippedDates.some((d) => typeof d !== 'string' || !isValidISODate(d)))) {
    errors.push('Há data excluída inválida.');
  }
  return errors;
}

export function recurrenceSourceKey(ruleId: string, date: ISODate): string {
  return `rec:${ruleId}:${date}`;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const lastDayOfMonth = (y: number, m: number): number => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);
const iso = (y: number, m: number, d: number): ISODate => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

function split(date: ISODate): { y: number; m: number; d: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) };
}

/** n-ésima ocorrência (n = 0 é a data inicial). Mensal/anual preservam a âncora do dia (ADR-0008 D3). */
function nthOccurrence(rule: RecurrenceRule, n: number): ISODate {
  const start = split(rule.startDate);
  switch (rule.frequency) {
    case 'weekly':
      return addDays(rule.startDate, 7 * n);
    case 'biweekly':
      return addDays(rule.startDate, 14 * n);
    case 'monthly': {
      const index = start.y * 12 + (start.m - 1) + n;
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      return iso(y, m, Math.min(start.d, lastDayOfMonth(y, m)));
    }
    case 'yearly': {
      const y = start.y + n;
      return iso(y, start.m, Math.min(start.d, lastDayOfMonth(y, start.m)));
    }
  }
}

/** Menor n que PODE já alcançar `from` (conservador: nunca passa da primeira ocorrência dentro da janela). */
function firstCandidate(rule: RecurrenceRule, from: ISODate): number {
  if (from <= rule.startDate) return 0;
  const start = split(rule.startDate);
  const target = split(from);
  switch (rule.frequency) {
    case 'weekly':
      return Math.max(0, Math.floor(daysBetween(rule.startDate, from) / 7) - 1);
    case 'biweekly':
      return Math.max(0, Math.floor(daysBetween(rule.startDate, from) / 14) - 1);
    case 'monthly':
      return Math.max(0, target.y * 12 + target.m - (start.y * 12 + start.m) - 1);
    case 'yearly':
      return Math.max(0, target.y - start.y - 1);
  }
}

/**
 * Datas das ocorrências de uma regra dentro de [from, to], respeitando início/fim inclusivos e as
 * datas excluídas. Ordenadas e sem repetição. Lança RangeError se a janela passar de MAX_WINDOW_DAYS.
 */
export function occurrenceDates(rule: RecurrenceRule, from: ISODate, to: ISODate): ISODate[] {
  if (to < from) return [];
  if (daysBetween(from, to) > MAX_WINDOW_DAYS) throw new RangeError(`Janela maior que ${MAX_WINDOW_DAYS} dias.`);
  const skipped = new Set(rule.skippedDates ?? []);
  const result: ISODate[] = [];
  const upper = rule.endDate !== undefined && rule.endDate < to ? rule.endDate : to;
  for (let n = firstCandidate(rule, from); ; n += 1) {
    const date = nthOccurrence(rule, n);
    if (date > upper) break;
    if (date >= from && date >= rule.startDate && !skipped.has(date)) result.push(date);
  }
  return result;
}

/** Ocorrência como lançamento. Também é o que a UI grava ao liquidar/editar uma ocorrência (mesma sourceKey). */
export function occurrenceEntry(rule: RecurrenceRule, date: ISODate): CashEntry {
  const sourceKey = recurrenceSourceKey(rule.id, date);
  return {
    id: `rec_${sha256Hex(sourceKey).slice(0, 20)}`,
    direction: rule.direction,
    amountCents: rule.amountCents,
    dueDate: date,
    description: rule.description,
    category: rule.category,
    origin: 'recurring',
    sourceKey,
    state: 'scheduled',
  };
}

// Mesma normalização do importador de contas (src/domain/import/csv.ts), para que "equivalente" signifique o mesmo.
const normalizeText = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
const canonicalCents = (s: string): string => (/^\d+$/.test(s) ? BigInt(s).toString() : s);
const signature = (direction: Direction, dueDate: ISODate, amountCents: string, description: string): string =>
  [direction, dueDate, canonicalCents(amountCents), normalizeText(description)].join('\u001f');

const byDateThenKey = (a: { date: ISODate; sourceKey: string }, b: { date: ISODate; sourceKey: string }): number =>
  a.date.localeCompare(b.date) || a.sourceKey.localeCompare(b.sourceKey);

/**
 * Calcula as ocorrências ainda NÃO materializadas na janela. `existing` são os lançamentos reais (de
 * qualquer origem e estado): um com a mesma sourceKey, ou equivalente (direção, vencimento, valor e
 * descrição normalizada), suprime a ocorrência e é informado em `covered`. Não muta nada.
 */
export function expandRecurrences(rules: readonly RecurrenceRule[], existing: readonly CashEntry[], window: Window): ExpansionResult {
  const byKey = new Map<string, CashEntry>();
  const bySignature = new Map<string, CashEntry>();
  for (const entry of [...existing].sort((a, b) => a.id.localeCompare(b.id))) {
    if (entry.sourceKey && !byKey.has(entry.sourceKey)) byKey.set(entry.sourceKey, entry);
    const sig = signature(entry.direction, entry.dueDate, entry.amountCents, entry.description);
    if (!bySignature.has(sig)) bySignature.set(sig, entry);
  }

  const entries: CashEntry[] = [];
  const covered: CoveredOccurrence[] = [];
  const invalidRules: InvalidRule[] = [];
  const seenRules = new Set<string>();

  for (const rule of rules) {
    const errors = validateRule(rule);
    if (errors.length > 0) {
      invalidRules.push({ ruleId: rule.id, errors });
      continue;
    }
    if (seenRules.has(rule.id)) continue;
    seenRules.add(rule.id);

    for (const date of occurrenceDates(rule, window.from, window.to)) {
      const sourceKey = recurrenceSourceKey(rule.id, date);
      const same = byKey.get(sourceKey);
      if (same) {
        covered.push({ ruleId: rule.id, date, sourceKey, reason: 'materialized', entryId: same.id });
        continue;
      }
      const equivalent = bySignature.get(signature(rule.direction, date, rule.amountCents, rule.description));
      if (equivalent) {
        covered.push({ ruleId: rule.id, date, sourceKey, reason: 'equivalent', entryId: equivalent.id });
        continue;
      }
      entries.push(occurrenceEntry(rule, date));
    }
  }

  entries.sort((a, b) => byDateThenKey({ date: a.dueDate, sourceKey: a.sourceKey }, { date: b.dueDate, sourceKey: b.sourceKey }));
  covered.sort(byDateThenKey);
  return { entries, covered, invalidRules };
}
