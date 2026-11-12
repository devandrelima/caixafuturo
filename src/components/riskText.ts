import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { DailyPoint, ISODate, RiskLevel } from '../domain/finance/types';
import type { Tone } from './ui/UiPrimitives';

export const riskLabel = (risk: RiskLevel): string => (risk === 'negative' ? 'Saldo negativo' : risk === 'below_minimum' ? 'Abaixo do mínimo' : 'Sem alerta');

export const riskTone = (risk: RiskLevel): Tone => (risk === 'negative' ? 'negative' : risk === 'below_minimum' ? 'warning' : 'positive');

/** Frase do aviso de risco, sempre com data e (quando houver) o déficit para o mínimo. */
export function riskSentence(point: DailyPoint): string {
  if (point.risk === 'negative') return `Saldo projetado negativo em ${formatBR(point.date)}`;
  if (point.risk === 'below_minimum') return `Risco de ficar abaixo do mínimo em ${formatBR(point.date)}`;
  return `Sem alerta em ${formatBR(point.date)}`;
}

/** "14/11" a partir de ISO. */
export const shortDate = (iso: ISODate): string => formatBR(iso).slice(0, 5);

/** Centavos como texto de campo pt-BR, sem símbolo: 123456n → "1.234,56". */
export const centsToInput = (cents: bigint): string => formatBRL(cents).replace('R$ ', '');

export function formatAxisBRL(cents: number): string {
  return formatBRL(BigInt(Math.round(cents / 100)) * 100n).replace(',00', '');
}
