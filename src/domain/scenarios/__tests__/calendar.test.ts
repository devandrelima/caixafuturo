import { describe, expect, it } from 'vitest';
import { dateInMonth, lastDayOfMonth, monthlyDate } from '../calendar';

describe('lastDayOfMonth', () => {
  it('meses de 30 e 31 dias, fevereiro comum e bissexto (regra do século)', () => {
    expect([1, 3, 5, 7, 8, 10, 12].map((m) => lastDayOfMonth(2026, m))).toEqual([31, 31, 31, 31, 31, 31, 31]);
    expect([4, 6, 9, 11].map((m) => lastDayOfMonth(2026, m))).toEqual([30, 30, 30, 30]);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2100, 2)).toBe(28); // divisível por 100, não por 400
    expect(lastDayOfMonth(2000, 2)).toBe(29);
  });
});

describe('dateInMonth — dia pedido limitado ao último dia do mês', () => {
  it('31 em fevereiro vira 28/29; dia que existe fica como está', () => {
    expect(dateInMonth(2026, 2, 31)).toBe('2026-02-28');
    expect(dateInMonth(2028, 2, 31)).toBe('2028-02-29');
    expect(dateInMonth(2026, 4, 31)).toBe('2026-04-30');
    expect(dateInMonth(2026, 4, 15)).toBe('2026-04-15');
    expect(dateInMonth(2026, 1, 1)).toBe('2026-01-01');
  });
});

describe('monthlyDate — n-ésimo mês preservando a âncora do dia (ADR-0008)', () => {
  it('31/jan → 28/fev → 31/mar → 30/abr (a âncora volta a 31 quando o mês permite)', () => {
    expect([0, 1, 2, 3].map((n) => monthlyDate('2026-01-31', n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('ano bissexto: 31/jan/2028 → 29/fev/2028', () => {
    expect(monthlyDate('2028-01-31', 1)).toBe('2028-02-29');
  });
  it('virada de ano e vários anos: 30/nov/2026 → 30/dez → 30/jan/2027 → 28/fev/2027; +25 meses', () => {
    expect([1, 2, 3].map((n) => monthlyDate('2026-11-30', n))).toEqual(['2026-12-30', '2027-01-30', '2027-02-28']);
    expect(monthlyDate('2026-11-15', 25)).toBe('2028-12-15');
  });
  it('não "arrasta" a âncora: 29/jan → 28/fev → 29/mar (e não 28/mar)', () => {
    expect([1, 2].map((n) => monthlyDate('2027-01-29', n))).toEqual(['2027-02-28', '2027-03-29']);
  });
});
