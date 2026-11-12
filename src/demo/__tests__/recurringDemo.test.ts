import { describe, expect, it } from 'vitest';
import { expandRecurrences, validateRule } from '../../domain/finance/recurrence';
import { project } from '../../domain/finance/projection';
import { projectWeekly, weeklyHorizonDays } from '../../domain/finance/weekly';
import { createRestaurantDemo } from '../restaurant';
import { createRecurringDemo } from '../recurringDemo';

const restaurant = createRestaurantDemo();
const demo = createRecurringDemo();
const base = restaurant.settings.baseDate; // 2026-11-11 (quarta-feira)
const horizonEnd = '2027-02-07'; // domingo da 13ª semana
const all = () => {
  const { entries, covered } = expandRecurrences(demo.rules, [...restaurant.entries, ...demo.entries], { from: '2026-11-12', to: horizonEnd });
  return { entries: [...restaurant.entries, ...demo.entries, ...entries], calculated: entries, covered };
};

describe('fixture de recorrências (dados fictícios, calculados à mão)', () => {
  it('é determinística: duas chamadas dão o mesmo e objetos independentes', () => {
    expect(createRecurringDemo()).toEqual(createRecurringDemo());
    const a = createRecurringDemo();
    a.rules[0]!.amountCents = '1';
    expect(createRecurringDemo().rules[0]!.amountCents).not.toBe('1');
  });

  it('todas as regras são válidas, com ids estáveis e descrição marcada como fictícia', () => {
    expect(demo.rules.map((r) => r.id)).toEqual(['demo-rec-condominio', 'demo-rec-fornecedor', 'demo-rec-eventos', 'demo-rec-seguro']);
    for (const r of demo.rules) {
      expect(validateRule(r), r.id).toEqual([]);
      expect(r.description).toMatch(/fictíci/i);
    }
  });

  it('cobre os casos pedidos: dia 31, semanal, data final e uma já liquidada', () => {
    const [condo, fornecedor, eventos] = demo.rules;
    expect([condo?.frequency, condo?.startDate.slice(8)]).toEqual(['monthly', '31']);
    expect(fornecedor?.frequency).toBe('weekly');
    expect(eventos?.endDate).toBe('2026-12-15');
    expect(demo.entries).toHaveLength(1);
    expect(demo.entries[0]).toMatchObject({ origin: 'recurring', state: 'settled', sourceKey: 'rec:demo-rec-seguro:2026-11-20', dueDate: '2026-11-20', amountCents: '58000' });
  });

  it('NÃO altera a demo do restaurante: sem regras, os números da S01 seguem iguais (12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 · 15/11 R$ 3.300)', () => {
    const result = project(restaurant.settings, restaurant.entries);
    const closing = (d: string) => result.points.find((p) => p.date === d)?.closingCents;
    expect([closing('2026-11-12'), closing('2026-11-13'), closing('2026-11-14'), closing('2026-11-15')]).toEqual([50000n, 130000n, -70000n, 330000n]);
    expect(restaurant.entries).toHaveLength(4);
  });
});

describe('expansão sobre a demo do restaurante (data-base 11/11/2026)', () => {
  it('19 ocorrências calculadas + 1 coberta pela liquidada; contagem por regra à mão', () => {
    const { calculated, covered } = all();
    const count = (rule: string) => calculated.filter((e) => e.sourceKey.startsWith(`rec:${rule}:`)).length;
    expect(count('demo-rec-condominio')).toBe(3); // 30/11, 31/12, 31/01
    expect(count('demo-rec-fornecedor')).toBe(12); // segundas 16/11 … 01/02
    expect(count('demo-rec-eventos')).toBe(2); // 15/11 e 15/12 (fim inclusivo)
    expect(count('demo-rec-seguro')).toBe(2); // 20/12 e 20/01; 20/11 está liquidada
    expect(calculated).toHaveLength(19);
    expect(covered).toEqual([{ ruleId: 'demo-rec-seguro', date: '2026-11-20', sourceKey: 'rec:demo-rec-seguro:2026-11-20', reason: 'materialized', entryId: demo.entries[0]?.id }]);
  });

  it('31/jan em meses curtos: condomínio cai em 30/11, 31/12 e 31/01 (e iria a 28/02 se a janela fosse maior)', () => {
    const condo = all().calculated.filter((e) => e.sourceKey.startsWith('rec:demo-rec-condominio:')).map((e) => e.dueDate);
    expect(condo).toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
    const longer = expandRecurrences([demo.rules[0]!], [], { from: '2027-02-01', to: '2027-03-31' }).entries.map((e) => e.dueDate);
    expect(longer).toEqual(['2027-02-28', '2027-03-31']);
  });

  it('saldo diário (30 dias): 15/11 R$ 4.500,00 · 30/11 R$ 1.650,00 · 07/12 R$ 1.300,00 · 11/12 R$ 1.300,00', () => {
    const result = project(restaurant.settings, all().entries);
    const closing = (d: string) => result.points.find((p) => p.date === d)?.closingCents;
    expect(result.points).toHaveLength(30);
    expect(closing('2026-11-14')).toBe(-70000n); // inalterado
    expect(closing('2026-11-15')).toBe(450000n); // 3.300,00 + 1.200,00 do contrato de eventos
    expect(closing('2026-11-16')).toBe(415000n);
    expect(closing('2026-11-20')).toBe(415000n); // seguro liquidado de 20/11 NÃO desconta (R$ 4.150,00)
    expect(closing('2026-11-30')).toBe(165000n); // −350,00 fornecedor −1.800,00 condomínio
    expect(closing('2026-12-07')).toBe(130000n);
    expect(closing('2026-12-11')).toBe(130000n);
    expect(result.duplicates).toEqual([]);
  });

  it('13 semanas (88 dias): fechamentos de domingo à mão e fim em −R$ 5.100,00; semana 8 fica negativa em 31/12', () => {
    const { projection, weekly } = projectWeekly(restaurant.settings, all().entries);
    expect(weeklyHorizonDays(base)).toBe(88);
    expect(weekly.weeks).toHaveLength(13);
    expect(weekly.weeks.map((w) => w.closingCents)).toEqual([
      450000n, // 15/11
      415000n, // 22/11
      380000n, // 29/11
      165000n, // 06/12
      130000n, // 13/12
      155000n, // 20/12 (+1.200,00 evento 15/12, −350,00 14/12, −600,00 seguro)
      120000n, // 27/12
      -95000n, // 03/01 (31/12: −1.800,00 condomínio)
      -130000n, // 10/01
      -165000n, // 17/01
      -260000n, // 24/01 (18/01 −350,00; 20/01 −600,00)
      -475000n, // 31/01
      -510000n, // 07/02
    ]);
    expect(projection.summary.endingCents).toBe(-510000n);
    expect(projection.summary.firstNegative?.date).toBe('2026-11-14'); // da demo S01, inalterada
    expect(weekly.weeks[7]?.lowestDate).toBe('2026-12-31'); // 1º dia negativo causado pelas recorrências (−R$ 950,00)
    expect(weekly.weeks[7]?.risk).toBe('negative');
    expect(weekly.weeks[0]?.risk).toBe('negative'); // 14/11 fecha em −700,00
    expect(weekly.weeks[4]?.risk).toBe('ok'); // 07–13/12: nunca abaixo de 1.300,00
    expect(weekly.weeks[5]?.risk).toBe('below_minimum'); // 14/12 fecha em 950,00 < mínimo 1.000,00
    expect(weekly.weeks[5]?.lowestClosingCents).toBe(95000n);
  });

  it('recarregar a fixture é idempotente: nada novo é gerado ao reinjetar o que já existe', () => {
    const first = all();
    const again = expandRecurrences(demo.rules, [...first.entries], { from: '2026-11-12', to: horizonEnd });
    expect(again.entries).toEqual([]);
    expect(again.covered).toHaveLength(20);
  });
});
