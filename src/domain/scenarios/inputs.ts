import { formatBR } from '../finance/dates';
import { formatBRL } from '../finance/money';
import type { CashEntry } from '../finance/types';
import { bpsText, MAX_FACTOR_BPS } from './shocks';
import type { Adjustment } from './types';

/** "80" → 8000; "80,5" → 8050; "120,25%" → 12025. Só vírgula decimal, até 2 casas, sem ponto flutuante; `maxBps` é inclusivo. */
export function parsePercentBpsUpTo(text: string, maxBps: number): { ok: true; bps: number } | { ok: false; reason: string } {
  const match = /^\s*(\d{1,4})(?:,(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return { ok: false, reason: 'Informe um percentual como 80 ou 80,5 (use vírgula).' };
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  if (bps > maxBps) return { ok: false, reason: `O percentual máximo é ${bpsText(maxBps)}.` };
  return { ok: true, bps };
}

/** Percentual de choque (S05): até MAX_FACTOR_BPS. */
export const parsePercentBps = (text: string): { ok: true; bps: number } | { ok: false; reason: string } => parsePercentBpsUpTo(text, MAX_FACTOR_BPS);

/** Inteiro simples (só dígitos) dentro de [min, max], inclusivo. */
export function parseIntegerText(text: string, min: number, max: number): { ok: true; value: number } | { ok: false; reason: string } {
  const match = /^\s*(\d{1,6})\s*$/.exec(text);
  const value = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(value) || value < min || value > max) return { ok: false, reason: `Informe um número inteiro de ${min} a ${max}.` };
  return { ok: true, value };
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
    case 'equipment_purchase': {
      const what = `"${adjustment.description}" (${formatBRL(BigInt(adjustment.principalCents))})`;
      const p = adjustment.payment;
      if (p.mode === 'cash') return `Hipótese de compra: ${what} à vista em ${formatBR(p.date)}`;
      if (p.mode === 'deferred') return `Hipótese de compra: ${what} adiada para ${formatBR(p.date)}, com encargo único de ${bpsText(p.chargeBps)}`;
      return `Hipótese de compra: ${what} em ${p.count} parcelas a partir de ${formatBR(p.firstDate)}, juros de ${bpsText(p.monthlyRateBps)} ao mês`;
    }
    case 'hiring': {
      const extras =
        adjustment.chargesBps === undefined && adjustment.fixedMonthlyCents === undefined
          ? 'encargos e outros custos não informados'
          : [adjustment.chargesBps === undefined ? null : `encargos de ${bpsText(adjustment.chargesBps)}`, adjustment.fixedMonthlyCents === undefined ? null : `custos fixos de ${formatBRL(BigInt(adjustment.fixedMonthlyCents))}`].filter((x) => x !== null).join(' e ') + ' informados';
      const until = adjustment.endDate === undefined ? '' : ` até ${formatBR(adjustment.endDate)}`;
      return `Hipótese de contratação: "${adjustment.role}", ${formatBRL(BigInt(adjustment.monthlyCostCents))} por mês (${extras}), a partir de ${formatBR(adjustment.startDate)}${until}, pagamento no dia ${adjustment.payDay}`;
    }
    case 'shift_vendor_due': {
      const entry = entries.get(adjustment.entryId);
      return entry
        ? `Hipótese de novo vencimento: "${entry.description}" (${formatBRL(BigInt(entry.amountCents))}) de ${formatBR(entry.dueDate)} para ${formatBR(adjustment.newDate)}`
        : `Hipótese de novo vencimento: ${adjustment.entryId} para ${formatBR(adjustment.newDate)}`;
    }
    case 'advance_receivable': {
      const entry = entries.get(adjustment.entryId);
      const what = entry ? `"${entry.description}" (${formatBRL(BigInt(entry.amountCents))}, ${formatBR(entry.dueDate)})` : adjustment.entryId;
      return `Hipótese de antecipação: ${what} para ${formatBR(adjustment.advanceDate)}, taxa informada de ${bpsText(adjustment.rateBps)} ao mês`;
    }
  }
}
