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
