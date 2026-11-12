import type { ProjectionResult } from '../finance/projection';
import type { CashEntry, CashSettings, CentString, DailyPoint, ISODate, RiskLevel } from '../finance/types';

/**
 * Cenários hipotéticos (S05) — contrato: docs/especificacao/contratos/simulacao.md e ADR-0009.
 * Tudo aqui é HIPÓTESE: nada é gravado nem executado e o saldo real nunca é alterado.
 */

export const HYPOTHETICAL_LABEL = 'Hipótese — não é saldo real';

/** Tipos implementados na S05. */
export const SUPPORTED_KINDS = ['delay_receipt', 'scale_sales', 'scale_expense'] as const;
export type SupportedKind = (typeof SUPPORTED_KINDS)[number];

/** Tipos previstos no contrato para a S06: aceitos pelo tipo (extensível), porém ignorados com aviso. */
export const RESERVED_KINDS = ['equipment_purchase', 'hiring', 'shift_vendor_due', 'advance_receivable'] as const;
export type ReservedKind = (typeof RESERVED_KINDS)[number];

interface AdjustmentBase {
  /** Identificador único dentro do cenário; id repetido é ignorado (idempotência). */
  id: string;
  label?: string;
}

/** Atraso de UM recebível (por id do lançamento), em dias corridos. */
export interface DelayReceiptAdjustment extends AdjustmentBase {
  kind: 'delay_receipt';
  entryId: string;
  days: number;
}

/** Variação por fator (basis points inteiros; 10 000 = 100%) ou valor explícito por lançamento afetado. */
export type ShockChange = { mode: 'factor'; factorBps: number } | { mode: 'amount'; deltaCents: CentString };

/** Choque nos repasses derivados de venda, com vencimento original em [from, to] (inclusivo). */
export interface ScaleSalesAdjustment extends AdjustmentBase {
  kind: 'scale_sales';
  from: ISODate;
  to: ISODate;
  change: ShockChange;
}

/** Choque nas despesas agendadas, com vencimento original em [from, to] (inclusivo), opcionalmente por categoria. */
export interface ScaleExpenseAdjustment extends AdjustmentBase {
  kind: 'scale_expense';
  from: ISODate;
  to: ISODate;
  category?: string;
  change: ShockChange;
}

/** Ajuste reservado à S06: o motor o ignora e avisa. */
export interface ReservedAdjustment extends AdjustmentBase {
  kind: ReservedKind;
}

export type SupportedAdjustment = DelayReceiptAdjustment | ScaleSalesAdjustment | ScaleExpenseAdjustment;
export type Adjustment = SupportedAdjustment | ReservedAdjustment;

/** Bruto e custo (taxa+comissão, bps) de um repasse derivado de venda: permite recalcular o líquido (ADR-0006). */
export interface SaleBasis {
  entryId: string;
  saleDate: ISODate;
  grossCents: CentString;
  costBps: number;
}

/** Fotografia imutável e reproduzível do que alimenta o motor. `id` = SHA-256 puro do JSON canônico. */
export interface BaseSnapshot {
  readonly id: string;
  readonly settings: CashSettings;
  readonly horizonDays: number;
  readonly entries: readonly CashEntry[];
  readonly saleBasis: readonly SaleBasis[];
}

export interface Scenario {
  id: string;
  baseSnapshotId: string;
  label: string;
  adjustments: readonly Adjustment[];
}

/** Mudança proposta por um ajuste, sempre calculada a partir do valor ORIGINAL da base. */
export interface EntryChange {
  entryId: string;
  dueDate?: ISODate;
  amountCents?: CentString;
}

export interface ApplierOutcome {
  changes: EntryChange[];
  assumptions: string[];
  warnings: string[];
}

export interface ApplierContext {
  snapshot: BaseSnapshot;
  /** Lançamentos da base que contam no saldo (agendados e depois da data-base), por id. */
  live: ReadonlyMap<string, CashEntry>;
  /** Todos os lançamentos da base, por id. */
  all: ReadonlyMap<string, CashEntry>;
  saleBasis: ReadonlyMap<string, SaleBasis>;
}

export type Applier<A extends SupportedAdjustment> = (adjustment: A, context: ApplierContext) => ApplierOutcome;

export type ApplierRegistry = {
  [K in SupportedKind]?: Applier<Extract<SupportedAdjustment, { kind: K }>>;
};

export interface DeltaPoint {
  date: ISODate;
  baseClosingCents: bigint;
  alternativeClosingCents: bigint;
  /** alternativa − base, exato. */
  deltaCents: bigint;
  deltaIncomingCents: bigint;
  deltaOutgoingCents: bigint;
  baseRisk: RiskLevel;
  alternativeRisk: RiskLevel;
}

export interface AdjustmentEffect {
  adjustmentId: string;
  kind: string;
  label: string;
  status: 'applied' | 'ignored';
  /** Lançamentos efetivamente alterados por este ajuste. */
  changedEntryIds: string[];
}

export interface RiskDiff {
  /** Dias que eram ok na base e viram risco na alternativa. */
  newRiskDates: ISODate[];
  /** Dias que eram risco na base e viram ok na alternativa. */
  resolvedRiskDates: ISODate[];
}

export interface SimulationResult {
  hypothetical: true;
  label: typeof HYPOTHETICAL_LABEL;
  baseSnapshotId: string;
  baseProjection: ProjectionResult;
  alternativeProjection: ProjectionResult;
  deltaByDate: DeltaPoint[];
  riskDiff: RiskDiff;
  effects: AdjustmentEffect[];
  assumptions: string[];
  warnings: string[];
}

export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioError';
  }
}

export type { DailyPoint };
