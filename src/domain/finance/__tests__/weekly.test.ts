import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../dates';
import { project } from '../projection';
import {
  WEEKLY_MAX_WEEKS,
  WEEKLY_PREMISES,
  WEEKLY_UNCERTAINTY_NOTE,
  WeeklyError,
  aggregateWeekly,
  projectWeekly,
  weekStartOf,
  weeklyHorizonDays,
} from '../weekly';
import type { CashEntry, CashSettings } from '../types';

const entry = (id: string, direction: 'in' | 'out', amountCents: number, dueDate: string): CashEntry => ({
  id,
  direction,
  amountCents: String(amountCents),
  dueDate,
  description: id,
  category: '',
  origin: 'manual',
  sourceKey: `manual:${id}`,
  state: 'scheduled',
});

const settings: CashSettings = { baseDate: '2026-11-12', openingBalanceCents: '500000', minimumBalanceCents: '100000' };

// Fixture calculado à mão (data-base quinta 12/11/2026; semanas seg–dom; 13ª termina em 07/02/2027).
const fixture: CashEntry[] = [
  entry('a', 'out', 30000, '2026-11-13'), // sex  — semana 1
  entry('b', 'in', 100000, '2026-11-14'), // sáb  — semana 1
  entry('c', 'out', 20000, '2026-11-16'), // seg  — semana 2
  entry('d', 'in', 50000, '2026-11-19'), //  qui  — semana 2
  entry('e', 'out', 20000, '2026-11-22'), // dom  — semana 2
  entry('f', 'out', 150000, '2026-11-30'), // seg  — semana 4
  entry('g', 'out', 700000, '2026-12-31'), // qui  — semana 8 (atravessa o ano)
  entry('h', 'in', 800000, '2027-01-01'), //  sex  — semana 8
  entry('i', 'in', 10000, '2027-02-07'), //  dom  — semana 13 (último dia do horizonte)
  entry('j', 'in', 999999, '2027-02-08'), //  seg  — FORA do horizonte
  entry('k', 'out', 5000, '2026-11-12'), //  data-base — sinalizado, não entra
];

describe('weekStartOf / weeklyHorizonDays', () => {
  it('segunda-feira é o início da semana (datas conhecidas, inclusive virada de ano)', () => {
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16'); // segunda
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09'); // domingo pertence à semana que começou na segunda anterior
    expect(weekStartOf('2026-11-12')).toBe('2026-11-09'); // quinta
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28'); // sexta, semana atravessa o ano
    expect(weekStartOf('2027-01-03')).toBe('2026-12-28'); // domingo
    expect(weekStartOf('2027-01-04')).toBe('2027-01-04');
  });

  it('horizonte = até o domingo da 13ª semana: quinta ⇒ 87 dias; domingo ⇒ 91; segunda ⇒ 90', () => {
    expect(weeklyHorizonDays('2026-11-12')).toBe(87);
    expect(weeklyHorizonDays('2026-11-15')).toBe(91); // domingo: 1ª semana começa na segunda, completa
    expect(weeklyHorizonDays('2026-11-16')).toBe(90); // segunda: 1ª semana começa na terça (6 dias)
    expect(weeklyHorizonDays('2026-11-12', 1)).toBe(3);
    expect(weeklyHorizonDays('2026-11-12', 4)).toBe(24);
  });

  it('número de semanas fora de 1..13 é recusado', () => {
    expect(() => weeklyHorizonDays('2026-11-12', 0)).toThrow(RangeError);
    expect(() => weeklyHorizonDays('2026-11-12', 14)).toThrow(RangeError);
    expect(() => weeklyHorizonDays('2026-11-12', 1.5)).toThrow(RangeError);
    expect(WEEKLY_MAX_WEEKS).toBe(13);
  });
});

describe('projectWeekly — fixture calculado à mão', () => {
  const { projection, weekly } = projectWeekly(settings, fixture);

  it('13 semanas, 1ª parcial (3 dias), demais completas; corte no domingo 07/02/2027', () => {
    expect(weekly.weeks).toHaveLength(13);
    expect(weekly.weeks.map((w) => w.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(weekly.weeks[0]).toMatchObject({ weekStart: '2026-11-09', startDate: '2026-11-13', endDate: '2026-11-15', days: 3, partial: true });
    expect(weekly.weeks.slice(1).every((w) => w.days === 7 && !w.partial)).toBe(true);
    expect(weekly.weeks[12]).toMatchObject({ startDate: '2027-02-01', endDate: '2027-02-07' });
    expect(projection.points).toHaveLength(87);
  });

  it('abertura, entradas, saídas e fechamento de cada semana com entradas (à mão)', () => {
    const w = weekly.weeks;
    // sem. 1: 5.000,00 +1.000,00 −300,00 = 5.700,00
    expect([w[0]?.openingCents, w[0]?.incomingCents, w[0]?.outgoingCents, w[0]?.closingCents]).toEqual([500000n, 100000n, 30000n, 570000n]);
    // sem. 2: 5.700,00 +500,00 −400,00 = 5.800,00
    expect([w[1]?.openingCents, w[1]?.incomingCents, w[1]?.outgoingCents, w[1]?.closingCents]).toEqual([570000n, 50000n, 40000n, 580000n]);
    // sem. 3: vazia, saldo mantido
    expect([w[2]?.incomingCents, w[2]?.outgoingCents, w[2]?.closingCents]).toEqual([0n, 0n, 580000n]);
    // sem. 4: 5.800,00 −1.500,00 = 4.300,00
    expect([w[3]?.openingCents, w[3]?.outgoingCents, w[3]?.closingCents]).toEqual([580000n, 150000n, 430000n]);
    // sem. 8 (28/12–03/01): 4.300,00 +8.000,00 −7.000,00 = 5.300,00
    expect([w[7]?.openingCents, w[7]?.incomingCents, w[7]?.outgoingCents, w[7]?.closingCents]).toEqual([430000n, 800000n, 700000n, 530000n]);
    expect(w[7]).toMatchObject({ weekStart: '2026-12-28', startDate: '2026-12-28', endDate: '2027-01-03' });
    // sem. 13: 5.300,00 +100,00 = 5.400,00
    expect([w[12]?.incomingCents, w[12]?.closingCents]).toEqual([10000n, 540000n]);
    expect(projection.summary.endingCents).toBe(540000n);
    expect(projection.summary.endingCents).toBe(weekly.weeks[12]?.closingCents);
  });

  it('o fechamento da semana ≠ pior momento: a semana 8 termina positiva mas passou NEGATIVA em 31/12 — o alerta não é escondido', () => {
    const w8 = weekly.weeks[7];
    expect(w8?.closingCents).toBe(530000n);
    expect(w8?.lowestClosingCents).toBe(-270000n); // 4.300,00 − 7.000,00
    expect(w8?.lowestDate).toBe('2026-12-31');
    expect(w8?.risk).toBe('negative');
    expect(w8?.worstShortfallCents).toBe(370000n); // mínimo 1.000,00 − (−2.700,00)
    expect(w8?.riskDays).toBe(1);
    // semana 1 começou em 5.000,00 e mínimo é 1.000,00: tudo ok
    expect(weekly.weeks[0]?.risk).toBe('ok');
    expect(weekly.weeks[0]?.lowestClosingCents).toBe(470000n);
    expect(weekly.weeks[0]?.lowestDate).toBe('2026-11-13');
  });

  it('entradas FORA do horizonte e anteriores/na data-base não entram; ficam rastreáveis', () => {
    expect(weekly.beyondHorizon).toBe(1); // j
    expect(projection.summary.beyondHorizon).toBe(1);
    expect(projection.flagged.map((f) => f.entryId)).toEqual(['k']);
    const ids = weekly.weeks.flatMap((w) => w.entryIds).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(ids).not.toContain('j');
    expect(ids).not.toContain('k');
    expect(weekly.totalIncomingCents).toBe(960000n);
    expect(weekly.totalOutgoingCents).toBe(920000n);
  });

  it('ressalva de incerteza e premissas acompanham a visão (sem previsão de faturamento nem hipótese)', () => {
    expect(weekly.uncertaintyNote).toBe(WEEKLY_UNCERTAINTY_NOTE);
    expect(weekly.premises).toEqual(WEEKLY_PREMISES);
    expect(WEEKLY_UNCERTAINTY_NOTE).toMatch(/incerteza/i);
    expect(WEEKLY_UNCERTAINTY_NOTE).toMatch(/cresce/i);
    expect(WEEKLY_PREMISES.join(' ')).toMatch(/recorr/i);
    expect(WEEKLY_PREMISES.join(' ')).toMatch(/vendas/i);
    expect(WEEKLY_PREMISES.join(' ')).toMatch(/nunca.*faturamento/i);
  });

  it('semanas encadeiam (abertura = fechamento anterior) e cada uma fecha sua conta', () => {
    weekly.weeks.forEach((w, i) => {
      expect(w.closingCents).toBe(w.openingCents + w.incomingCents - w.outgoingCents);
      if (i > 0) expect(w.openingCents).toBe(weekly.weeks[i - 1]?.closingCents);
    });
    expect(weekly.weeks[0]?.openingCents).toBe(500000n);
  });
});

describe('projectWeekly — datas-base diferentes', () => {
  it('data-base DOMINGO: 1ª semana completa e horizonte de 91 dias', () => {
    const { projection, weekly } = projectWeekly({ ...settings, baseDate: '2026-11-15' }, []);
    expect(projection.points).toHaveLength(91);
    expect(weekly.weeks).toHaveLength(13);
    expect(weekly.weeks[0]).toMatchObject({ startDate: '2026-11-16', endDate: '2026-11-22', days: 7, partial: false });
    expect(weekly.weeks[12]?.endDate).toBe('2027-02-14');
  });

  it('data-base SEGUNDA: 1ª semana tem 6 dias (terça a domingo)', () => {
    const { projection, weekly } = projectWeekly({ ...settings, baseDate: '2026-11-16' }, []);
    expect(projection.points).toHaveLength(90);
    expect(weekly.weeks[0]).toMatchObject({ startDate: '2026-11-17', endDate: '2026-11-22', days: 6, partial: true });
  });

  it('menos semanas: 4 semanas cortam em 6/12/2026; lançamento depois disso fica "fora do horizonte"', () => {
    const { weekly } = projectWeekly(settings, [entry('z', 'out', 1000, '2026-12-07')], { weeks: 4 });
    expect(weekly.weeks).toHaveLength(4);
    expect(weekly.weeks[3]?.endDate).toBe('2026-12-06');
    expect(weekly.beyondHorizon).toBe(1);
    expect(weekly.weeks.flatMap((w) => w.entryIds)).toEqual([]);
  });

  it('saldo inicial negativo e mínimo zero: risco herdado nas semanas', () => {
    const { weekly } = projectWeekly({ baseDate: '2026-11-12', openingBalanceCents: '-1000', minimumBalanceCents: '0' }, [entry('x', 'in', 1500, '2026-11-20')]);
    expect(weekly.weeks[0]?.risk).toBe('negative'); // 13–15/11: −10,00
    expect(weekly.weeks[1]?.risk).toBe('negative'); // até 19/11 negativo; 20/11 vira +5,00
    expect(weekly.weeks[1]?.lowestClosingCents).toBe(-1000n);
    expect(weekly.weeks[1]?.closingCents).toBe(500n);
    expect(weekly.weeks[2]?.risk).toBe('ok');
  });
});

describe('aggregateWeekly — agrega o MESMO project() (sem fórmula paralela)', () => {
  it('o recorte em 13 semanas ignora pontos além do 13º domingo (ex.: motor com 120 dias)', () => {
    const long = project(settings, fixture, { horizonDays: 120 });
    const weekly = aggregateWeekly(long.points, long.summary.baseDate);
    expect(weekly.weeks).toHaveLength(13);
    expect(weekly.weeks[12]?.endDate).toBe('2027-02-07');
    // a entrada de 08/02 (j) não vira semana 14
    expect(weekly.weeks.flatMap((w) => w.entryIds)).not.toContain('j');
    expect(weekly.totalIncomingCents).toBe(960000n);
  });

  it('30 dias (horizonte padrão da S01) viram 5 semanas, sem perder nada', () => {
    const p = project(settings, fixture); // 30 dias: 13/11–12/12
    const weekly = aggregateWeekly(p.points, p.summary.baseDate);
    expect(weekly.weeks.map((w) => [w.startDate, w.endDate])).toEqual([
      ['2026-11-13', '2026-11-15'],
      ['2026-11-16', '2026-11-22'],
      ['2026-11-23', '2026-11-29'],
      ['2026-11-30', '2026-12-06'],
      ['2026-12-07', '2026-12-12'], // termina em sábado: o horizonte acabou
    ]);
    expect(weekly.weeks[4]?.days).toBe(6);
    expect(weekly.weeks[4]?.closingCents).toBe(p.summary.endingCents);
  });

  it('lista vazia → nenhuma semana', () => {
    expect(aggregateWeekly([], '2026-11-12').weeks).toEqual([]);
  });

  it('pontos com lacuna de data, fora de ordem ou que não fecham a conta são recusados (dado corrompido não passa)', () => {
    const p = project(settings, fixture).points;
    expect(() => aggregateWeekly([p[0]!, p[2]!], '2026-11-12')).toThrow(WeeklyError);
    expect(() => aggregateWeekly([p[1]!, p[0]!], '2026-11-12')).toThrow(WeeklyError);
    expect(() => aggregateWeekly([{ ...p[0]!, closingCents: p[0]!.closingCents + 1n }], '2026-11-12')).toThrow(WeeklyError);
    // cada ponto fecha a própria conta, mas a cadeia está quebrada (abertura ≠ fechamento anterior)
    const broken = { ...p[1]!, openingCents: p[1]!.openingCents + 100n, closingCents: p[1]!.closingCents + 100n };
    expect(() => aggregateWeekly([p[0]!, broken], '2026-11-12')).toThrow(/abertura/);
    // primeiro ponto deve ser baseDate + 1
    expect(() => aggregateWeekly(p.slice(1), '2026-11-12')).toThrow(WeeklyError);
  });
});

describe('propriedade: saldo semanal = fechamento diário do último dia da semana (dados pseudoaleatórios determinísticos)', () => {
  it('120 rodadas: conciliação exata, encadeamento, totais, sem fórmula paralela, contra cálculo independente', () => {
    let seed = 20261112;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let round = 0; round < 120; round += 1) {
      const baseDate = addDays('2025-11-01', next(900)); // inclui várias viradas de ano e todos os dias da semana
      const opening = next(2_000_000) - 500_000;
      const minimum = next(300_000);
      const horizon = weeklyHorizonDays(baseDate);
      const entries: CashEntry[] = [];
      const count = next(60);
      for (let i = 0; i < count; i += 1) {
        const offset = next(horizon + 40) - 5; // antes da base, dentro e fora do horizonte
        entries.push(entry(`e${round}_${i}`, next(2) === 0 ? 'in' : 'out', 1 + next(400_000), addDays(baseDate, offset)));
      }
      const s: CashSettings = { baseDate, openingBalanceCents: String(opening), minimumBalanceCents: String(minimum) };
      const { projection, weekly } = projectWeekly(s, entries);

      // Cálculo INDEPENDENTE do saldo diário (só entradas agendadas depois da base e até o limite).
      const last = addDays(baseDate, horizon);
      const net = new Map<string, bigint>();
      let expectedIn = 0n;
      let expectedOut = 0n;
      for (const e of entries) {
        if (e.dueDate <= baseDate || e.dueDate > last) continue;
        const v = BigInt(e.amountCents);
        net.set(e.dueDate, (net.get(e.dueDate) ?? 0n) + (e.direction === 'in' ? v : -v));
        if (e.direction === 'in') expectedIn += v;
        else expectedOut += v;
      }
      const closingOn = (date: string): bigint => {
        let bal = BigInt(opening);
        for (let d = addDays(baseDate, 1); d <= date; d = addDays(d, 1)) bal += net.get(d) ?? 0n;
        return bal;
      };

      expect(weekly.weeks.length).toBeLessThanOrEqual(13);
      expect(weekly.weeks[weekly.weeks.length - 1]?.endDate).toBe(last);
      let totalDays = 0;
      weekly.weeks.forEach((w, i) => {
        expect(w.closingCents, `${baseDate} semana ${w.index}`).toBe(closingOn(w.endDate));
        expect(w.closingCents).toBe(projection.points.find((p) => p.date === w.endDate)?.closingCents);
        expect(w.openingCents).toBe(i === 0 ? BigInt(opening) : closingOn(addDays(w.startDate, -1)));
        expect(w.closingCents).toBe(w.openingCents + w.incomingCents - w.outgoingCents);
        // semana segunda–domingo, sem buracos
        expect(weekStartOf(w.endDate)).toBe(w.weekStart);
        expect(daysBetween(w.startDate, w.endDate) + 1).toBe(w.days);
        if (i > 0) {
          expect(w.startDate).toBe(w.weekStart);
          expect(w.startDate).toBe(addDays(weekly.weeks[i - 1]!.endDate, 1));
        }
        totalDays += w.days;
        // risco da semana = pior dia
        const days = projection.points.filter((p) => p.date >= w.startDate && p.date <= w.endDate);
        expect(w.riskDays).toBe(days.filter((p) => p.risk !== 'ok').length);
        expect(w.lowestClosingCents).toBe(days.reduce((m, p) => (p.closingCents < m ? p.closingCents : m), days[0]!.closingCents));
        const anyNegative = days.some((p) => p.risk === 'negative');
        const anyBelow = days.some((p) => p.risk === 'below_minimum');
        expect(w.risk).toBe(anyNegative ? 'negative' : anyBelow ? 'below_minimum' : 'ok');
      });
      expect(totalDays).toBe(horizon);
      expect(weekly.totalIncomingCents).toBe(expectedIn);
      expect(weekly.totalOutgoingCents).toBe(expectedOut);
      expect(weekly.weeks.reduce((a, w) => a + w.incomingCents, 0n)).toBe(expectedIn);
      expect(weekly.weeks[weekly.weeks.length - 1]?.closingCents).toBe(projection.summary.endingCents);
    }
  });
});
