import { describe, expect, it } from 'vitest';
import { project } from '../../domain/finance/projection';
import { formatBRL } from '../../domain/finance/money';
import { createRestaurantDemo, DEMO_BASE_DATE } from '../restaurant';

describe('fixture do restaurante fictício (contrato demo-s01)', () => {
  it('configuração: data-base 11/11/2026, saldo R$ 3.000, mínimo R$ 1.000', () => {
    const { settings } = createRestaurantDemo();
    expect(DEMO_BASE_DATE).toBe('2026-11-11');
    expect(settings).toEqual({ baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' });
  });

  it('4 lançamentos com IDs estáveis, origem demo e estado agendado', () => {
    const { entries } = createRestaurantDemo();
    expect(entries.map((e) => [e.id, e.direction, e.dueDate, e.amountCents])).toEqual([
      ['demo-despesa-01', 'out', '2026-11-12', '250000'],
      ['demo-receita-01', 'in', '2026-11-13', '80000'],
      ['demo-despesa-02', 'out', '2026-11-14', '200000'],
      ['demo-receita-02', 'in', '2026-11-15', '400000'],
    ]);
    for (const e of entries) {
      expect(e.origin).toBe('demo');
      expect(e.state).toBe('scheduled');
      expect(e.sourceKey).toBe(`demo:${e.id}`);
      expect(e.description).toMatch(/fictíci/i);
    }
  });

  it('cada chamada devolve objetos novos (sem referência mutável compartilhada)', () => {
    const a = createRestaurantDemo();
    const b = createRestaurantDemo();
    expect(a).toEqual(b);
    expect(a.settings).not.toBe(b.settings);
    expect(a.entries).not.toBe(b.entries);
    a.entries[0]!.amountCents = '1';
    a.settings.openingBalanceCents = '1';
    expect(createRestaurantDemo().entries[0]?.amountCents).toBe('250000');
    expect(createRestaurantDemo().settings.openingBalanceCents).toBe('300000');
  });

  it('o MOTOR (não constantes) produz os saldos esperados do contrato', () => {
    const { settings, entries } = createRestaurantDemo();
    const { points, summary } = project(settings, entries);
    const closing = (d: string) => formatBRL(points.find((p) => p.date === d)!.closingCents);
    expect(closing('2026-11-12')).toBe('R$ 500,00');
    expect(closing('2026-11-13')).toBe('R$ 1.300,00');
    expect(closing('2026-11-14')).toBe('-R$ 700,00');
    expect(closing('2026-11-15')).toBe('R$ 3.300,00');
    expect(closing('2026-12-11')).toBe('R$ 3.300,00');
    expect(formatBRL(points.find((p) => p.date === '2026-11-14')!.shortfallCents)).toBe('R$ 1.700,00');
    expect(points.find((p) => p.date === '2026-11-14')!.risk).toBe('negative');
    expect(summary.firstRisk?.date).toBe('2026-11-12');
    expect(summary.firstNegative?.date).toBe('2026-11-14');
  });

  it('editar um valor da fixture muda o alerta (a fixture alimenta o motor)', () => {
    const { settings, entries } = createRestaurantDemo();
    const edited = entries.map((e) => (e.id === 'demo-despesa-02' ? { ...e, amountCents: '100000' } : e));
    const { points } = project(settings, edited);
    expect(points.find((p) => p.date === '2026-11-14')?.closingCents).toBe(30000n);
  });
});
