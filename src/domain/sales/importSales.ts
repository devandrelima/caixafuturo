import { parseDateInput } from '../finance/dates';
import { centsFromString, parseBRL } from '../finance/money';
import { DELIMITERS, headerName, isBlank, MAX_ROWS, tokenize } from '../import/csv';
import { sha256Hex } from '../import/sha256';
import type {
  PaymentMethod,
  Sale,
  SaleRowError,
  SalesDay,
  SalesImportPlan,
  SalesPreview,
} from './types';

/** Contrato canônico: docs/especificacao/contratos/importacao.md (seção Vendas). O parser NÃO grava em storage. */
const MAX_EXTERNAL_ID = 100;
const MAX_CATEGORY = 100;

const REQUIRED = ['identificador_venda', 'data_venda', 'valor_bruto', 'meio_pagamento'] as const;
const KNOWN = [...REQUIRED, 'categoria'] as const;

const fatal = (message: string): SalesPreview => ({ fatalError: message, totalRows: 0, valid: [], duplicates: [], invalid: [] });

const METHOD_ALIASES: Record<string, PaymentMethod> = {
  pix: 'pix',
  debito: 'debit',
  cartao_debito: 'debit',
  cartao_de_debito: 'debit',
  credito: 'credit',
  cartao_credito: 'credit',
  cartao_de_credito: 'credit',
  dinheiro: 'cash',
  especie: 'cash',
  voucher: 'voucher',
  vale: 'voucher',
  vr: 'voucher',
  va: 'voucher',
  vale_refeicao: 'voucher',
  vale_alimentacao: 'voucher',
};

const methodOf = (raw: string): PaymentMethod | null => METHOD_ALIASES[headerName(raw)] ?? null;

function detectDelimiter(headerLine: string): { delimiter: string; columns: string[] } {
  let best = { delimiter: ';', columns: [] as string[], score: -1 };
  for (const delimiter of DELIMITERS) {
    const columns = headerLine.split(delimiter).map((c) => headerName(c.replace(/^"|"$/g, '')));
    const score = REQUIRED.filter((r) => columns.includes(r)).length;
    if (score > best.score) best = { delimiter, columns, score };
  }
  return best;
}

/** Dados que definem a venda. Categoria fica de fora: recategorizar não cria outra venda nem é conflito. */
const signatureOf = (s: Pick<Sale, 'saleDate' | 'grossCents' | 'method'>): string =>
  [s.saleDate, s.grossCents, s.method].join('\u001f');

function parseRow(get: (col: string) => string): { sale: Sale } | { errors: string[] } {
  const errors: string[] = [];

  const externalId = get('identificador_venda').trim();
  if (externalId === '') errors.push('Identificador da venda obrigatório.');
  else if (externalId.length > MAX_EXTERNAL_ID) errors.push(`Identificador da venda muito longo (máximo ${MAX_EXTERNAL_ID} caracteres).`);

  const saleDate = parseDateInput(get('data_venda'));
  if (!saleDate) errors.push('Data da venda inválida: use DD/MM/AAAA ou AAAA-MM-DD, com data real.');

  const money = parseBRL(get('valor_bruto'), { allowNegative: true });
  if (!money.ok) errors.push(`Valor bruto inválido: ${money.reason.replace(/\.$/, '')}.`);
  else if (money.cents < 0n) errors.push('Valor bruto não pode ser negativo (estornos e cancelamentos não são importados nesta versão).');

  const method = methodOf(get('meio_pagamento'));
  if (!method) errors.push('Meio de pagamento desconhecido: use pix, débito, crédito, dinheiro ou voucher.');

  const category = get('categoria').trim();
  if (category.length > MAX_CATEGORY) errors.push(`Categoria muito longa (máximo ${MAX_CATEGORY} caracteres).`);

  if (errors.length > 0 || !saleDate || !money.ok || !method) return { errors };
  const saleKey = `sale:${externalId}`;
  return {
    sale: {
      id: `sale_${sha256Hex(saleKey).slice(0, 20)}`,
      saleKey,
      externalId,
      saleDate,
      grossCents: money.cents.toString(),
      method,
      category,
    },
  };
}

/** Lê e valida o CSV de vendas, sem efeitos colaterais. Linhas inválidas nunca entram em `valid`. */
export function previewSalesCsv(input: string): SalesPreview {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = text.split('\n').find((l) => l.trim() !== '');
  if (firstLine === undefined) return fatal('O arquivo está vazio.');

  const { delimiter, columns } = detectDelimiter(firstLine);
  const missing = REQUIRED.filter((r) => !columns.includes(r));
  if (missing.length > 0) {
    return fatal(`Colunas obrigatórias ausentes: ${missing.join(', ')}. Cabeçalho esperado: ${KNOWN.join(';')}.`);
  }
  const repeated = columns.filter((c, i) => columns.indexOf(c) !== i);
  if (repeated.length > 0) return fatal(`Colunas repetidas no cabeçalho: ${[...new Set(repeated)].join(', ')}.`);

  const { records, unclosedAtLine } = tokenize(text, delimiter);
  if (unclosedAtLine !== null) return fatal(`Aspas não fechadas, começando na linha ${unclosedAtLine}.`);

  const headerIndex = records.findIndex((r) => !isBlank(r));
  const dataRecords = records.slice(headerIndex + 1).filter((r) => !isBlank(r));
  if (dataRecords.length > MAX_ROWS) return fatal(`O arquivo excede o limite de ${MAX_ROWS} linhas por importação.`);

  const index = new Map(columns.map((c, i) => [c, i] as const));
  const preview: SalesPreview = { fatalError: null, totalRows: dataRecords.length, valid: [], duplicates: [], invalid: [] };
  const seen = new Map<string, { line: number; signature: string }>();

  for (const record of dataRecords) {
    const get = (col: string): string => {
      const i = index.get(col);
      return i === undefined ? '' : (record.fields[i] ?? '');
    };
    const result = parseRow(get);
    if ('errors' in result) {
      preview.invalid.push({ line: record.line, message: result.errors.join(' ') });
      continue;
    }
    const { sale } = result;
    const signature = signatureOf(sale);
    const previous = seen.get(sale.saleKey);
    if (previous) {
      if (previous.signature === signature) {
        preview.duplicates.push({ line: record.line, duplicateOfLine: previous.line, saleKey: sale.saleKey });
      } else {
        preview.invalid.push({
          line: record.line,
          message: `Identificador "${sale.externalId}" já usado na linha ${previous.line} com dados diferentes; use identificadores distintos para vendas distintas.`,
        });
      }
      continue;
    }
    seen.set(sale.saleKey, { line: record.line, signature });
    preview.valid.push({ line: record.line, sale });
  }
  return preview;
}

/**
 * Decide o que gravar. Chave nova → cria; chave existente com os mesmos dados → ignora (reimportar não
 * duplica faturamento); chave existente com dados diferentes → conflito explícito, sem sobrescrever.
 */
export function planSalesImport(preview: SalesPreview, existing: Iterable<Sale>): SalesImportPlan {
  const stored = new Map<string, Sale>();
  for (const sale of existing) stored.set(sale.saleKey, sale);
  const toCreate: Sale[] = [];
  const alreadyImported: SalesImportPlan['alreadyImported'] = [];
  const errors: SaleRowError[] = [...preview.invalid];
  if (preview.fatalError === null) {
    for (const { line, sale } of preview.valid) {
      const current = stored.get(sale.saleKey);
      if (!current) toCreate.push(sale);
      else if (signatureOf(current) === signatureOf(sale)) alreadyImported.push({ line, saleKey: sale.saleKey });
      else {
        errors.push({
          line,
          message: `Venda "${sale.externalId}" já importada com dados diferentes (data, valor ou meio); o faturamento existente não foi alterado.`,
        });
      }
    }
    errors.sort((a, b) => a.line - b.line);
  }
  return {
    fatalError: preview.fatalError,
    toCreate,
    alreadyImported,
    errors,
    summary: {
      created: toCreate.length,
      ignored: alreadyImported.length + preview.duplicates.length,
      errors: errors.length,
      grossCreatedCents: totalGrossCents(toCreate).toString(),
    },
  };
}

/** Faturamento bruto total (vendas ≠ dinheiro disponível). */
export function totalGrossCents(sales: readonly Sale[]): bigint {
  let total = 0n;
  for (const s of sales) total += centsFromString(s.grossCents);
  return total;
}

/** Faturamento bruto por dia de venda, em ordem cronológica; dias sem venda não aparecem (política na S02-P02-T01). */
export function grossByDay(sales: readonly Sale[]): SalesDay[] {
  const days = new Map<string, SalesDay>();
  for (const s of sales) {
    const day = days.get(s.saleDate) ?? { date: s.saleDate, grossCents: 0n, saleIds: [] };
    day.grossCents += centsFromString(s.grossCents);
    day.saleIds.push(s.id);
    days.set(s.saleDate, day);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
