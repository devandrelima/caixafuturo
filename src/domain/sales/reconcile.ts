import { daysBetween } from '../finance/dates';
import type { CashEntry, ISODate } from '../finance/types';
import { centsFromString } from '../finance/money';
import { deriveReceivables, receivableToEntry } from './settlement';
import type {
  DerivedReceivable,
  EntryLinkKind,
  EntryView,
  ReceivableStatus,
  ReceivableView,
  ReconciliationDecision,
  Sale,
  SettlementRules,
} from './types';

/**
 * Conciliação entre contas importadas (CSV de contas) e recebíveis derivados de vendas — ADR-0006.
 * Função PURA do estado atual: o resultado não depende da ordem de importação. Nunca vincula por valor+data;
 * só por `saleReference` ou por decisão humana. Importado > derivado: um derivado coberto nunca soma.
 */

/** Conta importada sem referência a ≤ este nº de dias de um derivado torna o derivado pendente. */
export const PENDING_WINDOW_DAYS = 3;

export interface ReconcileInput {
  baseDate: ISODate;
  sales: readonly Sale[];
  rules: SettlementRules;
  entries: readonly CashEntry[];
  decisions: readonly ReconciliationDecision[];
}

export interface ReconcileResult {
  receivables: ReceivableView[];
  entryViews: EntryView[];
  /** Entradas para `project()`: todas as contas armazenadas + derivados em estado `derived`. */
  projectionEntries: CashEntry[];
  /** Decisões que não se aplicam mais (conta/venda inexistente, já coberta ou conta reutilizada). */
  staleDecisions: ReconciliationDecision[];
  summary: Record<ReceivableStatus, number>;
}

const REASONS: Record<ReceivableStatus, string> = {
  derived: 'Estimativa calculada da venda; entra no saldo na data de repasse.',
  reconciled: 'Conciliado com uma conta importada; vale o valor importado e a estimativa não é somada.',
  pending: 'Conciliação pendente: há conta importada sem referência por perto. Só a importada entra no saldo até você decidir.',
  covered_batch: 'Venda em lote (várias vendas em uma conta): não suportado. Vale a conta importada; esta estimativa fica fora do saldo.',
  covered_installments: 'Venda parcelada (várias contas para uma venda): não suportado. Valem as contas importadas; esta estimativa fica fora do saldo.',
  before_base_date: 'Repasse até a data-base: já está no saldo informado.',
  zero_net: 'Líquido zero após taxas: nada a receber.',
};

function refsOf(entry: CashEntry): string[] {
  if (entry.direction !== 'in' || !entry.saleReference) return [];
  return [...new Set(entry.saleReference.split('|').map((r) => r.trim()).filter((r) => r !== ''))];
}

const idOf = (d: ReconciliationDecision): string => (d.kind === 'same' ? d.saleId : d.entryId);

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { baseDate, entries } = input;
  const derived = deriveReceivables(input.sales, input.rules);
  const bySaleKey = new Map<string, DerivedReceivable>(derived.map((d) => [d.saleKey, d]));
  const bySaleId = new Map<string, DerivedReceivable>(derived.map((d) => [d.saleId, d]));
  const entryById = new Map<string, CashEntry>(entries.map((e) => [e.id, e]));

  // 1. Cobertura por referência explícita.
  const coverage = new Map<string, Set<string>>(); // saleId → ids das contas que cobrem
  const batchSales = new Set<string>();
  const entryRefSales = new Map<string, string[]>(); // entryId → saleIds existentes referenciados
  const orphan = new Set<string>();
  for (const e of entries) {
    const refs = refsOf(e);
    if (refs.length === 0) continue;
    const saleIds = refs.map((r) => bySaleKey.get(`sale:${r}`)).filter((d): d is DerivedReceivable => d !== undefined).map((d) => d.saleId);
    entryRefSales.set(e.id, saleIds);
    if (saleIds.length === 0) orphan.add(e.id);
    for (const saleId of saleIds) {
      const set = coverage.get(saleId) ?? new Set<string>();
      set.add(e.id);
      coverage.set(saleId, set);
      if (refs.length > 1) batchSales.add(saleId);
    }
  }

  // 2. Decisões humanas (válidas ou obsoletas). "same" primeiro, em ordem estável.
  const stale: ReconciliationDecision[] = [];
  const usedEntries = new Set<string>();
  const standalone = new Set<string>();
  const ordered = [...input.decisions].sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'same' ? -1 : 1) || idOf(a).localeCompare(idOf(b)),
  );
  for (const d of ordered) {
    const entry = entryById.get(d.entryId);
    const hasRef = entry ? refsOf(entry).length > 0 : false;
    if (!entry || entry.direction !== 'in' || hasRef || usedEntries.has(d.entryId) || standalone.has(d.entryId)) {
      stale.push(d);
      continue;
    }
    if (d.kind === 'same') {
      if (!bySaleId.has(d.saleId) || coverage.has(d.saleId)) {
        stale.push(d);
        continue;
      }
      coverage.set(d.saleId, new Set([d.entryId]));
      usedEntries.add(d.entryId);
    } else {
      standalone.add(d.entryId);
    }
  }

  // 3. Contas candidatas a gerar pendência: entrada agendada, sem referência, não avulsa e não usada em par.
  const unlinked = entries.filter(
    (e) => e.direction === 'in' && e.state === 'scheduled' && refsOf(e).length === 0 && !standalone.has(e.id) && !usedEntries.has(e.id),
  );

  // 4. Estado de cada recebível derivado.
  const pendingByEntry = new Map<string, string[]>();
  const receivables: ReceivableView[] = derived.map((rcv) => {
    const cover = coverage.get(rcv.saleId);
    let status: ReceivableStatus;
    let entryIds: string[] = [];
    let differenceCents: bigint | null = null;
    if (cover && cover.size > 0) {
      entryIds = [...cover].sort();
      status = batchSales.has(rcv.saleId) ? 'covered_batch' : cover.size >= 2 ? 'covered_installments' : 'reconciled';
      if (status === 'reconciled') {
        const only = entryById.get(entryIds[0] as string) as CashEntry;
        differenceCents = centsFromString(only.amountCents) - rcv.netCents;
      }
    } else if (rcv.netCents <= 0n) {
      status = 'zero_net';
    } else if (rcv.dueDate <= baseDate) {
      status = 'before_base_date';
    } else {
      const near = unlinked.filter((e) => Math.abs(daysBetween(e.dueDate, rcv.dueDate)) <= PENDING_WINDOW_DAYS);
      if (near.length > 0) {
        status = 'pending';
        entryIds = near.map((e) => e.id).sort();
        for (const id of entryIds) pendingByEntry.set(id, [...(pendingByEntry.get(id) ?? []), rcv.saleId]);
      } else {
        status = 'derived';
      }
    }
    return { receivable: rcv, status, counts: status === 'derived', entryIds, differenceCents, reason: REASONS[status] };
  });

  // 5. Visão de cada conta importada.
  const coverSize = (saleId: string) => coverage.get(saleId)?.size ?? 0;
  const entryViews: EntryView[] = entries
    .map((e): EntryView => {
      const refs = refsOf(e);
      let link: EntryLinkKind = 'imported';
      let saleIds: string[] = [];
      let reason = 'Conta importada ou manual, sem vínculo com vendas.';
      if (usedEntries.has(e.id)) {
        link = 'reconciled';
        saleIds = [...coverage.entries()].filter(([, set]) => set.has(e.id)).map(([saleId]) => saleId);
        reason = 'Conciliada por decisão sua com o repasse de uma venda.';
      } else if (standalone.has(e.id)) {
        link = 'standalone';
        reason = 'Marcada por você como independente de vendas.';
      } else if (refs.length > 0) {
        saleIds = entryRefSales.get(e.id) ?? [];
        if (orphan.has(e.id)) {
          link = 'orphan_reference';
          reason = 'Referencia uma venda que ainda não foi importada; vale normalmente e vincula quando a venda chegar.';
        } else if (refs.length > 1) {
          link = 'batch';
          reason = 'Lote (várias vendas): não suportado; vale esta conta e as estimativas das vendas ficam fora do saldo.';
        } else if (saleIds.every((id) => coverSize(id) >= 2)) {
          link = 'installments';
          reason = 'Parcelas (várias contas para uma venda): não suportado; valem as contas importadas.';
        } else {
          link = 'reconciled';
          reason = 'Conciliada com o repasse da venda referenciada; vale o valor desta conta.';
        }
      }
      return { entryId: e.id, link, saleIds, pendingSaleIds: pendingByEntry.get(e.id) ?? [], reason };
    })
    .sort((a, b) => a.entryId.localeCompare(b.entryId));

  const summary = Object.fromEntries(
    (Object.keys(REASONS) as ReceivableStatus[]).map((s) => [s, receivables.filter((r) => r.status === s).length]),
  ) as Record<ReceivableStatus, number>;

  return {
    receivables,
    entryViews,
    projectionEntries: [...entries, ...receivables.filter((r) => r.counts).map((r) => receivableToEntry(r.receivable))],
    staleDecisions: stale,
    summary,
  };
}
