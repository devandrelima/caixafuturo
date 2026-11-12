import type { DailyPoint, RiskLevel } from './types';

/** Negativo tem prioridade; exatamente no mínimo não gera alerta. */
export function classifyRisk(closingCents: bigint, minimumCents: bigint): RiskLevel {
  if (closingCents < 0n) return 'negative';
  if (closingCents < minimumCents) return 'below_minimum';
  return 'ok';
}

/** Quanto falta para atingir o saldo mínimo (nunca negativo). */
export function shortfallCents(closingCents: bigint, minimumCents: bigint): bigint {
  const missing = minimumCents - closingCents;
  return missing > 0n ? missing : 0n;
}

export function firstRiskPoint(points: readonly DailyPoint[]): DailyPoint | null {
  return points.find((p) => p.risk !== 'ok') ?? null;
}

export function firstNegativePoint(points: readonly DailyPoint[]): DailyPoint | null {
  return points.find((p) => p.risk === 'negative') ?? null;
}

/** Menor saldo de fechamento; em empate, a data mais cedo. */
export function lowestPoint(points: readonly DailyPoint[]): DailyPoint {
  const [first, ...rest] = points;
  if (!first) throw new Error('Projeção sem pontos.');
  return rest.reduce((low, p) => (p.closingCents < low.closingCents ? p : low), first);
}
