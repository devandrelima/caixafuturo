/** Data civil no formato YYYY-MM-DD (sem hora nem fuso). */
export type ISODate = string;

/** Centavos inteiros como string decimal (ex.: "123456" = R$ 1.234,56). Nunca number/float. */
export type CentString = string;

export type Direction = 'in' | 'out';
export type EntryOrigin = 'manual' | 'csv' | 'demo' | 'sale' | 'recurring';
export type EntryState = 'scheduled' | 'settled';
export type RiskLevel = 'ok' | 'below_minimum' | 'negative';

/** openingBalanceCents é a fotografia conciliada ao FINAL de baseDate. */
export interface CashSettings {
  baseDate: ISODate;
  openingBalanceCents: CentString;
  minimumBalanceCents: CentString;
}

/** Lançamento persistido. amountCents é magnitude positiva; a direção é separada. */
export interface CashEntry {
  id: string;
  direction: Direction;
  amountCents: CentString;
  dueDate: ISODate;
  description: string;
  category: string;
  origin: EntryOrigin;
  sourceKey: string;
  state: EntryState;
  settledAt?: ISODate;
  linkedSaleId?: string;
}

/** Resultado calculado de um dia (não persistido): valores em BigInt. */
export interface DailyPoint {
  date: ISODate;
  openingCents: bigint;
  incomingCents: bigint;
  outgoingCents: bigint;
  closingCents: bigint;
  entryIds: string[];
  risk: RiskLevel;
  shortfallCents: bigint;
}
