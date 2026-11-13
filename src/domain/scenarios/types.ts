import type { ProjectionResult } from '../finance/projection';
import type { CashEntry, CashSettings, CentString, DailyPoint, ISODate, RiskLevel } from '../finance/types';

/**
 * Cenários hipotéticos (S05) — contrato: docs/especificacao/contratos/simulacao.md e ADR-0009.
 * Tudo aqui é HIPÓTESE: nada é gravado nem executado e o saldo real nunca é alterado.
 */

export const HYPOTHETICAL_LABEL = 'Hipótese — não é saldo real';

/** Tipos de ajuste (S05: atraso e choques; S06: equipamento, contratação, vencimento de fornecedor e antecipação). */
export const SUPPORTED_KINDS = ['delay_receipt', 'scale_sales', 'scale_expense', 'equipment_purchase', 'hiring', 'shift_vendor_due', 'advance_receivable'] as const;
export type SupportedKind = (typeof SUPPORTED_KINDS)[number];

/** Prefixo do id/sourceKey de lançamentos CRIADOS por hipótese (ADR-0010 D5/D6): nunca gravados nem exportados. */
export const HYPOTHETICAL_ID_PREFIX = 'scn:';
export const isHypotheticalEntryId = (id: string): boolean => id.startsWith(HYPOTHETICAL_ID_PREFIX);

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

/** Forma de pagamento de uma compra de equipamento (ADR-0010 D1). */
export type EquipmentPayment =
  | { mode: 'cash'; date: ISODate }
  /** Adiada: uma saída em data posterior, com encargo único informado (bps sobre o principal, pode ser 0). */
  | { mode: 'deferred'; date: ISODate; chargeBps: number }
  /** Parcelada: `count` parcelas mensais a partir de `firstDate`, juros compostos mensais em bps (tabela Price). */
  | { mode: 'installments'; firstDate: ISODate; count: number; monthlyRateBps: number };

/** Compra hipotética de equipamento: cria saídas (nenhum pagamento real). */
export interface EquipmentPurchaseAdjustment extends AdjustmentBase {
  kind: 'equipment_purchase';
  description: string;
  principalCents: CentString;
  payment: EquipmentPayment;
}

/** Contratação hipotética: custos mensais INFORMADOS a partir de uma data (sem cálculo trabalhista, ADR-0010 D3). */
export interface HiringAdjustment extends AdjustmentBase {
  kind: 'hiring';
  role: string;
  monthlyCostCents: CentString;
  /** Encargos informados (bps sobre o custo mensal). Ausente = não informado (hipótese incompleta). */
  chargesBps?: number;
  /** Outros custos mensais fixos informados. Ausente = não informado (hipótese incompleta). */
  fixedMonthlyCents?: CentString;
  /** Dia do pagamento (1–31; mês curto usa o último dia). */
  payDay: number;
  startDate: ISODate;
  endDate?: ISODate;
}

/** Muda só a DATA de uma saída agendada (valor intacto). */
export interface ShiftVendorDueAdjustment extends AdjustmentBase {
  kind: 'shift_vendor_due';
  entryId: string;
  newDate: ISODate;
}

/** Antecipa UM recebível inteiro: sai da data original e o líquido (bruto − custo) entra na data antecipada. */
export interface AdvanceReceivableAdjustment extends AdjustmentBase {
  kind: 'advance_receivable';
  entryId: string;
  advanceDate: ISODate;
  /** Taxa informada ao mês, em bps; custo proporcional a dias/30 (ADR-0010 D2). */
  rateBps: number;
}

export type SupportedAdjustment =
  | DelayReceiptAdjustment
  | ScaleSalesAdjustment
  | ScaleExpenseAdjustment
  | EquipmentPurchaseAdjustment
  | HiringAdjustment
  | ShiftVendorDueAdjustment
  | AdvanceReceivableAdjustment;
export type Adjustment = SupportedAdjustment;

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
  /** Retira o lançamento da alternativa (antecipação). Ocupa data, valor e presença: qualquer outro ajuste conflita. */
  remove?: true;
}

/** Lançamento HIPOTÉTICO novo. O motor atribui id e sourceKey `scn:<idDoAjuste>:<posição>` (determinísticos). */
export interface EntryAddition {
  direction: 'in' | 'out';
  amountCents: CentString;
  dueDate: ISODate;
  description: string;
  category: string;
  linkedSaleId?: string;
  /** Só vale se este ajuste retirou (com sucesso) o lançamento indicado: evita o líquido sem a retirada. */
  dependsOn?: string;
}

export interface ApplierOutcome {
  changes: EntryChange[];
  additions?: EntryAddition[];
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

/** Trilha do que o ajuste mudou, sempre a partir do valor ORIGINAL da base (`to: null` = retirado). */
export interface EffectChange {
  entryId: string;
  /** Descrição do lançamento da base, para a trilha ser legível ("Aluguel: de 14/11 para 21/11"). */
  description: string;
  field: 'dueDate' | 'amountCents' | 'removed';
  from: string;
  to: string | null;
}

export interface AdjustmentEffect {
  adjustmentId: string;
  kind: string;
  label: string;
  status: 'applied' | 'ignored';
  /** Lançamentos efetivamente alterados ou retirados por este ajuste. */
  changedEntryIds: string[];
  /** Lançamentos hipotéticos criados por este ajuste. */
  createdEntryIds: string[];
  changes: EffectChange[];
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
  /** Lançamentos hipotéticos criados (só existem na alternativa; nunca gravados nem exportados). */
  createdEntries: CashEntry[];
  /** Lançamentos da base retirados da alternativa. */
  removedEntryIds: string[];
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
