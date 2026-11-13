import { addDays, formatBR, isValidISODate } from '../finance/dates';
import { centsFromString, formatBRL } from '../finance/money';
import { monthlyDate } from './calendar';
import { bpsText, roundHalfUpBps } from './shocks';
import { ScenarioError } from './types';
import type { ApplierContext, ApplierOutcome, EntryAddition, EquipmentPayment, EquipmentPurchaseAdjustment } from './types';

/**
 * Compra de equipamento (F23, ADR-0010 D1): à vista, adiada ou parcelada. Tudo em centavos inteiros (BigInt) e
 * basis points inteiros; sem ponto flutuante. Só PROPÕE lançamentos hipotéticos de saída: nenhum pagamento real.
 */

export const MAX_INSTALLMENTS = 60;
export const MIN_INSTALLMENTS = 2;
export const MAX_MONTHLY_RATE_BPS = 2_000;
export const MAX_DEFERRED_CHARGE_BPS = 10_000;

export interface Installment {
  number: number;
  dueDate: string;
  /** Valor pago nesta data (principal amortizado + juros). */
  amountCents: bigint;
  interestCents: bigint;
  principalCents: bigint;
  /** Saldo devedor depois desta parcela. */
  balanceCents: bigint;
}

export interface PaymentPlan {
  principalCents: bigint;
  /** Σ parcelas − principal (juros/encargos). */
  chargesCents: bigint;
  totalCents: bigint;
  installments: Installment[];
}

/** Meio-sobe de uma fração positiva num/den, sem float. */
const roundHalfUpDiv = (num: bigint, den: bigint): bigint => (num * 2n + den) / (den * 2n);

/**
 * Parcela igual (tabela Price): PMT = P·r·(1+r)^n / ((1+r)^n − 1), r = bps/10 000. Fração exata em BigInt,
 * arredondada meio-sobe UMA vez. Com taxa 0, PMT = P/n meio-sobe.
 */
export function priceInstallment(principalCents: bigint, count: number, monthlyRateBps: number): bigint {
  if (monthlyRateBps === 0) return roundHalfUpDiv(principalCents, BigInt(count));
  const growth = (10_000n + BigInt(monthlyRateBps)) ** BigInt(count);
  const base = 10_000n ** BigInt(count);
  return roundHalfUpDiv(principalCents * BigInt(monthlyRateBps) * growth, 10_000n * (growth - base));
}

const tooSmall = (count: number): ScenarioError => new ScenarioError(`O valor é pequeno demais para ${count} parcelas: cada parcela ficaria abaixo de R$ 0,01. Use menos parcelas ou um valor maior.`);

function validateDate(date: string, what: string): void {
  if (!isValidISODate(date)) throw new ScenarioError(`${what}: informe uma data válida.`);
}

function single(principal: bigint, dueDate: string, charge: bigint): PaymentPlan {
  return { principalCents: principal, chargesCents: charge, totalCents: principal + charge, installments: [{ number: 1, dueDate, amountCents: principal + charge, interestCents: charge, principalCents: principal, balanceCents: 0n }] };
}

/** Plano de pagamento exato: Σ parcelas = principal + encargos, última parcela absorve o resíduo. */
export function buildPaymentPlan(principalCents: bigint, payment: EquipmentPayment): PaymentPlan {
  if (principalCents <= 0n) throw new ScenarioError('O valor da compra deve ser maior que zero.');
  switch (payment.mode) {
    case 'cash':
      validateDate(payment.date, 'Compra à vista');
      return single(principalCents, payment.date, 0n);
    case 'deferred': {
      validateDate(payment.date, 'Compra adiada');
      if (!Number.isInteger(payment.chargeBps) || payment.chargeBps < 0 || payment.chargeBps > MAX_DEFERRED_CHARGE_BPS) {
        throw new ScenarioError(`O encargo da compra adiada deve ser inteiro em bps, de 0 a ${MAX_DEFERRED_CHARGE_BPS} (10 000 = 100%).`);
      }
      return single(principalCents, payment.date, roundHalfUpBps(principalCents, payment.chargeBps));
    }
    case 'installments': {
      const { firstDate, count, monthlyRateBps } = payment;
      validateDate(firstDate, 'Compra parcelada');
      if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) throw new ScenarioError(`Informe de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas.`);
      if (!Number.isInteger(monthlyRateBps) || monthlyRateBps < 0 || monthlyRateBps > MAX_MONTHLY_RATE_BPS) {
        throw new ScenarioError(`A taxa mensal deve ser inteira em bps, de 0 a ${MAX_MONTHLY_RATE_BPS} (100 bps = 1% ao mês).`);
      }
      const pmt = priceInstallment(principalCents, count, monthlyRateBps);
      const installments: Installment[] = [];
      let balance = principalCents;
      for (let k = 1; k <= count; k += 1) {
        const interest = roundHalfUpBps(balance, monthlyRateBps);
        const last = k === count;
        const amount = last ? balance + interest : pmt;
        const amortized = amount - interest;
        if (amortized < 0n || (!last && amortized >= balance) || amount < 1n) throw tooSmall(count);
        balance -= amortized;
        installments.push({ number: k, dueDate: monthlyDate(firstDate, k - 1), amountCents: amount, interestCents: interest, principalCents: amortized, balanceCents: balance });
      }
      const total = installments.reduce((acc, i) => acc + i.amountCents, 0n);
      return { principalCents, chargesCents: total - principalCents, totalCents: total, installments };
    }
    default:
      throw new ScenarioError('Forma de pagamento desconhecida.');
  }
}

function describePayment(payment: EquipmentPayment, plan: PaymentPlan): string {
  const first = plan.installments[0] as Installment;
  switch (payment.mode) {
    case 'cash':
      return `paga à vista em ${formatBR(payment.date)}`;
    case 'deferred':
      return `paga em um único pagamento adiado para ${formatBR(payment.date)}, com encargo único de ${bpsText(payment.chargeBps)} do principal`;
    case 'installments': {
      const last = plan.installments[plan.installments.length - 1] as Installment;
      return `parcelada em ${payment.count} parcelas mensais a partir de ${formatBR(payment.firstDate)} (a âncora do dia é mantida; mês curto usa o último dia), juros de ${bpsText(payment.monthlyRateBps)} ao mês, parcelas iguais de ${formatBRL(first.amountCents)} (a última, de ${formatBRL(last.amountCents)}, absorve o resíduo de arredondamento; método: tabela Price em inteiros)`;
    }
  }
}

export function applyEquipmentPurchase(adjustment: EquipmentPurchaseAdjustment, context: ApplierContext): ApplierOutcome {
  const label = adjustment.label ?? `Ajuste ${adjustment.id}`;
  const description = typeof adjustment.description === 'string' ? adjustment.description.trim() : '';
  if (description === '') throw new ScenarioError('Compra sem descrição: diga o que está sendo comprado.');
  let principal: bigint;
  try {
    principal = centsFromString(adjustment.principalCents);
  } catch {
    throw new ScenarioError('O valor da compra deve ser um inteiro em centavos.');
  }
  const plan = buildPaymentPlan(principal, adjustment.payment);
  const { baseDate } = context.snapshot.settings;
  const first = plan.installments[0] as Installment;
  if (first.dueDate <= baseDate) {
    return { changes: [], assumptions: [], warnings: [`${label}: o pagamento em ${formatBR(first.dueDate)} cai até a data-base (${formatBR(baseDate)}), quando o saldo informado já vale; a compra foi ignorada. Use uma data depois da data-base.`] };
  }

  const many = plan.installments.length > 1;
  const additions: EntryAddition[] = plan.installments.map((i) => ({
    direction: 'out',
    amountCents: i.amountCents.toString(),
    dueDate: i.dueDate,
    description: many ? `Equipamento (hipótese): ${description} — parcela ${i.number}/${plan.installments.length}` : `Equipamento (hipótese): ${description}`,
    category: 'Equipamento (hipótese)',
  }));

  const horizonEnd = addDays(baseDate, context.snapshot.horizonDays);
  const beyond = plan.installments.filter((i) => i.dueDate > horizonEnd);
  const warnings = beyond.length === 0 ? [] : [`${label}: ${beyond.length} parcela(s) (${formatBRL(beyond.reduce((acc, i) => acc + i.amountCents, 0n))}) vence(m) depois do horizonte de ${context.snapshot.horizonDays} dias (até ${formatBR(horizonEnd)}) e não entram no saldo projetado.`];
  return {
    changes: [],
    additions,
    assumptions: [
      `Hipótese: compra de "${description}" ${describePayment(adjustment.payment, plan)}. Custos: principal ${formatBRL(plan.principalCents)} + encargos ${formatBRL(plan.chargesCents)} = total ${formatBRL(plan.totalCents)}. Nenhum pagamento é feito, agendado ou solicitado; nada é gravado.`,
    ],
    warnings,
  };
}
