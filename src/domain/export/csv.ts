import type { CashEntry, DailyPoint } from '../finance/types';
import type { WeekSummary } from '../finance/weekly';

/**
 * Exportação CSV (S04, F30). Contratos: importacao.md (Exportação) e ADR-0008 D10–D12.
 * UTF-8 com BOM, separador `;`, decimal com vírgula, CRLF, datas ISO. Gerado no navegador; nada é enviado.
 */

export const CSV_BOM = '﻿';
const DELIMITER = ';';
const EOL = '\r\n';

export const ENTRIES_HEADER = ['tipo', 'descricao', 'valor', 'vencimento', 'categoria', 'identificador_externo', 'referencia_venda'] as const;
export const DAILY_HEADER = ['data', 'abertura', 'abertura_centavos', 'entradas', 'entradas_centavos', 'saidas', 'saidas_centavos', 'fechamento', 'fechamento_centavos', 'risco', 'falta_minimo', 'falta_minimo_centavos', 'ids_lancamentos'] as const;
export const WEEKLY_HEADER = ['semana', 'inicio', 'fim', 'dias', 'parcial', 'abertura', 'abertura_centavos', 'entradas', 'entradas_centavos', 'saidas', 'saidas_centavos', 'saldo_final', 'saldo_final_centavos', 'pior_saldo', 'pior_saldo_centavos', 'pior_dia', 'risco', 'ids_lancamentos'] as const;

// Primeiro caractere (após espaços, inclusive NBSP, e quebras à esquerda; `\s` já cobre U+00A0) que uma planilha pode ler como fórmula: = + - @ TAB CR.
const FORMULA_START = /^\s*[=+\-@\t\r]/;

/** Prefixa apóstrofo em texto que iniciaria fórmula; o resto passa intacto ("-5% desconto" fica legível). */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Campo de TEXTO: neutraliza fórmula e escapa (aspas dobradas) quando houver `;`, `"`, CR ou LF. */
export function csvField(text: string): string {
  const safe = neutralizeFormula(text);
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Célula numérica: só se cria por funções de formatação de inteiros/centavos, nunca a partir de texto livre. */
class NumCell {
  constructor(readonly text: string) {}
}
type Cell = string | NumCell;

/** Centavos → decimal pt-BR sem separador de milhar: 123456n → "1234,56"; -70000n → "-700,00". Aritmética BigInt. */
export function formatCentsDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n},${(abs % 100n).toString().padStart(2, '0')}`;
}

const money = (cents: bigint): NumCell => new NumCell(formatCentsDecimal(cents));
const cents = (value: bigint): NumCell => new NumCell(value.toString());
const int = (value: number): NumCell => new NumCell(String(Math.trunc(value)));

const cell = (c: Cell): string => (c instanceof NumCell ? c.text : csvField(c));

function buildCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [header.map(csvField).join(DELIMITER), ...rows.map((row) => row.map(cell).join(DELIMITER))];
  return `${CSV_BOM}${lines.join(EOL)}${EOL}`;
}

/** Identificador que o importador de contas reconhece: só `csv:external:` volta ao original (ADR-0008 D12). */
function externalIdOf(entry: CashEntry): string {
  if (entry.origin === 'csv') {
    if (entry.sourceKey.startsWith('csv:external:')) return entry.sourceKey.slice('csv:external:'.length);
    if (entry.sourceKey.startsWith('csv:hash:')) return '';
  }
  return entry.sourceKey;
}

export interface EntriesExport {
  csv: string;
  rowCount: number;
  /** Liquidados que ficaram de fora (o formato é de contas a vencer). */
  skippedSettled: number;
}

/** Lançamentos AGENDADOS no formato do CSV de contas (reimportável). Exporta exatamente a lista recebida. */
export function entriesToCsv(entries: readonly CashEntry[]): EntriesExport {
  const scheduled = entries.filter((e) => e.state === 'scheduled');
  const rows = scheduled.map((e): Cell[] => [
    e.direction === 'in' ? 'receber' : 'pagar',
    e.description,
    money(BigInt(e.amountCents)),
    e.dueDate,
    e.category,
    externalIdOf(e),
    e.saleReference ?? '',
  ]);
  return { csv: buildCsv(ENTRIES_HEADER, rows), rowCount: scheduled.length, skippedSettled: entries.length - scheduled.length };
}

/** Projeção diária do motor (leitura/análise; não reimportável). */
export function dailyToCsv(points: readonly DailyPoint[]): string {
  return buildCsv(
    DAILY_HEADER,
    points.map((p): Cell[] => [
      p.date,
      money(p.openingCents),
      cents(p.openingCents),
      money(p.incomingCents),
      cents(p.incomingCents),
      money(p.outgoingCents),
      cents(p.outgoingCents),
      money(p.closingCents),
      cents(p.closingCents),
      p.risk,
      money(p.shortfallCents),
      cents(p.shortfallCents),
      p.entryIds.join(' | '),
    ]),
  );
}

/** Visão semanal (leitura/análise; não reimportável). */
export function weeklyToCsv(weeks: readonly WeekSummary[]): string {
  return buildCsv(
    WEEKLY_HEADER,
    weeks.map((w): Cell[] => [
      int(w.index),
      w.startDate,
      w.endDate,
      int(w.days),
      w.partial ? 'sim' : 'não',
      money(w.openingCents),
      cents(w.openingCents),
      money(w.incomingCents),
      cents(w.incomingCents),
      money(w.outgoingCents),
      cents(w.outgoingCents),
      money(w.closingCents),
      cents(w.closingCents),
      money(w.lowestClosingCents),
      cents(w.lowestClosingCents),
      w.lowestDate,
      w.risk,
      w.entryIds.join(' | '),
    ]),
  );
}
