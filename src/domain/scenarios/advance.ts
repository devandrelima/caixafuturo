import { daysBetween, formatBR, isValidISODate } from '../finance/dates';
import { formatBRL } from '../finance/money';
import { bpsText } from './shocks';
import { ScenarioError } from './types';
import type { AdvanceReceivableAdjustment, ApplierContext, ApplierOutcome } from './types';

/**
 * Antecipação de recebíveis (F26, ADR-0010 D2): o recebível futuro SAI da data original e o valor líquido
 * (bruto − custo) ENTRA na data antecipada, nunca os dois. O custo é a taxa INFORMADA, proporcional a dias/30,
 * em inteiros e meio-sobe. Só propõe a retirada e a criação; nada é solicitado, contratado nem gravado.
 */

export const MAX_ADVANCE_RATE_BPS = 2_000;
const DAYS_PER_MONTH = 30n;

/** custo = meio-sobe(bruto × taxaBps × dias / (10 000 × 30)), sem ponto flutuante. */
export function advanceCost(grossCents: bigint, monthlyRateBps: number, days: number): bigint {
  const denominator = 10_000n * DAYS_PER_MONTH;
  return (grossCents * BigInt(monthlyRateBps) * BigInt(days) * 2n + denominator) / (denominator * 2n);
}

const plural = (n: number): string => `${n} dia${n === 1 ? '' : 's'}`;

export function applyAdvanceReceivable(adjustment: AdvanceReceivableAdjustment, context: ApplierContext): ApplierOutcome {
  const { entryId, advanceDate, rateBps } = adjustment;
  if (typeof entryId !== 'string' || entryId.trim() === '') throw new ScenarioError('Antecipação sem o recebimento escolhido.');
  if (!isValidISODate(advanceDate)) throw new ScenarioError('Informe uma data de antecipação válida.');
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > MAX_ADVANCE_RATE_BPS) {
    throw new ScenarioError(`A taxa ao mês deve ser inteira em bps, de 0 a ${MAX_ADVANCE_RATE_BPS} (100 bps = 1% ao mês).`);
  }
  const label = adjustment.label ?? `Ajuste ${adjustment.id}`;
  const none = (warning: string): ApplierOutcome => ({ changes: [], assumptions: [], warnings: [`${label}: ${warning}`] });
  const { baseDate } = context.snapshot.settings;

  const entry = context.all.get(entryId);
  if (!entry) return none(`o recebimento ${entryId} não existe na base; antecipação ignorada.`);
  if (entry.direction !== 'in') return none(`${entryId} não é um recebimento (é uma saída); antecipação ignorada.`);
  if (entry.state === 'settled') return none(`${entryId} já foi liquidado e está refletido no saldo informado; antecipação ignorada.`);
  if (!context.live.has(entryId)) return none(`${entryId} vence até a data-base (${formatBR(entry.dueDate)}): já está no saldo informado; antecipação ignorada.`);
  if (advanceDate <= baseDate || advanceDate >= entry.dueDate) {
    return none(`a data da antecipação (${formatBR(advanceDate)}) precisa ser depois da data-base (${formatBR(baseDate)}) e antes do vencimento (${formatBR(entry.dueDate)}); antecipação ignorada.`);
  }

  const gross = BigInt(entry.amountCents);
  const days = daysBetween(advanceDate, entry.dueDate);
  const cost = advanceCost(gross, rateBps, days);
  const net = gross - cost;
  if (net <= 0n) return none(`o custo (${formatBRL(cost)}) é igual ou maior que o valor do recebimento (${formatBRL(gross)}); antecipação ignorada. Reduza a taxa ou a antecipação.`);

  const costBps = Number((cost * 10_000n * 2n + gross) / (gross * 2n));
  const sale = entry.origin === 'sale' ? ' Este é um repasse estimado de venda: o valor já é o líquido da taxa da venda, e o custo da antecipação vem além dela.' : '';
  return {
    changes: [{ entryId, remove: true }],
    additions: [
      {
        direction: 'in',
        amountCents: net.toString(),
        dueDate: advanceDate,
        description: `Antecipação (hipótese): ${entry.description}`,
        category: entry.category,
        ...(entry.linkedSaleId !== undefined ? { linkedSaleId: entry.linkedSaleId } : {}),
        dependsOn: entryId,
      },
    ],
    assumptions: [
      `Hipótese: o recebimento "${entry.description}" de ${formatBRL(gross)}, previsto para ${formatBR(entry.dueDate)}, é antecipado para ${formatBR(advanceDate)} (${plural(days)} antes), com taxa informada de ${bpsText(rateBps)} ao mês, proporcional a ${days}/30 do mês: custo ${formatBRL(cost)} (${bpsText(costBps)} do valor) e valor líquido ${formatBRL(net)}, que entra em ${formatBR(advanceDate)} e o original deixa de contar em ${formatBR(entry.dueDate)} (nunca os dois).${sale} Hipótese: nada foi solicitado ou contratado; o custo é só o que você informou e tributos e condições reais podem diferir.`,
    ],
    warnings: [],
  };
}
