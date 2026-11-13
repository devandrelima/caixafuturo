import type { ISODate } from '../finance/types';

/** Calendário mensal com âncora de dia (ADR-0008 D3, ADR-0010): 31/jan → 28/fev → 31/mar. Sem fuso nem relógio. */

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const lastDayOfMonth = (year: number, month: number): number => (month === 2 ? (isLeap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31);

/** Data civil do `day` pedido no mês (1–12), limitado ao último dia do mês. */
export const dateInMonth = (year: number, month: number, day: number): ISODate => `${pad(year, 4)}-${pad(month, 2)}-${pad(Math.min(day, lastDayOfMonth(year, month)), 2)}`;

/** n-ésima data mensal a partir de `anchor` (n = 0 é o próprio dia), sempre a partir da âncora original. */
export function monthlyDate(anchor: ISODate, n: number): ISODate {
  const index = Number(anchor.slice(0, 4)) * 12 + (Number(anchor.slice(5, 7)) - 1) + n;
  return dateInMonth(Math.floor(index / 12), (index % 12) + 1, Number(anchor.slice(8, 10)));
}
