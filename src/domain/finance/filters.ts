import { formatBR, isValidISODate } from './dates';
import type { ProjectionResult } from './projection';
import type { CashEntry, EntryOrigin, ISODate, RiskLevel } from './types';

/**
 * Filtros e rastreio de lançamentos (S04, F29). Contrato: financeiro.md e ADR-0008.
 *
 * Filtrar é SÓ visualização: nada aqui recalcula saldo nem toca a projeção; o somatório de um filtro
 * é calculado a partir dos próprios lançamentos listados (ids).
 */

export const ORIGIN_LABELS: Record<EntryOrigin, string> = {
  manual: 'Manual',
  csv: 'CSV',
  demo: 'Demonstração',
  sale: 'Venda',
  recurring: 'Recorrente',
};
const ORIGIN_ORDER: readonly EntryOrigin[] = ['manual', 'csv', 'demo', 'sale', 'recurring'];

export interface EntryFilter {
  /** Vencimento inicial (inclusivo); '' = sem limite. */
  from: ISODate | '';
  /** Vencimento final (inclusivo); '' = sem limite. */
  to: ISODate | '';
  /** null = todas; '' = sem categoria; senão, categoria exata. */
  category: string | null;
  origin: EntryOrigin | null;
}

export const EMPTY_FILTER: EntryFilter = { from: '', to: '', category: null, origin: null };

export const isFilterActive = (filter: EntryFilter): boolean => filter.from !== '' || filter.to !== '' || filter.category !== null || filter.origin !== null;

/** Mensagem de erro do filtro (data inválida ou período invertido), ou null. */
export function filterError(filter: EntryFilter): string | null {
  if (filter.from !== '' && !isValidISODate(filter.from)) return 'Data inicial inválida.';
  if (filter.to !== '' && !isValidISODate(filter.to)) return 'Data final inválida.';
  if (filter.from !== '' && filter.to !== '' && filter.from > filter.to) return 'A data inicial é posterior à data final; nenhum lançamento pode atender a esse período.';
  return null;
}

/** Subconjunto dos lançamentos que atende a TODOS os critérios ativos. Não muta a entrada. */
export function applyFilter(entries: readonly CashEntry[], filter: EntryFilter): CashEntry[] {
  return entries.filter(
    (entry) =>
      (filter.from === '' || entry.dueDate >= filter.from) &&
      (filter.to === '' || entry.dueDate <= filter.to) &&
      (filter.category === null || entry.category === filter.category) &&
      (filter.origin === null || entry.origin === filter.origin),
  );
}

export interface EntriesSummary {
  count: number;
  /** IDs dos lançamentos somados, na ordem recebida. */
  ids: string[];
  incomingCents: bigint;
  outgoingCents: bigint;
  netCents: bigint;
  /** Quantos dos listados já estão liquidados (não entram no saldo projetado). */
  settledCount: number;
}

export function summarizeEntries(entries: readonly CashEntry[]): EntriesSummary {
  let incoming = 0n;
  let outgoing = 0n;
  let settledCount = 0;
  for (const entry of entries) {
    const cents = BigInt(entry.amountCents);
    if (entry.direction === 'in') incoming += cents;
    else outgoing += cents;
    if (entry.state === 'settled') settledCount += 1;
  }
  return { count: entries.length, ids: entries.map((e) => e.id), incomingCents: incoming, outgoingCents: outgoing, netCents: incoming - outgoing, settledCount };
}

export interface CategoryOption {
  value: string;
  label: string;
}

/** Categorias presentes (ordem alfabética pt-BR); "Sem categoria" por último. */
export function categoriesOf(entries: readonly CashEntry[]): CategoryOption[] {
  const named = [...new Set(entries.map((e) => e.category).filter((c) => c !== ''))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const options = named.map((value) => ({ value, label: value }));
  if (entries.some((e) => e.category === '')) options.push({ value: '', label: 'Sem categoria' });
  return options;
}

export function originsOf(entries: readonly CashEntry[]): EntryOrigin[] {
  const present = new Set(entries.map((e) => e.origin));
  return ORIGIN_ORDER.filter((o) => present.has(o));
}

/** Critérios ativos em texto (o estado do filtro nunca depende só de cor). */
export function describeFilter(filter: EntryFilter): string[] {
  const parts: string[] = [];
  if (filter.from !== '' && filter.to !== '') parts.push(`Período: ${formatBR(filter.from)} a ${formatBR(filter.to)}`);
  else if (filter.from !== '') parts.push(`Período: a partir de ${formatBR(filter.from)}`);
  else if (filter.to !== '') parts.push(`Período: até ${formatBR(filter.to)}`);
  if (filter.category !== null) parts.push(`Categoria: ${filter.category === '' ? 'Sem categoria' : filter.category}`);
  if (filter.origin !== null) parts.push(`Origem: ${ORIGIN_LABELS[filter.origin]}`);
  return parts;
}

export type EntryTrace =
  | { kind: 'in_projection'; date: ISODate; closingCents: bigint; risk: RiskLevel }
  | { kind: 'settled' }
  | { kind: 'before_base_date' }
  | { kind: 'beyond_horizon' }
  | { kind: 'duplicate'; duplicateOf: string }
  | { kind: 'not_counted' };

/** Onde (e se) o lançamento entra no saldo: a resposta vem do próprio resultado do motor. */
export function traceEntry(entry: CashEntry, result: ProjectionResult): EntryTrace {
  if (entry.state === 'settled') return { kind: 'settled' };
  const point = result.points.find((p) => p.entryIds.includes(entry.id));
  if (point) return { kind: 'in_projection', date: point.date, closingCents: point.closingCents, risk: point.risk };
  const duplicate = result.duplicates.find((d) => d.entryId === entry.id);
  if (duplicate) return { kind: 'duplicate', duplicateOf: duplicate.duplicateOf };
  if (result.flagged.some((f) => f.entryId === entry.id)) return { kind: 'before_base_date' };
  const last = result.points[result.points.length - 1];
  if (last && entry.dueDate > last.date) return { kind: 'beyond_horizon' };
  return { kind: 'not_counted' };
}
