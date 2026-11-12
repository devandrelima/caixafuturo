import type { CentString, ISODate } from '../finance/types';

/** Meios de pagamento reconhecidos. Cada um terá regra própria de taxa/prazo (S02-P01-T02). */
export type PaymentMethod = 'pix' | 'debit' | 'credit' | 'cash' | 'voucher';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['pix', 'debit', 'credit', 'cash', 'voucher'];

/**
 * Venda importada (faturamento bruto). NÃO é dinheiro disponível: não há data de recebimento nem valor
 * líquido aqui; o repasse é calculado à parte e ligado à venda por `id`.
 * Identidade: `saleKey` (`sale:<identificador_venda>`), em namespace distinto das chaves do CSV de contas.
 */
export interface Sale {
  /** `sale_<sha256(saleKey)[0..20]>`: estável entre importações. */
  id: string;
  saleKey: string;
  /** identificador_venda exatamente como veio no arquivo. */
  externalId: string;
  saleDate: ISODate;
  grossCents: CentString;
  method: PaymentMethod;
  category: string;
}

export interface SaleRow {
  line: number;
  sale: Sale;
}
export interface SaleDuplicateRow {
  line: number;
  duplicateOfLine: number;
  saleKey: string;
}
export interface SaleRowError {
  line: number;
  message: string;
}

export interface SalesPreview {
  /** Problema que impede a leitura do arquivo inteiro. */
  fatalError: string | null;
  /** Linhas de dados (sem cabeçalho e sem linhas em branco). */
  totalRows: number;
  valid: SaleRow[];
  duplicates: SaleDuplicateRow[];
  invalid: SaleRowError[];
}

export interface SalesImportPlan {
  fatalError: string | null;
  toCreate: Sale[];
  /** Vendas válidas cuja chave já existe com os mesmos dados. */
  alreadyImported: { line: number; saleKey: string }[];
  /** Erros do arquivo + conflitos com vendas já gravadas. */
  errors: SaleRowError[];
  summary: { created: number; ignored: number; errors: number; grossCreatedCents: CentString };
}

export interface SalesDay {
  date: ISODate;
  grossCents: bigint;
  saleIds: string[];
}

/** Regra de repasse por meio de pagamento (ADR-0006, D1). Prazo em dias corridos. */
export interface SettlementRule {
  method: PaymentMethod;
  /** Taxa do adquirente em pontos-base (199 = 1,99%). */
  feeBps: number;
  /** Comissão adicional em pontos-base. */
  commissionBps: number;
  lagDays: number;
}
export type SettlementRules = Record<PaymentMethod, SettlementRule>;

/** Recebível líquido calculado de uma venda. Nunca é gravado: é função de (venda, regra). */
export interface DerivedReceivable {
  /** `rcv_<hash da venda>`: um por venda. */
  id: string;
  saleId: string;
  saleKey: string;
  externalId: string;
  method: PaymentMethod;
  saleDate: ISODate;
  grossCents: bigint;
  feeCents: bigint;
  netCents: bigint;
  dueDate: ISODate;
}

/** Decisão humana de conciliação (persistida). */
export type ReconciliationDecision =
  | { kind: 'same'; saleId: string; entryId: string }
  | { kind: 'standalone'; entryId: string };

export type ReceivableStatus =
  | 'derived'
  | 'reconciled'
  | 'pending'
  | 'covered_batch'
  | 'covered_installments'
  | 'before_base_date'
  | 'zero_net';

export interface ReceivableView {
  receivable: DerivedReceivable;
  status: ReceivableStatus;
  /** true = entra no saldo projetado. */
  counts: boolean;
  /** Contas importadas que cobrem a venda (conciliado/lote/parcelas) ou que geram a pendência. */
  entryIds: string[];
  /** Conta importada menos líquido estimado, quando há exatamente um vínculo 1:1. */
  differenceCents: bigint | null;
  reason: string;
}

export type EntryLinkKind = 'imported' | 'reconciled' | 'orphan_reference' | 'batch' | 'installments' | 'standalone';
export interface EntryView {
  entryId: string;
  link: EntryLinkKind;
  saleIds: string[];
  /** Vendas derivadas pendentes por causa desta conta. */
  pendingSaleIds: string[];
  reason: string;
}
