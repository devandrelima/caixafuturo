import { addDays, compareISO } from '../finance/dates';
import { centsFromString } from '../finance/money';
import type { CashEntry } from '../finance/types';
import { PAYMENT_METHODS } from './types';
import type { DerivedReceivable, PaymentMethod, Sale, SettlementRule, SettlementRules } from './types';

/**
 * Regra de repasse (ADR-0006, D1): líquido = bruto − arredondar_meio_sobe(bruto × (taxa+comissão)/10000);
 * data = data da venda + prazo em dias corridos. Funções puras; nada é gravado.
 */

export const MAX_LAG_DAYS = 365;

/** Valores ILUSTRATIVOS e editáveis, não fatos de mercado: cada negócio deve configurar os seus. */
export const DEFAULT_SETTLEMENT_RULES: SettlementRules = {
  pix: { method: 'pix', feeBps: 99, commissionBps: 0, lagDays: 0 },
  debit: { method: 'debit', feeBps: 199, commissionBps: 0, lagDays: 1 },
  credit: { method: 'credit', feeBps: 399, commissionBps: 0, lagDays: 30 },
  voucher: { method: 'voucher', feeBps: 500, commissionBps: 0, lagDays: 30 },
  cash: { method: 'cash', feeBps: 0, commissionBps: 0, lagDays: 0 },
};

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Retorna a primeira mensagem de erro ou null se todas as regras forem válidas. */
export function validateRules(rules: SettlementRules): string | null {
  for (const method of PAYMENT_METHODS) {
    const r = rules[method];
    if (!r) return `Regra ausente para ${method}.`;
    if (!isInt(r.feeBps) || r.feeBps < 0 || r.feeBps > 10_000) return `Taxa inválida em ${method}: use 0% a 100%.`;
    if (!isInt(r.commissionBps) || r.commissionBps < 0 || r.commissionBps > 10_000) return `Comissão inválida em ${method}: use 0% a 100%.`;
    if (r.feeBps + r.commissionBps > 10_000) return `Taxa + comissão em ${method} passam de 100%.`;
    if (!isInt(r.lagDays) || r.lagDays < 0 || r.lagDays > MAX_LAG_DAYS) return `Prazo inválido em ${method}: use 0 a ${MAX_LAG_DAYS} dias.`;
  }
  return null;
}

/** Taxa e líquido de uma venda, em centavos exatos. */
export function netOf(grossCents: bigint, rule: SettlementRule): { feeCents: bigint; netCents: bigint } {
  const bps = BigInt(rule.feeBps + rule.commissionBps);
  const feeCents = (grossCents * bps * 2n + 10_000n) / 20_000n; // meio sobe
  return { feeCents, netCents: grossCents - feeCents };
}

/** Um recebível líquido por venda, em ordem de data e id. */
export function deriveReceivables(sales: readonly Sale[], rules: SettlementRules): DerivedReceivable[] {
  const out: DerivedReceivable[] = sales.map((sale) => {
    const rule = rules[sale.method as PaymentMethod];
    const gross = centsFromString(sale.grossCents);
    const { feeCents, netCents } = netOf(gross, rule);
    return {
      id: `rcv_${sale.id.slice('sale_'.length)}`,
      saleId: sale.id,
      saleKey: sale.saleKey,
      externalId: sale.externalId,
      method: sale.method,
      saleDate: sale.saleDate,
      grossCents: gross,
      feeCents,
      netCents,
      dueDate: addDays(sale.saleDate, rule.lagDays),
    };
  });
  return out.sort((a, b) => compareISO(a.dueDate, b.dueDate) || a.id.localeCompare(b.id));
}

/** Lançamento comum para o motor de projeção (`project`), sem alterá-lo. */
export function receivableToEntry(r: DerivedReceivable): CashEntry {
  return {
    id: r.id,
    direction: 'in',
    amountCents: r.netCents.toString(),
    dueDate: r.dueDate,
    description: `Repasse estimado da venda ${r.externalId}`,
    category: '',
    origin: 'sale',
    sourceKey: `sale-settlement:${r.saleId}`,
    state: 'scheduled',
    linkedSaleId: r.saleId,
  };
}
