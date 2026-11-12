import type { ISODate } from '../finance/types';
import type { ModelPoint } from './models';

/**
 * Faixa EMPÍRICA de erro (ADR-0007, D5): percentis dos resíduos históricos (realizado − previsto) somados à
 * previsão central. NÃO é intervalo de confiança nem de credibilidade: nenhum nível probabilístico é medido ou
 * prometido, e a faixa não promete cobertura futura. Resíduos têm dependência (dentro da dobra) e escala própria
 * (dias de maior venda erram mais); a faixa usa deslocamentos absolutos e não modela isso.
 * Só existe com resíduos e dobras suficientes; senão devolve o motivo e nenhum limite.
 */

/** Percentis (pontos-base) usados nos limites: 10º e 90º. Rótulos de produto: conservadora / otimista. */
export const LOWER_PERCENTILE_BPS = 1000;
export const UPPER_PERCENTILE_BPS = 9000;
/** Mínimo de resíduos (pares previsto/realizado) e de dobras de backtesting para mostrar faixa. */
export const MIN_BAND_RESIDUALS = 28;
export const MIN_BAND_FOLDS = 4;

export type ResidualBand =
  | {
      status: 'available';
      reason: null;
      residuals: number;
      folds: number;
      lowerPercentileBps: number;
      upperPercentileBps: number;
      /** Percentil inferior dos resíduos (normalmente ≤ 0): somado à previsão central. */
      lowerOffsetCents: bigint;
      /** Percentil superior dos resíduos (normalmente ≥ 0). */
      upperOffsetCents: bigint;
    }
  | { status: 'insufficient'; reason: string; residuals: number; folds: number };

export interface BandedPoint {
  date: ISODate;
  centralCents: bigint;
  lowerCents: bigint | null;
  upperCents: bigint | null;
}

/** Percentil por posto mais próximo: posto = ⌈p × n⌉ (1-based), em inteiros. `sorted` deve estar em ordem crescente. */
export function percentileNearestRank(sorted: readonly bigint[], percentileBps: number): bigint {
  if (sorted.length === 0) throw new RangeError('Não há valores para o percentil.');
  if (!Number.isInteger(percentileBps) || percentileBps < 0 || percentileBps > 10_000) {
    throw new RangeError('O percentil deve ser um inteiro em pontos-base, de 0 a 10000.');
  }
  const rank = Math.ceil((percentileBps * sorted.length) / 10_000);
  return sorted[Math.max(1, rank) - 1] as bigint;
}

/** Monta a faixa a partir dos resíduos do backtesting (todos os passos, só dobras comparáveis). */
export function residualBand(residuals: readonly bigint[], folds: number): ResidualBand {
  const n = residuals.length;
  if (n < MIN_BAND_RESIDUALS) {
    return {
      status: 'insufficient',
      reason: `Histórico de erro insuficiente: ${n} previsões comparadas com o realizado (mínimo ${MIN_BAND_RESIDUALS}). Sem faixa.`,
      residuals: n,
      folds,
    };
  }
  if (folds < MIN_BAND_FOLDS) {
    return {
      status: 'insufficient',
      reason: `Histórico de erro insuficiente: ${folds} dobras de backtesting (mínimo ${MIN_BAND_FOLDS}). Sem faixa.`,
      residuals: n,
      folds,
    };
  }
  const sorted = [...residuals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    status: 'available',
    reason: null,
    residuals: n,
    folds,
    lowerPercentileBps: LOWER_PERCENTILE_BPS,
    upperPercentileBps: UPPER_PERCENTILE_BPS,
    lowerOffsetCents: percentileNearestRank(sorted, LOWER_PERCENTILE_BPS),
    upperOffsetCents: percentileNearestRank(sorted, UPPER_PERCENTILE_BPS),
  };
}

/**
 * Soma os deslocamentos à previsão central (piso em zero: faturamento não é negativo). Com viés histórico a central
 * pode ficar fora da faixa: nada é "corrigido" em silêncio. Sem faixa disponível, limites nulos.
 */
export function applyBand(points: readonly ModelPoint[], band: ResidualBand): BandedPoint[] {
  const floor = (x: bigint): bigint => (x < 0n ? 0n : x);
  return points.map((p) => ({
    date: p.date,
    centralCents: p.centralCents,
    lowerCents: band.status === 'available' ? floor(p.centralCents + band.lowerOffsetCents) : null,
    upperCents: band.status === 'available' ? floor(p.centralCents + band.upperOffsetCents) : null,
  }));
}
