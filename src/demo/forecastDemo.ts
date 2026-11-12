import { addDays, formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import { weekdayOf } from '../domain/forecast/baseline';
import { previewSalesCsv } from '../domain/sales/importSales';
import type { Sale } from '../domain/sales/types';
import { SALES_DEMO_BY_WEEKDAY, SALES_DEMO_FIRST_DAY, SALES_DEMO_LABEL, SALES_DEMO_SLUG } from './salesDemo';

/**
 * Histórico 100% FICTÍCIO de 12 semanas (84 dias corridos) para demonstrar sazonalidade, backtesting e faixas.
 * Determinístico (sem aleatoriedade). As 4 últimas semanas são IDÊNTICAS à demonstração da S02 (`createSalesDemo`):
 * mesmos ids e valores, então importar as duas não duplica nada e os números da S02 não mudam.
 * As 8 semanas anteriores usam a mesma tabela por dia da semana, com um fator semanal (crescimento suave), um
 * evento (sábado vendendo 3×) e uma lacuna (segunda-feira sem nenhuma venda).
 */
export const FORECAST_DEMO_FIRST_DAY = '2026-08-20'; // quinta-feira
export const FORECAST_DEMO_LAST_DAY = '2026-11-11'; // quarta-feira (data-base da demonstração)
/** Sábado do evento: vendas 3× o normal. */
export const FORECAST_DEMO_OUTLIER_DAY = '2026-09-12';
/** Segunda-feira sem nenhuma venda registrada (lacuna). */
export const FORECAST_DEMO_GAP_DAY = '2026-09-28';

/** Fator semanal (milésimos) das 8 semanas anteriores à demonstração da S02, da mais antiga à mais recente. */
const WEEK_FACTORS_PERMILLE: readonly number[] = [900, 920, 950, 930, 970, 990, 1000, 1010];
const EVENT_MULTIPLIER = 3;
const TOTAL_DAYS = 84;

export interface ForecastDemo {
  /** CSV equivalente (mesmo formato que o usuário importa). */
  csv: string;
  sales: Sale[];
}

export function createForecastDemo(): ForecastDemo {
  const rows = ['identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria'];
  for (let i = 0; i < TOTAL_DAYS; i += 1) {
    const date = addDays(FORECAST_DEMO_FIRST_DAY, i);
    if (date === FORECAST_DEMO_GAP_DAY) continue;
    const prior = date < SALES_DEMO_FIRST_DAY;
    const factor = prior ? (WEEK_FACTORS_PERMILLE[Math.floor(i / 7)] as number) : 1000;
    const multiplier = date === FORECAST_DEMO_OUTLIER_DAY ? EVENT_MULTIPLIER : 1;
    for (const method of ['pix', 'debit', 'credit'] as const) {
      const reais = SALES_DEMO_BY_WEEKDAY[method][weekdayOf(date)] as number;
      // reais × fator / 1000 em reais = reais × fator / 10 em centavos (todos os fatores são múltiplos de 10)
      const cents = BigInt((reais * factor * multiplier) / 10);
      const value = formatBRL(cents).replace('R$ ', '');
      rows.push(`D-${date.replace(/-/g, '')}-${SALES_DEMO_SLUG[method]};${formatBR(date)};${value};${SALES_DEMO_LABEL[method]};Salão`);
    }
  }
  const csv = rows.join('\n');
  return { csv, sales: previewSalesCsv(csv).valid.map((v) => v.sale) };
}
