import type { ISODate } from './types';

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const MS_PER_DAY = 86_400_000;

function utcMs(year: number, month: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function parts(iso: ISODate): { y: number; m: number; d: number } | null {
  const match = typeof iso === 'string' ? ISO_PATTERN.exec(iso) : null;
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) return null;
  const check = new Date(utcMs(y, m, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function fromMs(ms: number): ISODate {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

function msOf(iso: ISODate): number {
  const p = parts(iso);
  if (!p) throw new Error(`Data inválida: ${JSON.stringify(iso)}`);
  return utcMs(p.y, p.m, p.d);
}

export function isValidISODate(value: string): boolean {
  return parts(value) !== null;
}

/** Soma dias a uma data civil usando apenas aritmética UTC (sem efeito de fuso ou horário de verão). */
export function addDays(iso: ISODate, days: number): ISODate {
  return fromMs(msOf(iso) + days * MS_PER_DAY);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((msOf(to) - msOf(from)) / MS_PER_DAY);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `count` datas civis consecutivas começando no dia seguinte a `baseDate`. */
export function rangeAfter(baseDate: ISODate, count: number): ISODate[] {
  return Array.from({ length: count }, (_, i) => addDays(baseDate, i + 1));
}

/** ISO → DD/MM/AAAA (exibição). */
export function formatBR(iso: ISODate): string {
  const p = parts(iso);
  if (!p) throw new Error(`Data inválida: ${JSON.stringify(iso)}`);
  return `${pad(p.d, 2)}/${pad(p.m, 2)}/${pad(p.y, 4)}`;
}

/** DD/MM/AAAA → ISO, ou null se inválida. */
export function parseBRDate(text: string): ISODate | null {
  const match = typeof text === 'string' ? BR_PATTERN.exec(text) : null;
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidISODate(iso) ? iso : null;
}

/** Aceita DD/MM/AAAA ou AAAA-MM-DD; retorna ISO ou null. */
export function parseDateInput(text: string): ISODate | null {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (isValidISODate(value)) return value;
  return parseBRDate(value);
}

/** Data civil de hoje no fuso local do usuário. */
export function todayISO(now: Date = new Date()): ISODate {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}
