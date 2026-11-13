import { addDays, formatBR, isValidISODate } from '../finance/dates';
import { centsFromString, formatBRL } from '../finance/money';
import type { ISODate } from '../finance/types';
import { dateInMonth } from './calendar';
import { bpsText, roundHalfUpBps } from './shocks';
import { ScenarioError } from './types';
import type { ApplierContext, ApplierOutcome, EntryAddition, HiringAdjustment } from './types';

/**
 * Contratação (F24, ADR-0010 D3): custos mensais INFORMADOS a partir de uma data. Não calcula legislação
 * trabalhista; cria só lançamentos hipotéticos de saída. Nenhuma contratação real.
 */

export const MAX_CHARGES_BPS = 10_000;

export const HIRING_PREMISE =
  'Premissa fixa: esta tela não calcula legislação trabalhista. 13º salário, férias (e o terço constitucional), FGTS, rescisão, benefícios e impostos só entram se você os informar em encargos ou custos fixos; o custo real pode ser maior.';

export interface HiringMonthlyCost {
  baseCents: bigint;
  chargesCents: bigint;
  fixedCents: bigint;
  totalCents: bigint;
}

/** Custo mensal = informado + encargos informados (meio-sobe) + outros custos fixos informados. Nada é estimado. */
export function hiringMonthlyCost(adjustment: HiringAdjustment): HiringMonthlyCost {
  const baseCents = centsFromString(adjustment.monthlyCostCents);
  const chargesCents = adjustment.chargesBps === undefined ? 0n : roundHalfUpBps(baseCents, adjustment.chargesBps);
  const fixedCents = adjustment.fixedMonthlyCents === undefined ? 0n : centsFromString(adjustment.fixedMonthlyCents);
  return { baseCents, chargesCents, fixedCents, totalCents: baseCents + chargesCents + fixedCents };
}

function validate(adjustment: HiringAdjustment): void {
  if (typeof adjustment.role !== 'string' || adjustment.role.trim() === '') throw new ScenarioError('Contratação sem função: diga o cargo ou a função hipotética.');
  let base: bigint;
  try {
    base = centsFromString(adjustment.monthlyCostCents);
  } catch {
    throw new ScenarioError('O custo mensal deve ser um inteiro em centavos.');
  }
  if (base <= 0n) throw new ScenarioError('O custo mensal deve ser maior que zero.');
  const { chargesBps, fixedMonthlyCents, payDay, startDate, endDate } = adjustment;
  if (chargesBps !== undefined && (!Number.isInteger(chargesBps) || chargesBps < 0 || chargesBps > MAX_CHARGES_BPS)) {
    throw new ScenarioError(`Os encargos devem ser um percentual inteiro em bps, de 0 a ${MAX_CHARGES_BPS} (10 000 = 100%).`);
  }
  if (fixedMonthlyCents !== undefined) {
    let fixed: bigint;
    try {
      fixed = centsFromString(fixedMonthlyCents);
    } catch {
      throw new ScenarioError('Os outros custos mensais fixos devem ser um inteiro em centavos.');
    }
    if (fixed < 0n) throw new ScenarioError('Os outros custos mensais fixos não podem ser negativos.');
  }
  if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) throw new ScenarioError('O dia de pagamento deve ser um número inteiro de 1 a 31.');
  if (!isValidISODate(startDate)) throw new ScenarioError('Informe uma data inicial válida.');
  if (endDate !== undefined) {
    if (!isValidISODate(endDate)) throw new ScenarioError('Informe uma data final válida.');
    if (endDate < startDate) throw new ScenarioError('A data final não pode ser antes da data inicial.');
  }
}

export interface HiringSchedule {
  /** Datas de pagamento que entram no saldo: ≥ data inicial, > data-base, ≤ data final, ≤ fim do horizonte. */
  dates: ISODate[];
  /** Primeira data válida que cai depois do horizonte (quando nenhuma coube). */
  firstBeyond: ISODate | null;
}

export function hiringSchedule(adjustment: HiringAdjustment, baseDate: ISODate, horizonEnd: ISODate): HiringSchedule {
  const { startDate, endDate, payDay } = adjustment;
  const startIndex = Number(startDate.slice(0, 4)) * 12 + (Number(startDate.slice(5, 7)) - 1);
  const dates: ISODate[] = [];
  let firstBeyond: ISODate | null = null;
  for (let i = 0; ; i += 1) {
    const index = startIndex + i;
    const date = dateInMonth(Math.floor(index / 12), (index % 12) + 1, payDay);
    if (endDate !== undefined && date > endDate) break;
    if (date < startDate || date <= baseDate) continue;
    if (date > horizonEnd) {
      firstBeyond = date;
      break;
    }
    dates.push(date);
  }
  return { dates, firstBeyond };
}

/** Datas de pagamento dentro do horizonte (ver `hiringSchedule`). */
export const hiringPaymentDates = (adjustment: HiringAdjustment, baseDate: ISODate, horizonEnd: ISODate): ISODate[] => hiringSchedule(adjustment, baseDate, horizonEnd).dates;

export function applyHiring(adjustment: HiringAdjustment, context: ApplierContext): ApplierOutcome {
  validate(adjustment);
  const label = adjustment.label ?? `Ajuste ${adjustment.id}`;
  const role = adjustment.role.trim();
  const { baseDate } = context.snapshot.settings;
  const horizonEnd = addDays(baseDate, context.snapshot.horizonDays);
  const cost = hiringMonthlyCost(adjustment);
  const { dates, firstBeyond } = hiringSchedule(adjustment, baseDate, horizonEnd);

  const warnings: string[] = [];
  const missing = [adjustment.chargesBps === undefined ? 'encargos (%)' : null, adjustment.fixedMonthlyCents === undefined ? 'outros custos mensais fixos' : null].filter((x): x is string => x !== null);
  if (missing.length > 0) warnings.push(`${label}: hipótese incompleta — não foram informados: ${missing.join(' e ')}. Eles entram como R$ 0,00 e o custo real tende a ser maior.`);
  if (adjustment.startDate <= baseDate) warnings.push(`${label}: a data inicial (${formatBR(adjustment.startDate)}) é até a data-base (${formatBR(baseDate)}): pagamentos até a data-base já estão no saldo informado e não entram.`);

  const assumptions = [HIRING_PREMISE];
  if (dates.length === 0) {
    warnings.push(
      firstBeyond === null
        ? `${label}: nenhum pagamento cai entre a data inicial e a data final informadas, depois da data-base; nada muda.`
        : `${label}: o primeiro pagamento cai em ${formatBR(firstBeyond)}, depois do horizonte de ${context.snapshot.horizonDays} dias (até ${formatBR(horizonEnd)}): nada entra no saldo projetado.`,
    );
    return { changes: [], additions: [], assumptions, warnings };
  }

  const additions: EntryAddition[] = dates.map((dueDate) => ({
    direction: 'out',
    amountCents: cost.totalCents.toString(),
    dueDate,
    description: `Contratação (hipótese): ${role} — custo mensal`,
    category: 'Pessoal (hipótese)',
  }));
  const charges = adjustment.chargesBps === undefined ? 'encargos não informados' : `encargos informados de ${bpsText(adjustment.chargesBps)} (${formatBRL(cost.chargesCents)})`;
  const fixed = adjustment.fixedMonthlyCents === undefined ? 'outros custos fixos não informados' : `outros custos mensais fixos informados de ${formatBRL(cost.fixedCents)}`;
  const short = adjustment.payDay > 28 ? ' (mês curto usa o último dia)' : '';
  assumptions.unshift(
    `Hipótese: contratação de "${role}" a partir de ${formatBR(adjustment.startDate)}${adjustment.endDate === undefined ? '' : ` até ${formatBR(adjustment.endDate)}`}, com pagamento todo dia ${adjustment.payDay}${short}. Custo mensal informado de ${formatBRL(cost.baseCents)}, ${charges} e ${fixed}: ${formatBRL(cost.totalCents)} por mês, sem proporcional de mês parcial. ${dates.length} pagamento(s) no horizonte, total de ${formatBRL(cost.totalCents * BigInt(dates.length))}. Nada é contratado nem gravado.`,
  );
  return { changes: [], additions, assumptions, warnings };
}
