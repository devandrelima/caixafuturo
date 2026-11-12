import { formatBR } from '../finance/dates';
import { formatBRL } from '../finance/money';
import type { CashEntry } from '../finance/types';
import { bpsText, MAX_FACTOR_BPS } from './shocks';
import type { Adjustment } from './types';

/** "80" → 8000; "80,5" → 8050; "120,25%" → 12025. Só vírgula decimal, até 2 casas, sem ponto flutuante. */
export function parsePercentBps(text: string): { ok: true; bps: number } | { ok: false; reason: string } {
  const match = /^\s*(\d{1,4})(?:,(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return { ok: false, reason: 'Informe um percentual como 80 ou 80,5 (use vírgula).' };
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  if (bps > MAX_FACTOR_BPS) return { ok: false, reason: `O percentual máximo é ${bpsText(MAX_FACTOR_BPS)}.` };
  return { ok: true, bps };
}

/** Frase curta de uma hipótese, para a lista de hipóteses ativas e para os avisos do motor. */
export function describeAdjustment(adjustment: Adjustment, entries: ReadonlyMap<string, CashEntry>): string {
  switch (adjustment.kind) {
    case 'delay_receipt': {
      const entry = entries.get(adjustment.entryId);
      const what = entry ? `"${entry.description}" (${formatBRL(BigInt(entry.amountCents))}, ${formatBR(entry.dueDate)})` : adjustment.entryId;
      return `Atrasar ${what} em ${adjustment.days} dia${adjustment.days === 1 ? '' : 's'}`;
    }
    case 'scale_sales':
    case 'scale_expense': {
      const what = adjustment.kind === 'scale_sales' ? 'repasses de vendas' : adjustment.category === undefined ? 'despesas' : `despesas de "${adjustment.category === '' ? 'Sem categoria' : adjustment.category}"`;
      const how = adjustment.change.mode === 'factor' ? `ficam em ${bpsText(adjustment.change.factorBps)}` : `variam ${formatBRL(BigInt(adjustment.change.deltaCents))} por lançamento`;
      return `${what[0]?.toUpperCase()}${what.slice(1)} de ${formatBR(adjustment.from)} a ${formatBR(adjustment.to)} ${how}`;
    }
    default:
      return `Ajuste ${adjustment.id}`;
  }
}
