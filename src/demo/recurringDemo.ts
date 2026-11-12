import { occurrenceEntry } from '../domain/finance/recurrence';
import type { RecurrenceRule } from '../domain/finance/recurrence';
import type { CashEntry } from '../domain/finance/types';

/**
 * Recorrências 100% FICTÍCIAS para a demonstração (data-base 11/11/2026, a mesma do restaurante inventado).
 * Valores esperados calculados à mão em src/demo/__tests__/recurringDemo.test.ts. Não altera
 * `createRestaurantDemo`, `createSalesDemo` nem `createForecastDemo`.
 */
export interface RecurringDemo {
  rules: RecurrenceRule[];
  /** Ocorrência já liquidada/gravada: a regra não a altera nem a duplica. */
  entries: CashEntry[];
}

export function createRecurringDemo(): RecurringDemo {
  const rules: RecurrenceRule[] = [
    // Dia 31: cai no último dia dos meses curtos e volta ao 31 depois (âncora preservada).
    { id: 'demo-rec-condominio', direction: 'out', amountCents: '180000', description: 'Condomínio fictício (dia 31)', category: 'Fixas', frequency: 'monthly', startDate: '2026-01-31' },
    // Semanal: segundas-feiras.
    { id: 'demo-rec-fornecedor', direction: 'out', amountCents: '35000', description: 'Fornecedor semanal fictício', category: 'Fornecedores', frequency: 'weekly', startDate: '2026-11-02' },
    // Com data final (inclusiva): termina em 15/12/2026.
    { id: 'demo-rec-eventos', direction: 'in', amountCents: '120000', description: 'Contrato de eventos fictício (até 15/12)', category: 'Recebimentos', frequency: 'monthly', startDate: '2026-09-15', endDate: '2026-12-15' },
    // A ocorrência de 20/11 já foi paga (por R$ 580,00, não R$ 600,00): fica como lançamento real liquidado.
    { id: 'demo-rec-seguro', direction: 'out', amountCents: '60000', description: 'Seguro fictício', category: 'Fixas', frequency: 'monthly', startDate: '2026-10-20' },
  ];
  const seguro = rules[3] as RecurrenceRule;
  const paid: CashEntry = { ...occurrenceEntry(seguro, '2026-11-20'), amountCents: '58000', state: 'settled', settledAt: '2026-11-11' };
  return { rules, entries: [paid] };
}
