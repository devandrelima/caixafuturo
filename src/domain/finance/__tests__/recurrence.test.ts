import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../import/sha256';
import { addDays } from '../dates';
import { project } from '../projection';
import {
  expandRecurrences,
  occurrenceDates,
  occurrenceEntry,
  recurrenceSourceKey,
  validateRule,
  type RecurrenceRule,
} from '../recurrence';
import type { CashEntry, CashSettings } from '../types';

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  id: 'r1',
  direction: 'out',
  amountCents: '150000',
  description: 'Aluguel',
  category: 'Fixas',
  frequency: 'monthly',
  startDate: '2026-01-31',
  ...over,
});

const manual = (over: Partial<CashEntry> = {}): CashEntry => ({
  id: 'm1',
  direction: 'out',
  amountCents: '150000',
  dueDate: '2026-12-31',
  description: 'Aluguel',
  category: '',
  origin: 'manual',
  sourceKey: 'manual:m1',
  state: 'scheduled',
  ...over,
});

describe('occurrenceDates — mensal e dia 31 (valores calculados à mão)', () => {
  it('31/jan usa o último dia dos meses curtos e VOLTA ao 31 (âncora preservada), atravessando o ano', () => {
    expect(occurrenceDates(rule(), '2026-01-01', '2027-03-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
  });

  it('ano bissexto: 31/jan → 29/fev', () => {
    expect(occurrenceDates(rule({ startDate: '2024-01-31' }), '2024-01-01', '2024-04-30')).toEqual([
      '2024-01-31',
      '2024-02-29',
      '2024-03-31',
      '2024-04-30',
    ]);
  });

  it('dia 30 e 29 em fevereiro (comum e bissexto)', () => {
    expect(occurrenceDates(rule({ startDate: '2026-01-30' }), '2026-01-01', '2026-03-31')).toEqual(['2026-01-30', '2026-02-28', '2026-03-30']);
    expect(occurrenceDates(rule({ startDate: '2026-01-29' }), '2026-01-01', '2026-03-31')).toEqual(['2026-01-29', '2026-02-28', '2026-03-29']);
    expect(occurrenceDates(rule({ startDate: '2028-01-29' }), '2028-01-01', '2028-03-31')).toEqual(['2028-01-29', '2028-02-29', '2028-03-29']);
  });

  it('virada de ano com dia 15 e janela começando no meio da série', () => {
    expect(occurrenceDates(rule({ startDate: '2026-11-15' }), '2026-11-01', '2027-02-28')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15']);
    expect(occurrenceDates(rule({ startDate: '2026-11-15' }), '2026-12-01', '2027-01-31')).toEqual(['2026-12-15', '2027-01-15']);
  });

  it('série antiga: avança sem gerar o passado fora da janela (31/jan/2020 → nov e dez/2026)', () => {
    expect(occurrenceDates(rule({ startDate: '2020-01-31' }), '2026-11-13', '2026-12-31')).toEqual(['2026-11-30', '2026-12-31']);
  });
});

describe('occurrenceDates — semanal, quinzenal, anual', () => {
  it('semanal de 7 em 7 dias; ocorrência anterior à janela não entra', () => {
    expect(occurrenceDates(rule({ frequency: 'weekly', startDate: '2026-11-02' }), '2026-11-02', '2026-12-01')).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
    expect(occurrenceDates(rule({ frequency: 'weekly', startDate: '2026-11-02' }), '2026-11-10', '2026-12-01')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30']);
  });

  it('semanal atravessa a virada de ano', () => {
    expect(occurrenceDates(rule({ frequency: 'weekly', startDate: '2026-12-21' }), '2026-12-01', '2027-01-12')).toEqual(['2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11']);
  });

  it('quinzenal = 14 dias', () => {
    expect(occurrenceDates(rule({ frequency: 'biweekly', startDate: '2026-11-02' }), '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
      '2026-12-14',
      '2026-12-28',
    ]);
  });

  it('anual: 29/fev vira 28/fev em ano comum e volta a 29/fev no bissexto', () => {
    expect(occurrenceDates(rule({ frequency: 'yearly', startDate: '2024-02-29' }), '2024-01-01', '2029-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
      '2029-02-28',
    ]);
    expect(occurrenceDates(rule({ frequency: 'yearly', startDate: '2026-03-15' }), '2026-01-01', '2028-12-31')).toEqual(['2026-03-15', '2027-03-15', '2028-03-15']);
  });
});

describe('occurrenceDates — limites, exclusão de data e segurança', () => {
  it('data inicial e final INCLUSIVAS', () => {
    const r = rule({ startDate: '2026-01-15', endDate: '2026-03-15' });
    expect(occurrenceDates(r, '2026-01-15', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    expect(occurrenceDates(rule({ startDate: '2026-01-15', endDate: '2026-03-14' }), '2025-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15']);
    // janela terminando exatamente na ocorrência também a inclui
    expect(occurrenceDates(rule({ startDate: '2026-01-15' }), '2026-02-15', '2026-02-15')).toEqual(['2026-02-15']);
  });

  it('fim no dia 31 em mês curto: a ocorrência ajustada (28/fev) respeita endDate=28/fev', () => {
    expect(occurrenceDates(rule({ endDate: '2026-02-28' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-02-28']);
    expect(occurrenceDates(rule({ endDate: '2026-02-27' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-31']);
  });

  it('janela fora do período da regra → vazio; janela invertida → vazio', () => {
    expect(occurrenceDates(rule({ startDate: '2027-01-31' }), '2026-01-01', '2026-12-31')).toEqual([]);
    expect(occurrenceDates(rule({ endDate: '2026-01-31' }), '2026-02-01', '2026-12-31')).toEqual([]);
    expect(occurrenceDates(rule(), '2026-12-31', '2026-01-01')).toEqual([]);
  });

  it('datas puladas (skippedDates) saem da série; as demais seguem', () => {
    expect(occurrenceDates(rule({ skippedDates: ['2026-02-28', '2099-01-01'] }), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-03-31', '2026-04-30']);
  });

  it('janela absurdamente grande é recusada (proteção contra laço enorme)', () => {
    expect(() => occurrenceDates(rule({ frequency: 'weekly' }), '2000-01-01', '2999-12-31')).toThrow(RangeError);
  });

  it('regra de bissexto do calendário gregoriano: 2000 é bissexto (÷400), 2100 não é (÷100)', () => {
    expect(occurrenceDates(rule({ startDate: '2000-01-31' }), '2000-02-01', '2000-02-29')).toEqual(['2000-02-29']);
    expect(occurrenceDates(rule({ startDate: '2100-01-31' }), '2100-02-01', '2100-03-01')).toEqual(['2100-02-28']);
    expect(occurrenceDates(rule({ frequency: 'yearly', startDate: '2096-02-29' }), '2096-01-01', '2104-12-31')).toEqual([
      '2096-02-29',
      '2097-02-28',
      '2098-02-28',
      '2099-02-28',
      '2100-02-28',
      '2101-02-28',
      '2102-02-28',
      '2103-02-28',
      '2104-02-29',
    ]);
  });

  it('janela que COMEÇA exatamente numa ocorrência, um dia antes ou um dia depois, em série antiga (todas as periodicidades)', () => {
    const cases: Array<[RecurrenceRule['frequency'], string, string]> = [
      ['weekly', '2024-03-04', '2026-11-16'],
      ['biweekly', '2024-03-04', '2026-11-09'],
      ['monthly', '2022-01-31', '2026-11-30'],
      ['yearly', '2020-02-29', '2024-02-29'],
    ];
    for (const [frequency, startDate, occurrence] of cases) {
      const r = rule({ frequency, startDate });
      const end = addDays(occurrence, 400);
      for (const offset of [-1, 0, 1]) {
        const from = addDays(occurrence, offset);
        const got = occurrenceDates(r, from, end);
        const all = occurrenceDates(r, startDate, addDays(startDate, 3660)).filter((d) => d >= from && d <= end);
        expect(got, `${frequency} from ${from}`).toEqual(all);
        if (offset <= 0) expect(got[0], `${frequency} from ${from}`).toBe(occurrence);
      }
    }
  });

  it('propriedade: recortar a janela = filtrar a série completa (todas as periodicidades, janelas aleatórias determinísticas)', () => {
    let seed = 777;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const freqs: RecurrenceRule['frequency'][] = ['weekly', 'biweekly', 'monthly', 'yearly'];
    for (let round = 0; round < 80; round += 1) {
      const startDate = addDays('2018-01-01', next(2500));
      const r = rule({ frequency: freqs[next(4)] as RecurrenceRule['frequency'], startDate });
      const full = occurrenceDates(r, startDate, addDays(startDate, 3660));
      const from = addDays(startDate, next(3000) - 100);
      const to = addDays(from, next(400));
      expect(occurrenceDates(r, from, to), `${r.frequency} ${startDate} [${from}, ${to}]`).toEqual(full.filter((d) => d >= from && d <= to));
    }
  });

  it('propriedade (PRNG determinístico): mensal = âncora limitada ao último dia do mês, meses consecutivos', () => {
    const lastDay = (y: number, m: number) => {
      const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      return m === 2 && leap ? 29 : (days[m - 1] as number);
    };
    let seed = 20261112;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    for (let round = 0; round < 60; round += 1) {
      const y = 2020 + next(9);
      const m = 1 + next(12);
      const anchor = 1 + next(lastDay(y, m));
      const months = 1 + next(30);
      const r = rule({ startDate: `${y}-${pad(m)}-${pad(anchor)}` });
      const to = (() => {
        const idx = y * 12 + (m - 1) + months - 1;
        const yy = Math.floor(idx / 12);
        const mm = (idx % 12) + 1;
        return `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}`;
      })();
      const got = occurrenceDates(r, r.startDate, to);
      expect(got).toHaveLength(months);
      got.forEach((d, i) => {
        const idx = y * 12 + (m - 1) + i;
        const yy = Math.floor(idx / 12);
        const mm = (idx % 12) + 1;
        expect(d).toBe(`${yy}-${pad(mm)}-${pad(Math.min(anchor, lastDay(yy, mm)))}`);
      });
    }
  });
});

describe('validateRule', () => {
  it('aceita regra válida', () => {
    expect(validateRule(rule())).toEqual([]);
    expect(validateRule(rule({ endDate: '2026-01-31' }))).toEqual([]);
  });

  it.each([
    ['valor zero', { amountCents: '0' }],
    ['valor negativo', { amountCents: '-5' }],
    ['valor com decimais', { amountCents: '10.5' }],
    ['descrição vazia', { description: '   ' }],
    ['descrição longa', { description: 'x'.repeat(201) }],
    ['categoria longa', { category: 'c'.repeat(101) }],
    ['frequência desconhecida', { frequency: 'daily' as never }],
    ['direção inválida', { direction: 'x' as never }],
    ['início inválido', { startDate: '2026-02-30' }],
    ['fim inválido', { endDate: '31/12/2026' }],
    ['fim antes do início', { endDate: '2026-01-30' }],
    ['data pulada inválida', { skippedDates: ['2026-13-01'] }],
    ['id vazio', { id: '' }],
  ] as const)('recusa %s', (_name, over) => {
    expect(validateRule(rule(over as Partial<RecurrenceRule>)).length).toBeGreaterThan(0);
  });
});

describe('identidade da ocorrência', () => {
  it('sourceKey = rec:<regra>:<data>; id = rec_ + SHA-256 truncado; sem crypto.subtle', () => {
    expect(recurrenceSourceKey('r1', '2026-11-30')).toBe('rec:r1:2026-11-30');
    const e = occurrenceEntry(rule(), '2026-11-30');
    expect(e).toEqual({
      id: `rec_${sha256Hex('rec:r1:2026-11-30').slice(0, 20)}`,
      direction: 'out',
      amountCents: '150000',
      dueDate: '2026-11-30',
      description: 'Aluguel',
      category: 'Fixas',
      origin: 'recurring',
      sourceKey: 'rec:r1:2026-11-30',
      state: 'scheduled',
    });
  });
});

describe('expandRecurrences', () => {
  const window = { from: '2026-11-13', to: '2026-12-31' };

  it('gera só ocorrências da janela (depois da data-base) como CashEntry recurring/scheduled', () => {
    const { entries, covered, invalidRules } = expandRecurrences([rule()], [], window);
    expect(entries.map((e) => [e.dueDate, e.amountCents, e.origin, e.state, e.sourceKey])).toEqual([
      ['2026-11-30', '150000', 'recurring', 'scheduled', 'rec:r1:2026-11-30'],
      ['2026-12-31', '150000', 'recurring', 'scheduled', 'rec:r1:2026-12-31'],
    ]);
    expect(covered).toEqual([]);
    expect(invalidRules).toEqual([]);
  });

  it('IDEMPOTENTE: expandir duas vezes dá o mesmo; reinjetar o resultado como existente não gera nada novo', () => {
    const a = expandRecurrences([rule()], [], window);
    const b = expandRecurrences([rule()], [], window);
    expect(b).toEqual(a);
    const again = expandRecurrences([rule()], a.entries, window);
    expect(again.entries).toEqual([]);
    expect(again.covered.map((c) => c.reason)).toEqual(['materialized', 'materialized']);
    expect(new Set(a.entries.map((e) => e.id)).size).toBe(a.entries.length);
  });

  it('PASSADO LIQUIDADO é imutável: mudar valor da regra não altera o liquidado e não o duplica', () => {
    const settled: CashEntry = { ...occurrenceEntry(rule(), '2026-11-30'), amountCents: '140000', state: 'settled', settledAt: '2026-11-30' };
    const snapshot = JSON.parse(JSON.stringify(settled));
    const changed = rule({ amountCents: '160000' });
    const { entries, covered } = expandRecurrences([changed], [settled], window);
    expect(entries.map((e) => [e.dueDate, e.amountCents])).toEqual([['2026-12-31', '160000']]);
    expect(covered).toEqual([{ ruleId: 'r1', date: '2026-11-30', sourceKey: 'rec:r1:2026-11-30', reason: 'materialized', entryId: settled.id }]);
    expect(settled).toEqual(snapshot);
  });

  it('lançamento materializado e DEPOIS editado (vencimento movido) continua suprimindo a ocorrência original', () => {
    const moved: CashEntry = { ...occurrenceEntry(rule(), '2026-11-30'), dueDate: '2026-12-02', amountCents: '151000' };
    const { entries } = expandRecurrences([rule()], [moved], window);
    expect(entries.map((e) => e.dueDate)).toEqual(['2026-12-31']);
  });

  it('excluir a regra não apaga nem altera lançamentos já gravados', () => {
    const settled: CashEntry = { ...occurrenceEntry(rule(), '2026-11-30'), state: 'settled', settledAt: '2026-11-30' };
    const existing = [settled];
    const snapshot = JSON.parse(JSON.stringify(existing));
    const { entries } = expandRecurrences([], existing, window);
    expect(entries).toEqual([]);
    expect(existing).toEqual(snapshot);
  });

  it('data pulada na regra não gera ocorrência', () => {
    const { entries } = expandRecurrences([rule({ skippedDates: ['2026-11-30'] })], [], window);
    expect(entries.map((e) => e.dueDate)).toEqual(['2026-12-31']);
  });

  it('EQUIVALENTE manual/importado (mesma direção, data, valor e descrição normalizada) não duplica — e a cobertura é informada', () => {
    const existing = [manual({ description: '  aluguel ', origin: 'csv', sourceKey: 'csv:external:A1', id: 'csv_1' })];
    const { entries, covered } = expandRecurrences([rule()], existing, window);
    expect(entries.map((e) => e.dueDate)).toEqual(['2026-11-30']);
    expect(covered).toEqual([{ ruleId: 'r1', date: '2026-12-31', sourceKey: 'rec:r1:2026-12-31', reason: 'equivalent', entryId: 'csv_1' }]);
  });

  it('lançamento equivalente já LIQUIDADO também cobre (pago não volta como previsto)', () => {
    const { entries } = expandRecurrences([rule()], [manual({ state: 'settled', settledAt: '2026-12-31' })], window);
    expect(entries.map((e) => e.dueDate)).toEqual(['2026-11-30']);
  });

  it('NÃO é equivalente se difere em 1 centavo, na direção, na data ou na descrição', () => {
    for (const diff of [{ amountCents: '150001' }, { direction: 'in' as const }, { dueDate: '2026-12-30' }, { description: 'Aluguel loja 2' }]) {
      const { entries } = expandRecurrences([rule()], [manual(diff)], window);
      expect(entries.map((e) => e.dueDate)).toEqual(['2026-11-30', '2026-12-31']);
    }
  });

  it('várias regras: ordem canônica (vencimento, depois sourceKey), independente da ordem das regras; chaves não colidem', () => {
    const weekly = rule({ id: 'r2', frequency: 'weekly', startDate: '2026-11-16', amountCents: '20000', description: 'Fornecedor' });
    const win = { from: '2026-11-13', to: '2026-12-12' };
    const expected = [
      ['2026-11-16', 'rec:r2:2026-11-16'],
      ['2026-11-23', 'rec:r2:2026-11-23'],
      ['2026-11-30', 'rec:r1:2026-11-30'],
      ['2026-11-30', 'rec:r2:2026-11-30'],
      ['2026-12-07', 'rec:r2:2026-12-07'],
    ];
    const key = (r: RecurrenceRule[]) => expandRecurrences(r, [], win).entries.map((e) => [e.dueDate, e.sourceKey]);
    expect(key([rule(), weekly])).toEqual(expected);
    expect(key([weekly, rule()])).toEqual(expected);
  });

  it('regra inválida é reportada e NÃO gera ocorrências; as válidas seguem', () => {
    const bad = rule({ id: 'bad', amountCents: '0' });
    const { entries, invalidRules } = expandRecurrences([bad, rule()], [], window);
    expect(entries).toHaveLength(2);
    expect(invalidRules).toHaveLength(1);
    expect(invalidRules[0]?.ruleId).toBe('bad');
    expect(invalidRules[0]?.errors.length).toBeGreaterThan(0);
  });

  it('regra duplicada (mesmo id) não gera a mesma ocorrência duas vezes', () => {
    const { entries } = expandRecurrences([rule(), rule()], [], window);
    expect(entries).toHaveLength(2);
  });
});

describe('integração com o motor project() — saldo conciliado à mão', () => {
  const settings: CashSettings = { baseDate: '2026-11-12', openingBalanceCents: '500000', minimumBalanceCents: '100000' };
  const weekly = rule({ id: 'r2', frequency: 'weekly', startDate: '2026-11-16', amountCents: '20000', description: 'Fornecedor' });
  const win = { from: '2026-11-13', to: '2026-12-12' };

  it('aluguel dia 30/nov + fornecedor semanal: 11/16 4800, 11/23 4600, 11/30 2900 (4600−200−1500), 12/07 2700', () => {
    const { entries } = expandRecurrences([rule(), weekly], [], win);
    const result = project(settings, entries);
    const closing = (d: string) => result.points.find((p) => p.date === d)?.closingCents;
    expect(closing('2026-11-15')).toBe(500000n);
    expect(closing('2026-11-16')).toBe(480000n);
    expect(closing('2026-11-23')).toBe(460000n);
    expect(closing('2026-11-30')).toBe(290000n);
    expect(closing('2026-12-07')).toBe(270000n);
    expect(result.summary.endingCents).toBe(270000n);
    expect(result.duplicates).toEqual([]);
  });

  it('aluguel liquidado em 30/nov: soma UMA vez só (a ocorrência calculada some; o liquidado não entra de novo)', () => {
    const settled: CashEntry = { ...occurrenceEntry(rule(), '2026-11-30'), state: 'settled', settledAt: '2026-11-30' };
    const { entries } = expandRecurrences([rule(), weekly], [settled], win);
    const result = project(settings, [settled, ...entries]);
    // só o fornecedor (4 × 200,00) reduz o saldo
    expect(result.summary.endingCents).toBe(500000n - 80000n);
    expect(result.duplicates).toEqual([]);
  });

  it('a regra não toca o horizonte: 30 dias continuam sendo 30 pontos', () => {
    const { entries } = expandRecurrences([rule()], [], win);
    expect(project(settings, entries).points).toHaveLength(30);
  });
});
