import { createBaseSnapshot } from '../domain/scenarios/engine';
import type { BaseSnapshot, SaleBasis } from '../domain/scenarios/types';
import type { CashEntry, CashSettings } from '../domain/finance/types';

/**
 * Base 100% FICTÍCIA do simulador (restaurante inventado, data-base 11/11/2026), com valores calculados À MÃO em
 * src/demo/__tests__/scenarioDemo.test.ts. Não altera `createRestaurantDemo`, `createSalesDemo`,
 * `createForecastDemo` nem `createRecurringDemo`.
 *
 * Saldos de fechamento da base (abertura R$ 3.000,00; mínimo R$ 1.000,00):
 *   12/11 3.000,00 · 13/11 800,00 (abaixo do mínimo) · 14/11 2.600,00 · 15/11 2.600,00 · 16/11 3.560,10
 *   17/11 2.060,10 · 18/11 3.980,30 · 19/11 3.980,30 · 20/11 3.180,30 (e assim até 11/12)
 */
export const SCENARIO_DEMO_SETTINGS: CashSettings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };

const e = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string, description: string, category: string, extra: Partial<CashEntry> = {}): CashEntry => ({
  id, direction, amountCents, dueDate, description, category, origin: 'demo', sourceKey: `demo:${id}`, state: 'scheduled', ...extra,
});

export function createScenarioDemoEntries(): CashEntry[] {
  return [
    e('cen-despesa-01', 'out', '220000', '2026-11-13', 'Fornecedor fictício de carnes', 'Fornecedores'),
    e('cen-conta-01', 'in', '180000', '2026-11-14', 'Evento corporativo fictício', 'Recebimentos', { origin: 'csv', sourceKey: 'csv:cen-conta-01' }),
    // Repasses derivados de venda: bruto R$ 1.000,00 e R$ 2.000,00, custo 3,99% (399 bps), meio-sobe.
    e('cen-rcv-01', 'in', '96010', '2026-11-16', 'Repasse estimado da venda CEN-1', '', { origin: 'sale', sourceKey: 'sale-settlement:sale_cen1', linkedSaleId: 'sale_cen1' }),
    e('cen-despesa-02', 'out', '150000', '2026-11-17', 'Aluguel fictício', 'Fixas'),
    e('cen-rcv-02', 'in', '192020', '2026-11-18', 'Repasse estimado da venda CEN-2', '', { origin: 'sale', sourceKey: 'sale-settlement:sale_cen2', linkedSaleId: 'sale_cen2' }),
    e('cen-despesa-03', 'out', '80000', '2026-11-20', 'Fornecedor fictício de bebidas', 'Fornecedores'),
  ];
}

export const SCENARIO_DEMO_SALE_BASIS: readonly SaleBasis[] = [
  { entryId: 'cen-rcv-01', saleDate: '2026-11-02', grossCents: '100000', costBps: 399 },
  { entryId: 'cen-rcv-02', saleDate: '2026-11-04', grossCents: '200000', costBps: 399 },
];

export function createScenarioDemoBase(): BaseSnapshot {
  return createBaseSnapshot({ settings: SCENARIO_DEMO_SETTINGS, entries: createScenarioDemoEntries(), saleBasis: [...SCENARIO_DEMO_SALE_BASIS] });
}
