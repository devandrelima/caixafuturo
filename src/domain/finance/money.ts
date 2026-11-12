import type { CentString } from './types';

export type MoneyResult = { ok: true; cents: bigint } | { ok: false; reason: string };

export interface ParseBRLOptions {
  allowNegative?: boolean;
  allowZero?: boolean;
}

// pt-BR estrito: milhar com ponto em grupos de 3, vírgula decimal com 1–2 dígitos.
const BRL_PATTERN = /^(-)?(?:R\$\s*)?(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const CENT_STRING = /^-?\d+$/;

/** Converte texto pt-BR (ex.: "R$ 1.234,56") em centavos exatos, sem usar ponto flutuante. */
export function parseBRL(input: string, options: ParseBRLOptions = {}): MoneyResult {
  if (typeof input !== 'string') return { ok: false, reason: 'Valor inválido: informe um texto.' };
  const text = input.trim();
  if (text === '') return { ok: false, reason: 'Valor obrigatório.' };
  const match = BRL_PATTERN.exec(text);
  if (!match) return { ok: false, reason: 'Valor inválido: use o formato 1.234,56.' };
  const [, sign1, sign2, integerPart = '', decimalPart = ''] = match;
  const negative = Boolean(sign1 || sign2);
  if (sign1 && sign2) return { ok: false, reason: 'Valor inválido: sinal repetido.' };
  const reais = BigInt(integerPart.replace(/\./g, ''));
  const centavos = BigInt(decimalPart.padEnd(2, '0') || '0');
  const magnitude = reais * 100n + centavos;
  if (magnitude === 0n) {
    return options.allowZero ? { ok: true, cents: 0n } : { ok: false, reason: 'Valor deve ser maior que zero.' };
  }
  if (negative && !options.allowNegative) return { ok: false, reason: 'Valor não pode ser negativo.' };
  return { ok: true, cents: negative ? -magnitude : magnitude };
}

/** Formata centavos como BRL: "R$ 1.234,56" ou "-R$ 700,00". */
export function formatBRL(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const reais = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${reais},${centavos}`;
}

export function centsToString(cents: bigint): CentString {
  return cents.toString();
}

/** Restaura centavos persistidos. Lança erro se a string não for um inteiro decimal. */
export function centsFromString(value: CentString): bigint {
  if (typeof value !== 'string' || !CENT_STRING.test(value)) {
    throw new Error(`Valor em centavos inválido: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}
