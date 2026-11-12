import { previewSalesCsv } from '../domain/sales/importSales';
import { addDays, formatBR } from '../domain/finance/dates';
import { weekdayOf } from '../domain/forecast/baseline';
import { formatBRL } from '../domain/finance/money';
import type { PaymentMethod, Sale } from '../domain/sales/types';

/** Vendas 100% FICTÍCIAS do restaurante inventado da demonstração (28 dias, 3 meios por dia). */
export const SALES_DEMO_FIRST_DAY = '2026-10-15'; // quinta-feira
export const SALES_DEMO_LAST_DAY = '2026-11-11'; // quarta-feira (data-base da demonstração)

/** Valor bruto em reais por dia da semana (0 = domingo). */
export const SALES_DEMO_BY_WEEKDAY: Record<Extract<PaymentMethod, 'pix' | 'debit' | 'credit'>, readonly number[]> = {
  pix: [250, 120, 100, 110, 130, 200, 300],
  debit: [180, 80, 70, 75, 90, 150, 220],
  credit: [330, 150, 130, 140, 160, 260, 400],
};
export const SALES_DEMO_SLUG = { pix: 'pix', debit: 'debito', credit: 'credito' } as const;
export const SALES_DEMO_LABEL = { pix: 'pix', debit: 'débito', credit: 'crédito' } as const;


export interface SalesDemo {
  /** CSV equivalente (mesmo formato que o usuário importa). */
  csv: string;
  sales: Sale[];
}

export function createSalesDemo(): SalesDemo {
  const rows = ['identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria'];
  for (let i = 0; i < 28; i += 1) {
    const date = addDays(SALES_DEMO_FIRST_DAY, i);
    for (const method of ['pix', 'debit', 'credit'] as const) {
      const cents = BigInt((SALES_DEMO_BY_WEEKDAY[method][weekdayOf(date)] as number) * 100);
      const value = formatBRL(cents).replace('R$ ', '');
      rows.push(`D-${date.replace(/-/g, '')}-${SALES_DEMO_SLUG[method]};${formatBR(date)};${value};${SALES_DEMO_LABEL[method]};Salão`);
    }
  }
  const csv = rows.join('\n');
  return { csv, sales: previewSalesCsv(csv).valid.map((v) => v.sale) };
}
