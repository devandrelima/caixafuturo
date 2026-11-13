import { addDays, daysBetween, formatBR, isValidISODate } from '../finance/dates';
import { formatBRL } from '../finance/money';
import { ScenarioError } from './types';
import type { ApplierContext, ApplierOutcome, ShiftVendorDueAdjustment } from './types';

/**
 * Vencimento de fornecedor (F25, ADR-0010 D4): muda só a DATA de uma saída agendada, mantendo o valor. Só PROPÕE
 * a mudança (a partir do vencimento original); o motor guarda a trilha "de → para" e impede mudança dupla.
 * Nada é renegociado, solicitado nem comunicado ao fornecedor.
 */

const plural = (n: number): string => `${n} dia${n === 1 ? '' : 's'}`;

export function applyShiftVendorDue(adjustment: ShiftVendorDueAdjustment, context: ApplierContext): ApplierOutcome {
  const { entryId, newDate } = adjustment;
  if (typeof entryId !== 'string' || entryId.trim() === '') throw new ScenarioError('Vencimento sem a conta escolhida.');
  if (!isValidISODate(newDate)) throw new ScenarioError('Informe uma nova data de vencimento válida.');
  const label = adjustment.label ?? `Ajuste ${adjustment.id}`;
  const none = (warning: string): ApplierOutcome => ({ changes: [], assumptions: [], warnings: [`${label}: ${warning}`] });
  const { baseDate } = context.snapshot.settings;

  const entry = context.all.get(entryId);
  if (!entry) return none(`a conta ${entryId} não existe na base; mudança de vencimento ignorada.`);
  if (entry.direction !== 'out') return none(`${entryId} não é uma saída (é um recebimento); mudança de vencimento ignorada.`);
  if (entry.state === 'settled') return none(`${entryId} já foi liquidada e está refletida no saldo informado; mudança de vencimento ignorada.`);
  if (!context.live.has(entryId)) return none(`${entryId} vence até a data-base (${formatBR(entry.dueDate)}): já está no saldo informado; mudança de vencimento ignorada.`);
  if (newDate === entry.dueDate) return none(`a nova data é a mesma data (${formatBR(newDate)}); nada muda.`);
  if (newDate <= baseDate) return none(`a nova data (${formatBR(newDate)}) é até a data-base (${formatBR(baseDate)}), quando o saldo informado já vale; mudança ignorada. Use uma data depois da data-base.`);

  const amount = formatBRL(BigInt(entry.amountCents));
  const gap = daysBetween(entry.dueDate, newDate);
  const how = gap > 0 ? `${plural(gap)} depois` : `${plural(-gap)} antes`;
  const horizonEnd = addDays(baseDate, context.snapshot.horizonDays);
  const warnings: string[] = [];
  if (newDate > horizonEnd) {
    warnings.push(`${label}: ${amount} passam para ${formatBR(newDate)}, depois do horizonte de ${context.snapshot.horizonDays} dias (até ${formatBR(horizonEnd)}): o valor deixa de pesar no saldo projetado, mas continua devido.`);
  }
  return {
    changes: [{ entryId, dueDate: newDate }],
    assumptions: [
      `Hipótese: o vencimento de "${entry.description}" (${amount}) muda de ${formatBR(entry.dueDate)} para ${formatBR(newDate)} (${how}); o valor continua ${amount} e só a data muda. Nada é renegociado, solicitado ou comunicado ao fornecedor, e eventuais juros e multas de uma renegociação real não estão incluídos.`,
    ],
    warnings,
  };
}
