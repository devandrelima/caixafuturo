import { addDays, formatBR } from '../finance/dates';
import { formatBRL } from '../finance/money';
import type { CashEntry } from '../finance/types';
import { ScenarioError } from './types';
import type { ApplierContext, ApplierOutcome, DelayReceiptAdjustment } from './types';

/**
 * Atraso de recebível (F21, ADR-0009 D6): desloca UM lançamento de entrada, em dias corridos, sem duplicá-lo.
 * Só PROPÕE a mudança de data (a partir da data original); o motor garante que cada lançamento muda uma vez.
 */

export const MAX_DELAY_DAYS = 365;

const originText = (entry: CashEntry): string => {
  switch (entry.origin) {
    case 'sale':
      return 'o repasse estimado (calculado pela regra de taxa e prazo)';
    case 'csv':
      return 'a conta importada';
    case 'recurring':
      return 'a ocorrência calculada da recorrência';
    default:
      return 'o recebimento agendado';
  }
};

export function applyDelay(adjustment: DelayReceiptAdjustment, context: ApplierContext): ApplierOutcome {
  const { entryId, days } = adjustment;
  if (typeof entryId !== 'string' || entryId.trim() === '') throw new ScenarioError('Atraso sem recebível escolhido.');
  if (!Number.isInteger(days) || days < 0 || days > MAX_DELAY_DAYS) {
    throw new ScenarioError(`Atraso inválido: use um número inteiro de dias de 0 a ${MAX_DELAY_DAYS}.`);
  }
  const label = adjustment.label ?? `Ajuste ${adjustment.id}`;
  const none = (warning: string): ApplierOutcome => ({ changes: [], assumptions: [], warnings: [`${label}: ${warning}`] });

  const entry = context.all.get(entryId);
  if (!entry) return none(`o recebível ${entryId} não existe na base; atraso ignorado.`);
  if (entry.direction !== 'in') return none(`${entryId} não é um recebível (é uma saída); atraso ignorado.`);
  if (entry.state === 'settled') return none(`${entryId} já foi liquidado e está refletido no saldo informado; atraso ignorado.`);
  if (!context.live.has(entryId)) return none(`${entryId} vence até a data-base (${formatBR(entry.dueDate)}): já está no saldo informado; atraso ignorado.`);
  if (days === 0) return none('atraso de 0 dia não muda nada.');

  const newDate = addDays(entry.dueDate, days);
  const amount = formatBRL(BigInt(entry.amountCents));
  const horizonEnd = addDays(context.snapshot.settings.baseDate, context.snapshot.horizonDays);
  const warnings: string[] = [];
  if (newDate > horizonEnd) {
    warnings.push(`${label}: ${amount} passam para ${formatBR(newDate)}, depois do horizonte de ${context.snapshot.horizonDays} dias (até ${formatBR(horizonEnd)}): o valor deixa de contar no saldo projetado.`);
  }
  return {
    changes: [{ entryId, dueDate: newDate }],
    assumptions: [
      `Hipótese: ${originText(entry)} "${entry.description}" de ${amount}, previsto para ${formatBR(entry.dueDate)}, passa a cair em ${formatBR(newDate)} (${days} dia(s) corridos, sem dias úteis nem feriados). O valor aparece uma única vez, na nova data.`,
    ],
    warnings,
  };
}
