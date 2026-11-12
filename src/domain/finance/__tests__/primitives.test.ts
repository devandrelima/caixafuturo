import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareISO,
  daysBetween,
  formatBR,
  isValidISODate,
  parseBRDate,
  parseDateInput,
  rangeAfter,
  todayISO,
} from '../dates';
import { centsFromString, centsToString, formatBRL, parseBRL } from '../money';

describe('money: parseBRL', () => {
  it('converte R$ 1.234,56 em 123456 centavos exatos', () => {
    expect(parseBRL('R$ 1.234,56')).toEqual({ ok: true, cents: 123456n });
    expect(parseBRL('1.234,56')).toEqual({ ok: true, cents: 123456n });
  });

  it('aceita inteiros, uma casa decimal e milhões', () => {
    expect(parseBRL('10')).toEqual({ ok: true, cents: 1000n });
    expect(parseBRL('10,5')).toEqual({ ok: true, cents: 1050n });
    expect(parseBRL('0,01')).toEqual({ ok: true, cents: 1n });
    expect(parseBRL('1.234.567,89')).toEqual({ ok: true, cents: 123456789n });
    expect(parseBRL('  2.500,00  ')).toEqual({ ok: true, cents: 250000n });
  });

  it('não perde precisão com valores acima de Number.MAX_SAFE_INTEGER', () => {
    const big = parseBRL('9.007.199.254.740.993,99');
    expect(big).toEqual({ ok: true, cents: 900719925474099399n });
  });

  it.each(['', '   ', 'abc', '1,234,56', '1.23,45', '12,345', '1e3', '1,2e3', '--5', '1.2.3', 'R$', '1 000,00', '١٢٣', '0x10', 'NaN', 'Infinity'])(
    'rejeita valor inválido %j',
    (input) => {
      expect(parseBRL(input).ok).toBe(false);
    },
  );

  it('rejeita zero e negativos por padrão (contas são magnitude positiva)', () => {
    expect(parseBRL('0,00').ok).toBe(false);
    expect(parseBRL('-10,00').ok).toBe(false);
  });

  it('permite negativo e zero quando solicitado (saldos)', () => {
    expect(parseBRL('-700,00', { allowNegative: true, allowZero: true })).toEqual({ ok: true, cents: -70000n });
    expect(parseBRL('0', { allowNegative: true, allowZero: true })).toEqual({ ok: true, cents: 0n });
    expect(parseBRL('-0,00', { allowNegative: true, allowZero: true })).toEqual({ ok: true, cents: 0n });
    expect(parseBRL('-R$ 1,50', { allowNegative: true })).toEqual({ ok: true, cents: -150n });
  });

  it('não aceita entrada que não seja string', () => {
    expect(parseBRL(undefined as unknown as string).ok).toBe(false);
    expect(parseBRL(12.5 as unknown as string).ok).toBe(false);
  });

  it('retorna motivo legível para o erro', () => {
    const r = parseBRL('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/valor/i);
  });
});

describe('money: formatBRL e strings de centavos', () => {
  it('formata centavos em BRL', () => {
    expect(formatBRL(123456n)).toBe('R$ 1.234,56');
    expect(formatBRL(50000n)).toBe('R$ 500,00');
    expect(formatBRL(5n)).toBe('R$ 0,05');
    expect(formatBRL(0n)).toBe('R$ 0,00');
    expect(formatBRL(123456789n)).toBe('R$ 1.234.567,89');
  });

  it('formata negativos com sinal antes do símbolo', () => {
    expect(formatBRL(-70000n)).toBe('-R$ 700,00');
    expect(formatBRL(-1n)).toBe('-R$ 0,01');
  });

  it('serializa e restaura centavos como string, sem float', () => {
    expect(centsToString(123456n)).toBe('123456');
    expect(centsFromString('123456')).toBe(123456n);
    expect(centsFromString('-70000')).toBe(-70000n);
    expect(centsFromString(centsToString(900719925474099399n))).toBe(900719925474099399n);
  });

  it.each(['', '1.5', '1e3', ' 1', 'abc', '+5', '--1'])('centsFromString rejeita %j', (s) => {
    expect(() => centsFromString(s)).toThrow(/centavos/i);
  });

  it('soma de centavos é exata (0,10 + 0,20 = 0,30)', () => {
    const a = parseBRL('0,10');
    const b = parseBRL('0,20');
    if (!a.ok || !b.ok) throw new Error('parse');
    expect(formatBRL(a.cents + b.cents)).toBe('R$ 0,30');
  });
});

describe('dates: datas civis ISO', () => {
  it('valida datas reais, inclusive bissexto', () => {
    expect(isValidISODate('2026-11-12')).toBe(true);
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-00-10')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
    expect(isValidISODate('2026-4-1')).toBe(false);
    expect(isValidISODate('2026-11-12T00:00:00Z')).toBe(false);
    expect(isValidISODate('')).toBe(false);
    expect(isValidISODate(undefined as unknown as string)).toBe(false);
  });

  it('addDays atravessa fim de mês, ano e bissexto', () => {
    expect(addDays('2026-11-11', 1)).toBe('2026-11-12');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-11-11', 30)).toBe('2026-12-11');
  });

  it('addDays rejeita data inválida', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(/data/i);
  });

  it('daysBetween e compareISO', () => {
    expect(daysBetween('2026-11-11', '2026-12-11')).toBe(30);
    expect(daysBetween('2026-12-11', '2026-11-11')).toBe(-30);
    expect(daysBetween('2026-11-11', '2026-11-11')).toBe(0);
    expect(compareISO('2026-11-11', '2026-11-12')).toBeLessThan(0);
    expect(compareISO('2026-11-12', '2026-11-11')).toBeGreaterThan(0);
    expect(compareISO('2026-11-12', '2026-11-12')).toBe(0);
  });

  it('rangeAfter gera N datas civis a partir do dia seguinte à data-base', () => {
    const r = rangeAfter('2026-11-11', 30);
    expect(r).toHaveLength(30);
    expect(r[0]).toBe('2026-11-12');
    expect(r[29]).toBe('2026-12-11');
    expect(new Set(r).size).toBe(30);
  });

  it('formata e interpreta DD/MM/AAAA', () => {
    expect(formatBR('2026-11-14')).toBe('14/11/2026');
    expect(parseBRDate('14/11/2026')).toBe('2026-11-14');
    expect(parseBRDate('1/2/2026')).toBeNull();
    expect(parseBRDate('31/04/2026')).toBeNull();
    expect(parseBRDate('2026-11-14')).toBeNull();
  });

  it('parseDateInput aceita DD/MM/YYYY e ISO', () => {
    expect(parseDateInput('14/11/2026')).toBe('2026-11-14');
    expect(parseDateInput('2026-11-14')).toBe('2026-11-14');
    expect(parseDateInput(' 2026-11-14 ')).toBe('2026-11-14');
    expect(parseDateInput('2026-11-31')).toBeNull();
    expect(parseDateInput('amanhã')).toBeNull();
  });

  it('não depende do fuso do ambiente: addDays/format são estáveis em qualquer TZ', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Sao_Paulo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata']) {
        process.env.TZ = tz;
        expect(addDays('2026-11-14', 0)).toBe('2026-11-14');
        expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
        expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
        expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
        expect(formatBR('2026-11-14')).toBe('14/11/2026');
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('todayISO usa os componentes locais da data (dia civil do usuário)', () => {
    expect(todayISO(new Date(2026, 10, 12, 23, 59, 59))).toBe('2026-11-12');
    expect(todayISO(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
  });
});
