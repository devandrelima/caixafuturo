import type { CashEntry, CashSettings } from '../domain/finance/types';

/** Dados 100% FICTÍCIOS de um restaurante inventado. Fonte: docs/especificacao/contratos/demo-s01.md. */
export const DEMO_BASE_DATE = '2026-11-11';

export interface DemoDataset {
  settings: CashSettings;
  entries: CashEntry[];
}

const demoEntry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string, description: string, category: string): CashEntry => ({
  id,
  direction,
  amountCents,
  dueDate,
  description,
  category,
  origin: 'demo',
  sourceKey: `demo:${id}`,
  state: 'scheduled',
});

/** Gera o conjunto determinístico; cada chamada devolve objetos novos e independentes. */
export function createRestaurantDemo(): DemoDataset {
  return {
    settings: { baseDate: DEMO_BASE_DATE, openingBalanceCents: '300000', minimumBalanceCents: '100000' },
    entries: [
      demoEntry('demo-despesa-01', 'out', '250000', '2026-11-12', 'Fornecedor fictício de alimentos', 'Fornecedores'),
      demoEntry('demo-receita-01', 'in', '80000', '2026-11-13', 'Recebimento agendado fictício', 'Recebimentos'),
      demoEntry('demo-despesa-02', 'out', '200000', '2026-11-14', 'Aluguel fictício', 'Aluguel'),
      demoEntry('demo-receita-02', 'in', '400000', '2026-11-15', 'Recebimento agendado fictício', 'Recebimentos'),
    ],
  };
}
