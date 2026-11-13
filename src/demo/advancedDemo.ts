import { createBaseSnapshot } from '../domain/scenarios/engine';
import type { Adjustment, BaseSnapshot } from '../domain/scenarios/types';
import type { CashEntry } from '../domain/finance/types';
import { createScenarioDemoEntries, SCENARIO_DEMO_SALE_BASIS, SCENARIO_DEMO_SETTINGS } from './scenarioDemo';

/**
 * Base 100% FICTÍCIA das decisões avançadas da S06: a base da S05 (`scenarioDemo`, números inalterados) mais dois
 * lançamentos fictícios em dezembro, com horizonte de 90 dias (11/11/2026 → 09/02/2027). Valores esperados em
 * src/demo/__tests__/advancedDemo.test.ts, conferidos por um modelo Python independente (frações exatas).
 *
 * Saldos de fechamento da base (abertura R$ 3.000,00; mínimo R$ 1.000,00):
 *   12/11 3.000,00 · 13/11 800,00 · 14/11 2.600,00 · 15/11 2.600,00 · 16/11 3.560,10 · 17/11 2.060,10 · 18/11 3.980,30
 *   20/11 3.180,30 · 05/12 8.180,30 · 10/12 6.980,30 (e assim até 09/02/2027)
 */
export const ADVANCED_DEMO_HORIZON_DAYS = 90;

export function createAdvancedDemoEntries(): CashEntry[] {
  return [
    ...createScenarioDemoEntries(),
    { id: 'cen-conta-02', direction: 'in', amountCents: '500000', dueDate: '2026-12-05', description: 'Recebimento corporativo fictício', category: 'Recebimentos', origin: 'csv', sourceKey: 'csv:cen-conta-02', state: 'scheduled' },
    { id: 'cen-despesa-04', direction: 'out', amountCents: '120000', dueDate: '2026-12-10', description: 'Fornecedor fictício de laticínios', category: 'Fornecedores', origin: 'demo', sourceKey: 'demo:cen-despesa-04', state: 'scheduled' },
  ];
}

export function createAdvancedDemoBase(): BaseSnapshot {
  return createBaseSnapshot({ settings: SCENARIO_DEMO_SETTINGS, entries: createAdvancedDemoEntries(), saleBasis: [...SCENARIO_DEMO_SALE_BASIS], horizonDays: ADVANCED_DEMO_HORIZON_DAYS });
}

/** Uma hipótese de cada tipo (S05 + S06) para exercitar a composição na mesma Alternativa. */
export function createAdvancedDemoAdjustments(): Adjustment[] {
  return [
    { id: 'demo-atraso', kind: 'delay_receipt', entryId: 'cen-conta-01', days: 3 },
    { id: 'demo-compra', kind: 'equipment_purchase', description: 'Forno combinado', principalCents: '600000', payment: { mode: 'installments', firstDate: '2026-11-25', count: 3, monthlyRateBps: 200 } },
    { id: 'demo-contratacao', kind: 'hiring', role: 'Auxiliar de cozinha', monthlyCostCents: '180000', chargesBps: 6000, fixedMonthlyCents: '20000', payDay: 5, startDate: '2026-12-01' },
    { id: 'demo-vencimento', kind: 'shift_vendor_due', entryId: 'cen-despesa-02', newDate: '2026-11-24' },
    { id: 'demo-antecipacao', kind: 'advance_receivable', entryId: 'cen-rcv-02', advanceDate: '2026-11-13', rateBps: 200 },
  ];
}
