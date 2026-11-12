import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  ORIGIN_LABELS,
  applyFilter,
  categoriesOf,
  describeFilter,
  filterError,
  isFilterActive,
  originsOf,
  summarizeEntries,
  traceEntry,
  type EntryFilter,
} from '../filters';
import { project } from '../projection';
import type { CashEntry, CashSettings } from '../types';

const e = (id: string, direction: 'in' | 'out', cents: number, dueDate: string, category: string, origin: CashEntry['origin'], state: CashEntry['state'] = 'scheduled'): CashEntry => ({
  id,
  direction,
  amountCents: String(cents),
  dueDate,
  description: `Desc ${id}`,
  category,
  origin,
  sourceKey: `k:${id}`,
  state,
  ...(state === 'settled' ? { settledAt: dueDate } : {}),
});

const ENTRIES: CashEntry[] = [
  e('e1', 'out', 100000, '2026-12-01', 'Aluguel', 'manual'),
  e('e2', 'in', 50000, '2026-12-05', 'Vendas', 'csv'),
  e('e3', 'out', 30000, '2026-12-10', 'Aluguel', 'recurring'),
  e('e4', 'out', 20000, '2026-12-10', '', 'manual'),
  e('e5', 'in', 70000, '2026-12-31', 'Vendas', 'demo'),
  e('e6', 'out', 15000, '2027-01-01', 'Aluguel', 'manual', 'settled'),
  e('e7', 'in', 1, '2026-12-05', 'Vendas', 'manual'),
];
const ids = (list: readonly CashEntry[]) => list.map((x) => x.id);
const f = (over: Partial<EntryFilter>): EntryFilter => ({ ...EMPTY_FILTER, ...over });

describe('applyFilter', () => {
  it('sem filtro devolve tudo, na mesma ordem, sem mutar a entrada', () => {
    const snapshot = JSON.stringify(ENTRIES);
    expect(ids(applyFilter(ENTRIES, EMPTY_FILTER))).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
    expect(JSON.stringify(ENTRIES)).toBe(snapshot);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('período com datas inicial e final INCLUSIVAS; só início ou só fim também funcionam', () => {
    expect(ids(applyFilter(ENTRIES, f({ from: '2026-12-05', to: '2026-12-10' })))).toEqual(['e2', 'e3', 'e4', 'e7']);
    expect(ids(applyFilter(ENTRIES, f({ from: '2026-12-31' })))).toEqual(['e5', 'e6']);
    expect(ids(applyFilter(ENTRIES, f({ to: '2026-12-01' })))).toEqual(['e1']);
  });

  it('categoria exata; "" é "sem categoria"', () => {
    expect(ids(applyFilter(ENTRIES, f({ category: 'Aluguel' })))).toEqual(['e1', 'e3', 'e6']);
    expect(ids(applyFilter(ENTRIES, f({ category: '' })))).toEqual(['e4']);
    expect(ids(applyFilter(ENTRIES, f({ category: 'aluguel' })))).toEqual([]); // exato, não "parecido"
  });

  it('origem exata', () => {
    expect(ids(applyFilter(ENTRIES, f({ origin: 'manual' })))).toEqual(['e1', 'e4', 'e6', 'e7']);
    expect(ids(applyFilter(ENTRIES, f({ origin: 'recurring' })))).toEqual(['e3']);
    expect(ids(applyFilter(ENTRIES, f({ origin: 'sale' })))).toEqual([]);
  });

  it('filtros se combinam com E', () => {
    expect(ids(applyFilter(ENTRIES, f({ from: '2026-12-05', to: '2026-12-10', category: 'Aluguel' })))).toEqual(['e3']);
    expect(ids(applyFilter(ENTRIES, f({ category: 'Aluguel', origin: 'manual' })))).toEqual(['e1', 'e6']);
    expect(ids(applyFilter(ENTRIES, f({ from: '2026-12-05', to: '2026-12-10', category: 'Vendas', origin: 'manual' })))).toEqual(['e7']);
  });

  it('período invertido não casa nada e vira erro explícito', () => {
    expect(ids(applyFilter(ENTRIES, f({ from: '2026-12-10', to: '2026-12-01' })))).toEqual([]);
    expect(filterError(f({ from: '2026-12-10', to: '2026-12-01' }))).toMatch(/inicial.*posterior/i);
    expect(filterError(f({ from: '2026-12-01', to: '2026-12-01' }))).toBeNull();
    expect(filterError(f({ from: '2026-02-30' }))).toMatch(/inválid/i);
    expect(filterError(EMPTY_FILTER)).toBeNull();
  });

  it('isFilterActive: qualquer campo preenchido, inclusive categoria "" (sem categoria)', () => {
    expect(isFilterActive(f({ from: '2026-12-01' }))).toBe(true);
    expect(isFilterActive(f({ to: '2026-12-01' }))).toBe(true);
    expect(isFilterActive(f({ category: '' }))).toBe(true);
    expect(isFilterActive(f({ origin: 'csv' }))).toBe(true);
  });
});

describe('summarizeEntries — o somatório vem EXATAMENTE dos IDs listados (à mão)', () => {
  it('de 05/12 a 10/12: 2 entradas (50.000+1), 2 saídas (30.000+20.000), líquido +1', () => {
    const list = applyFilter(ENTRIES, f({ from: '2026-12-05', to: '2026-12-10' }));
    const s = summarizeEntries(list);
    expect(s.ids).toEqual(['e2', 'e3', 'e4', 'e7']);
    expect(s.count).toBe(4);
    expect(s.incomingCents).toBe(50001n);
    expect(s.outgoingCents).toBe(50000n);
    expect(s.netCents).toBe(1n);
  });

  it('lista vazia soma zero; saldo líquido pode ser negativo', () => {
    expect(summarizeEntries([])).toEqual({ count: 0, ids: [], incomingCents: 0n, outgoingCents: 0n, netCents: 0n, settledCount: 0 });
    expect(summarizeEntries(applyFilter(ENTRIES, f({ category: '' }))).netCents).toBe(-20000n);
  });

  it('conta separadamente os liquidados listados (não entram no saldo)', () => {
    const s = summarizeEntries(applyFilter(ENTRIES, f({ category: 'Aluguel' })));
    expect(s.count).toBe(3);
    expect(s.settledCount).toBe(1);
    expect(s.outgoingCents).toBe(145000n);
  });

  it('propriedade: para 100 filtros pseudoaleatórios, soma == soma recalculada pelos ids e ids ⊆ entradas', () => {
    let seed = 99;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const dates = ['2026-12-01', '2026-12-05', '2026-12-10', '2026-12-31', '2027-01-01'];
    const cats = [null, 'Aluguel', 'Vendas', ''] as const;
    const origs = [null, 'manual', 'csv', 'recurring', 'demo'] as const;
    for (let i = 0; i < 100; i += 1) {
      const filter = f({ from: next(2) ? (dates[next(5)] as string) : '', to: next(2) ? (dates[next(5)] as string) : '', category: cats[next(4)] as string | null, origin: origs[next(5)] as EntryFilter['origin'] });
      const list = applyFilter(ENTRIES, filter);
      const s = summarizeEntries(list);
      const byId = new Map(ENTRIES.map((x) => [x.id, x]));
      let inc = 0n;
      let out = 0n;
      for (const id of s.ids) {
        const x = byId.get(id)!;
        if (x.direction === 'in') inc += BigInt(x.amountCents);
        else out += BigInt(x.amountCents);
      }
      expect(s.incomingCents).toBe(inc);
      expect(s.outgoingCents).toBe(out);
      expect(s.netCents).toBe(inc - out);
      expect(s.count).toBe(list.length);
    }
  });
});

describe('filtrar é só visualização: nunca altera saldos nem alertas', () => {
  const settings: CashSettings = { baseDate: '2026-11-30', openingBalanceCents: '50000', minimumBalanceCents: '10000' };
  it('a projeção das entradas completas é idêntica antes e depois de qualquer filtro', () => {
    const before = project(settings, ENTRIES);
    for (const filter of [f({ category: 'Aluguel' }), f({ origin: 'csv' }), f({ from: '2027-06-01' }), f({ category: 'inexistente' })]) {
      applyFilter(ENTRIES, filter);
      expect(project(settings, ENTRIES)).toEqual(before);
    }
    // saldo em 01/12: 500,00 − 1.000,00 = −500,00 → risco NEGATIVO existe independentemente do filtro
    expect(before.summary.firstNegative?.date).toBe('2026-12-01');
  });
});

describe('categoriesOf / originsOf', () => {
  it('categorias únicas e ordenadas; "sem categoria" é um item próprio e vem por último', () => {
    expect(categoriesOf(ENTRIES)).toEqual([
      { value: 'Aluguel', label: 'Aluguel' },
      { value: 'Vendas', label: 'Vendas' },
      { value: '', label: 'Sem categoria' },
    ]);
    expect(categoriesOf([])).toEqual([]);
  });

  it('origens presentes, na ordem canônica', () => {
    expect(originsOf(ENTRIES)).toEqual(['manual', 'csv', 'demo', 'recurring']);
    expect(ORIGIN_LABELS.recurring).toBe('Recorrente');
  });
});

describe('describeFilter — estado do filtro sempre em TEXTO', () => {
  it('lista cada critério ativo', () => {
    expect(describeFilter(EMPTY_FILTER)).toEqual([]);
    expect(describeFilter(f({ from: '2026-12-01', to: '2026-12-31', category: 'Aluguel', origin: 'recurring' }))).toEqual([
      'Período: 01/12/2026 a 31/12/2026',
      'Categoria: Aluguel',
      'Origem: Recorrente',
    ]);
    expect(describeFilter(f({ from: '2026-12-01' }))).toEqual(['Período: a partir de 01/12/2026']);
    expect(describeFilter(f({ to: '2026-12-31' }))).toEqual(['Período: até 31/12/2026']);
    expect(describeFilter(f({ category: '' }))).toEqual(['Categoria: Sem categoria']);
  });
});

describe('traceEntry — por que cada lançamento entra (ou não) no saldo', () => {
  const settings: CashSettings = { baseDate: '2026-12-02', openingBalanceCents: '200000', minimumBalanceCents: '10000' };
  const entries: CashEntry[] = [
    e('in-window', 'out', 50000, '2026-12-10', 'X', 'manual'),
    e('paid', 'out', 7000, '2026-12-12', 'X', 'manual', 'settled'),
    e('old', 'out', 3000, '2026-12-01', 'X', 'manual'),
    e('far', 'in', 9000, '2027-03-01', 'X', 'manual'),
    { ...e('z-dup', 'out', 50000, '2026-12-10', 'X', 'manual'), sourceKey: 'k:in-window' },
  ];
  const result = project(settings, entries);

  it('agendado no horizonte → entra no saldo de uma data, com o fechamento daquele dia', () => {
    expect(traceEntry(entries[0] as CashEntry, result)).toEqual({ kind: 'in_projection', date: '2026-12-10', closingCents: 150000n, risk: 'ok' });
  });
  it('liquidado → já refletido no saldo inicial', () => {
    expect(traceEntry(entries[1] as CashEntry, result)).toEqual({ kind: 'settled' });
  });
  it('vencido até a data-base → fora da projeção (conferir manualmente)', () => {
    expect(traceEntry(entries[2] as CashEntry, result)).toEqual({ kind: 'before_base_date' });
  });
  it('além do horizonte → ainda não entra', () => {
    expect(traceEntry(entries[3] as CashEntry, result)).toEqual({ kind: 'beyond_horizon' });
  });
  it('dentro do horizonte mas fora do que o motor recebeu → "não contado" (nunca finge que entra)', () => {
    const stranger = e('stranger', 'out', 1000, '2026-12-15', 'X', 'manual');
    expect(traceEntry(stranger, result)).toEqual({ kind: 'not_counted' });
    expect(traceEntry({ ...stranger, dueDate: '2027-03-02' }, result)).toEqual({ kind: 'beyond_horizon' });
  });
  it('duplicado (mesma chave de origem) → não soma de novo e aponta o original', () => {
    expect(traceEntry(entries[4] as CashEntry, result)).toEqual({ kind: 'duplicate', duplicateOf: 'in-window' });
  });
});
