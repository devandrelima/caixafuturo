import { formatBR, isValidISODate } from '../finance/dates';
import { centsFromString, formatBRL } from '../finance/money';
import type { CashEntry } from '../finance/types';
import { ScenarioError } from './types';
import type { ApplierContext, ApplierOutcome, EntryChange, ScaleExpenseAdjustment, ScaleSalesAdjustment, ShockChange } from './types';

/**
 * Choques de vendas e despesas (F22, ADR-0009 D7). Funções puras que só PROPÕEM mudanças de valor a partir do
 * valor ORIGINAL da base; o motor aplica no máximo uma mudança por lançamento e campo (sem soma dupla).
 * Taxas em basis points inteiros (10 000 = 100%); arredondamento meio-sobe, em BigInt.
 */

export const MAX_FACTOR_BPS = 100_000;

/** round_half_up(valor × bps / 10000) para valor ≥ 0, sem ponto flutuante (mesma regra da ADR-0006). */
export function roundHalfUpBps(amountCents: bigint, bps: number): bigint {
  return (amountCents * BigInt(bps) * 2n + 10_000n) / 20_000n;
}

/** 8000 → "80%"; 8050 → "80,5%"; 1 → "0,01%". */
export function bpsText(bps: number): string {
  const whole = Math.floor(bps / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = (bps % 100).toString().padStart(2, '0').replace(/0+$/, '');
  return `${whole}${frac === '' ? '' : `,${frac}`}%`;
}

function validate(adjustment: ScaleSalesAdjustment | ScaleExpenseAdjustment): ShockChange {
  const { from, to, change } = adjustment;
  if (!isValidISODate(from) || !isValidISODate(to)) throw new ScenarioError('Choque: informe o início e o fim do período como datas válidas.');
  if (from > to) throw new ScenarioError('Choque: o início do período não pode ser depois do fim.');
  if (change.mode === 'factor') {
    if (!Number.isInteger(change.factorBps) || change.factorBps < 0 || change.factorBps > MAX_FACTOR_BPS) {
      throw new ScenarioError(`Choque: o fator deve ser inteiro em basis points, de 0 a ${MAX_FACTOR_BPS} (10 000 = 100%).`);
    }
  } else {
    try {
      centsFromString(change.deltaCents);
    } catch {
      throw new ScenarioError('Choque: o valor explícito deve ser um inteiro em centavos (pode ser negativo).');
    }
  }
  return change;
}

const changeText = (change: ShockChange): string =>
  change.mode === 'factor' ? `${bpsText(change.factorBps)} do valor` : `${BigInt(change.deltaCents) >= 0n ? '+' : ''}${formatBRL(BigInt(change.deltaCents))} por lançamento`;

const scaled = (amount: bigint, change: ShockChange): bigint => {
  if (change.mode === 'factor') return roundHalfUpBps(amount, change.factorBps);
  const next = amount + BigInt(change.deltaCents);
  return next > 0n ? next : 0n;
};

const inPeriod = (entry: CashEntry, from: string, to: string): boolean => entry.dueDate >= from && entry.dueDate <= to;
const periodText = (from: string, to: string): string => `de ${formatBR(from)} a ${formatBR(to)}`;

/** Choque de vendas: escala o BRUTO do repasse derivado e recalcula o líquido pela regra de taxa (ADR-0006). */
export function applyScaleSales(adjustment: ScaleSalesAdjustment, context: ApplierContext): ApplierOutcome {
  const change = validate(adjustment);
  const label = adjustment.label ?? `Ajuste ${adjustment.id}`;
  const eligible = [...context.live.values()].filter((e) => e.direction === 'in' && e.origin === 'sale' && inPeriod(e, adjustment.from, adjustment.to));
  if (eligible.length === 0) return { changes: [], assumptions: [], warnings: [`${label}: nenhum repasse de venda no período ${periodText(adjustment.from, adjustment.to)}; nada muda.`] };

  const changes: EntryChange[] = [];
  const missing: string[] = [];
  let before = 0n;
  let after = 0n;
  for (const entry of eligible) {
    const basis = context.saleBasis.get(entry.id);
    if (!basis) {
      missing.push(entry.id);
      continue;
    }
    const gross = scaled(centsFromString(basis.grossCents), change);
    const net = gross - roundHalfUpBps(gross, basis.costBps);
    const current = centsFromString(entry.amountCents);
    if (net === current) continue;
    changes.push({ entryId: entry.id, amountCents: net.toString() });
    before += current;
    after += net;
  }
  const warnings = missing.length > 0 ? [`${label}: ${missing.length} repasse(s) sem base de venda (bruto e taxa) não foram alterados: ${missing.join(', ')}.`] : [];
  const assumptions =
    changes.length === 0
      ? []
      : [
          `Hipótese: ${changes.length} repasse(s) estimado(s) de venda com vencimento ${periodText(adjustment.from, adjustment.to)} ficam com ${changeText(change)} do bruto, e o líquido é recalculado pela regra de taxa da venda (total de ${formatBRL(before)} para ${formatBRL(after)}). Não mudam: contas importadas, vendas conciliadas e lançamentos liquidados. Vendas futuras e a previsão de faturamento não são simuladas.`,
        ];
  return { changes, assumptions, warnings };
}

/** Choque de despesas agendadas (opcionalmente por categoria exata). */
export function applyScaleExpense(adjustment: ScaleExpenseAdjustment, context: ApplierContext): ApplierOutcome {
  const change = validate(adjustment);
  const label = adjustment.label ?? `Ajuste ${adjustment.id}`;
  const where = adjustment.category === undefined ? '' : ` da categoria "${adjustment.category}"`;
  const eligible = [...context.live.values()].filter((e) => e.direction === 'out' && inPeriod(e, adjustment.from, adjustment.to) && (adjustment.category === undefined || e.category === adjustment.category));
  if (eligible.length === 0) return { changes: [], assumptions: [], warnings: [`${label}: nenhuma despesa${where} no período ${periodText(adjustment.from, adjustment.to)}; nada muda.`] };

  const changes: EntryChange[] = [];
  let before = 0n;
  let after = 0n;
  for (const entry of eligible) {
    const current = centsFromString(entry.amountCents);
    const next = scaled(current, change);
    if (next === current) continue;
    changes.push({ entryId: entry.id, amountCents: next.toString() });
    before += current;
    after += next;
  }
  const assumptions =
    changes.length === 0
      ? []
      : [`Hipótese: ${changes.length} despesa(s) agendada(s)${where} com vencimento ${periodText(adjustment.from, adjustment.to)} ficam com ${changeText(change)} (total de ${formatBRL(before)} para ${formatBRL(after)}). Despesas liquidadas não mudam.`];
  return { changes, assumptions, warnings: [] };
}
