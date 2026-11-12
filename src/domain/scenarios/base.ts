import type { CashEntry, CashSettings } from '../finance/types';
import type { ReceivableView, SettlementRules } from '../sales/types';
import { createBaseSnapshot } from './engine';
import type { BaseSnapshot, SaleBasis } from './types';

export interface ScenarioBaseInput {
  settings: CashSettings;
  /** Os MESMOS lançamentos que alimentam o `project()` do app (contas + repasses derivados + recorrências). */
  entries: readonly CashEntry[];
  /** Visões de conciliação: só os repasses `derived` que contam no saldo viram base de venda. */
  receivables: readonly ReceivableView[];
  rules: SettlementRules;
  horizonDays?: number;
}

/**
 * Fotografia imutável do que o app projeta hoje, mais o bruto e o custo de cada repasse derivado de venda
 * (necessários para o choque de vendas recalcular o líquido pela regra da ADR-0006). Nunca inclui previsão.
 */
export function buildScenarioBase(input: ScenarioBaseInput): BaseSnapshot {
  const ids = new Set(input.entries.map((e) => e.id));
  const saleBasis: SaleBasis[] = input.receivables
    .filter((view) => view.status === 'derived' && view.counts && ids.has(view.receivable.id))
    .map((view) => {
      const rule = input.rules[view.receivable.method];
      return { entryId: view.receivable.id, saleDate: view.receivable.saleDate, grossCents: view.receivable.grossCents.toString(), costBps: rule.feeBps + rule.commissionBps };
    });
  return createBaseSnapshot({ settings: input.settings, entries: input.entries, saleBasis, horizonDays: input.horizonDays });
}
