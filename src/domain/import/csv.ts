import { parseBRL } from '../finance/money';
import { parseDateInput } from '../finance/dates';
import type { CashEntry, Direction, ISODate } from '../finance/types';
import { sha256Hex } from './sha256';

/** Contrato canônico: docs/especificacao/contratos/importacao.md (contas). O parser NÃO grava em storage. */
export const MAX_ROWS = 5000;
const MAX_DESCRIPTION = 200;
const MAX_CATEGORY = 100;
const MAX_EXTERNAL_ID = 100;
const MAX_SALE_REFERENCE = 100;

export interface CandidateRow {
  line: number;
  entry: CashEntry;
}
export interface DuplicateRow {
  line: number;
  duplicateOfLine: number;
  sourceKey: string;
}
export interface RowError {
  line: number;
  message: string;
}
export interface CsvPreview {
  /** Problema que impede a leitura do arquivo inteiro. */
  fatalError: string | null;
  /** Linhas de dados (sem cabeçalho e sem linhas em branco). */
  totalRows: number;
  valid: CandidateRow[];
  duplicates: DuplicateRow[];
  invalid: RowError[];
}

const EMPTY: Omit<CsvPreview, 'fatalError'> = { totalRows: 0, valid: [], duplicates: [], invalid: [] };
const fatal = (message: string): CsvPreview => ({ ...EMPTY, valid: [], duplicates: [], invalid: [], fatalError: message });

const REQUIRED = ['tipo', 'descricao', 'valor', 'vencimento'] as const;
const KNOWN = [...REQUIRED, 'categoria', 'identificador_externo', 'referencia_venda'] as const;
export const DELIMITERS = [';', ',', '\t'] as const;

export const headerName = (raw: string): string =>
  raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

export interface RawRecord {
  line: number;
  fields: string[];
}

/** Tokenizador RFC 4180: aspas, aspas escapadas ("") e quebras de linha dentro de campos. */
export function tokenize(text: string, delimiter: string): { records: RawRecord[]; unclosedAtLine: number | null } {
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let quoteStartLine = 1;

  const endRecord = () => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    fields = [];
    field = '';
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line += 1;
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
      quoteStartLine = line;
    } else if (c === delimiter) {
      fields.push(field);
      field = '';
    } else if (c === '\n') {
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      field += c;
    }
  }
  if (inQuotes) return { records, unclosedAtLine: quoteStartLine };
  if (field !== '' || fields.length > 0) endRecord();
  return { records, unclosedAtLine: null };
}

export const isBlank = (r: RawRecord) => r.fields.every((f) => f.trim() === '');

function detectDelimiter(headerLine: string): { delimiter: string; columns: string[] } {
  let best = { delimiter: ';', columns: [] as string[], score: -1 };
  for (const delimiter of DELIMITERS) {
    const columns = headerLine.split(delimiter).map((c) => headerName(c.replace(/^"|"$/g, '')));
    const score = REQUIRED.filter((r) => columns.includes(r)).length;
    if (score > best.score) best = { delimiter, columns, score };
  }
  return best;
}

const normalizeText = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

function directionOf(raw: string): Direction | null {
  const t = headerName(raw);
  if (t === 'pagar') return 'out';
  if (t === 'receber') return 'in';
  return null;
}

interface Parsed {
  entry: CashEntry;
  signature: string;
}

function parseRow(get: (col: string) => string): { parsed: Parsed } | { errors: string[] } {
  const errors: string[] = [];
  const direction = directionOf(get('tipo'));
  if (!direction) errors.push('Tipo inválido: use "pagar" ou "receber".');

  const description = get('descricao').trim();
  if (description === '') errors.push('Descrição obrigatória.');
  else if (description.length > MAX_DESCRIPTION) errors.push(`Descrição muito longa (máximo ${MAX_DESCRIPTION} caracteres).`);

  const category = get('categoria').trim();
  if (category.length > MAX_CATEGORY) errors.push(`Categoria muito longa (máximo ${MAX_CATEGORY} caracteres).`);

  const money = parseBRL(get('valor'));
  if (!money.ok) errors.push(`Valor inválido: ${money.reason.replace(/\.$/, '')}.`);

  const rawDate = get('vencimento');
  const dueDate: ISODate | null = parseDateInput(rawDate);
  if (!dueDate) errors.push('Vencimento inválido: use DD/MM/AAAA ou AAAA-MM-DD, com data real.');

  const externalId = get('identificador_externo').trim();
  if (externalId.length > MAX_EXTERNAL_ID) errors.push(`Identificador externo muito longo (máximo ${MAX_EXTERNAL_ID} caracteres).`);

  const saleReference = get('referencia_venda').trim();
  if (saleReference.length > MAX_SALE_REFERENCE) errors.push(`Referência de venda muito longa (máximo ${MAX_SALE_REFERENCE} caracteres).`);
  else if (saleReference !== '' && direction === 'out') errors.push('referencia_venda só se aplica a contas a receber.');

  if (errors.length > 0 || !direction || !money.ok || !dueDate) return { errors };

  // Assinatura normalizada do conteúdo (categoria fica de fora: recategorizar não cria outro lançamento).
  const signature = [direction, dueDate, money.cents.toString(), normalizeText(description)].join('\u001f');
  const sourceKey = externalId !== '' ? `csv:external:${externalId}` : `csv:hash:${sha256Hex(signature)}`;
  return {
    parsed: {
      signature,
      entry: {
        id: `csv_${sha256Hex(sourceKey).slice(0, 20)}`,
        direction,
        amountCents: money.cents.toString(),
        dueDate,
        description,
        category,
        origin: 'csv',
        sourceKey,
        state: 'scheduled',
        ...(saleReference !== '' ? { saleReference } : {}),
      },
    },
  };
}

/** Lê e valida o CSV de contas, sem efeitos colaterais. Linhas inválidas nunca entram em `valid`. */
export function previewAccountsCsv(input: string): CsvPreview {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = text.split('\n').find((l) => l.trim() !== '');
  if (firstLine === undefined) return fatal('O arquivo está vazio.');

  const { delimiter, columns } = detectDelimiter(firstLine);
  const missing = REQUIRED.filter((r) => !columns.includes(r));
  if (missing.length > 0) return fatal(`Colunas obrigatórias ausentes: ${missing.join(', ')}. Cabeçalho esperado: ${KNOWN.join(';')}.`);
  const repeated = columns.filter((c, i) => columns.indexOf(c) !== i);
  if (repeated.length > 0) return fatal(`Colunas repetidas no cabeçalho: ${[...new Set(repeated)].join(', ')}.`);

  const { records, unclosedAtLine } = tokenize(text, delimiter);
  if (unclosedAtLine !== null) return fatal(`Aspas não fechadas, começando na linha ${unclosedAtLine}.`);

  const headerIndex = records.findIndex((r) => !isBlank(r));
  const dataRecords = records.slice(headerIndex + 1).filter((r) => !isBlank(r));
  if (dataRecords.length > MAX_ROWS) return fatal(`O arquivo excede o limite de ${MAX_ROWS} linhas por importação.`);

  const index = new Map(columns.map((c, i) => [c, i] as const));
  const preview: CsvPreview = { fatalError: null, totalRows: dataRecords.length, valid: [], duplicates: [], invalid: [] };
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
    const { entry, signature } = result.parsed;
    const previous = seen.get(entry.sourceKey);
    if (previous) {
      if (previous.signature === signature) {
        preview.duplicates.push({ line: record.line, duplicateOfLine: previous.line, sourceKey: entry.sourceKey });
      } else {
        preview.invalid.push({
          line: record.line,
          message: `Identificador externo "${entry.sourceKey.replace('csv:external:', '')}" já usado na linha ${previous.line} com dados diferentes; use identificadores distintos para lançamentos distintos.`,
        });
      }
      continue;
    }
    seen.set(entry.sourceKey, { line: record.line, signature });
    preview.valid.push({ line: record.line, entry });
  }
  return preview;
}

export interface ImportPlan {
  fatalError: string | null;
  toCreate: CashEntry[];
  /** Linhas válidas cuja chave já existe no armazenamento. */
  alreadyImported: { line: number; sourceKey: string }[];
  errors: RowError[];
  summary: { created: number; ignored: number; errors: number };
}

/** Decide o que gravar: só chaves ainda inexistentes. Importar o mesmo arquivo de novo cria 0 lançamentos. */
export function planImport(preview: CsvPreview, existingSourceKeys: Iterable<string>): ImportPlan {
  const existing = new Set(existingSourceKeys);
  const toCreate: CashEntry[] = [];
  const alreadyImported: ImportPlan['alreadyImported'] = [];
  if (preview.fatalError === null) {
    for (const { line, entry } of preview.valid) {
      if (existing.has(entry.sourceKey)) alreadyImported.push({ line, sourceKey: entry.sourceKey });
      else toCreate.push(entry);
    }
  }
  return {
    fatalError: preview.fatalError,
    toCreate,
    alreadyImported,
    errors: preview.invalid,
    summary: {
      created: toCreate.length,
      ignored: alreadyImported.length + preview.duplicates.length,
      errors: preview.invalid.length,
    },
  };
}

/**
 * Contas já gravadas (mesma chave de origem) cuja referência de venda mudou ou é nova no arquivo.
 * Só enriquece: referência vazia no arquivo nunca remove a existente; nenhuma conta é criada ou duplicada.
 */
export function planReferenceUpdates(
  preview: CsvPreview,
  existing: readonly CashEntry[],
): { entryId: string; saleReference: string }[] {
  if (preview.fatalError !== null) return [];
  const byKey = new Map(existing.map((e) => [e.sourceKey, e] as const));
  const updates: { entryId: string; saleReference: string }[] = [];
  for (const { entry } of preview.valid) {
    const current = byKey.get(entry.sourceKey);
    if (current && entry.saleReference && current.saleReference !== entry.saleReference) {
      updates.push({ entryId: current.id, saleReference: entry.saleReference });
    }
  }
  return updates;
}
