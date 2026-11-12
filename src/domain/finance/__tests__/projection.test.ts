import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { project, ProjectionError } from '../projection';
import { classifyRisk, shortfallCents } from '../risk';
import type { CashEntry, CashSettings } from '../types';

const settings = (overrides: Partial<CashSettings> = {}): CashSettings => ({
  baseDate: '2026-11-11',
  openingBalanceCents: '300000',
  minimumBalanceCents: '100000',
  ...overrides,
});

let seq = 0;
const entry = (direction: 'in' | 'out', amountCents: string, dueDate: string, extra: Partial<CashEntry> = {}): CashEntry => {
  seq += 1;
  const id = extra.id ?? `e${seq}`;
  return {
    id,
    direction,
    amountCents,
    dueDate,
    description: `Lançamento ${id}`,
    category: '',
    origin: 'manual',
    sourceKey: `manual:${id}`,
    state: 'scheduled',
    ...extra,
  };
};

// Dataset fictício do contrato demo-s01.md
const demoEntries = (): CashEntry[] => [
  entry('out', '250000', '2026-11-12', { id: 'demo-despesa-01', sourceKey: 'demo:demo-despesa-01' }),
  entry('in', '80000', '2026-11-13', { id: 'demo-receita-01', sourceKey: 'demo:demo-receita-01' }),
  entry('out', '200000', '2026-11-14', { id: 'demo-despesa-02', sourceKey: 'demo:demo-despesa-02' }),
  entry('in', '400000', '2026-11-15', { id: 'demo-receita-02', sourceKey: 'demo:demo-receita-02' }),
];

describe('classifyRisk / shortfallCents', () => {
  it('negativo tem prioridade; abaixo do mínimo; exatamente no mínimo não alerta', () => {
    expect(classifyRisk(-1n, 100000n)).toBe('negative');
    expect(classifyRisk(0n, 100000n)).toBe('below_minimum');
    expect(classifyRisk(99999n, 100000n)).toBe('below_minimum');
    expect(classifyRisk(100000n, 100000n)).toBe('ok');
    expect(classifyRisk(100001n, 100000n)).toBe('ok');
    expect(classifyRisk(-1n, 0n)).toBe('negative');
    expect(classifyRisk(0n, 0n)).toBe('ok');
  });

  it('déficit é o que falta para o mínimo, nunca negativo', () => {
    expect(shortfallCents(-70000n, 100000n)).toBe(170000n);
    expect(shortfallCents(50000n, 100000n)).toBe(50000n);
    expect(shortfallCents(100000n, 100000n)).toBe(0n);
    expect(shortfallCents(500000n, 100000n)).toBe(0n);
  });
});

describe('project: dataset do contrato demo-s01', () => {
  const result = project(settings(), demoEntries());
  const byDate = (d: string) => {
    const p = result.points.find((x) => x.date === d);
    if (!p) throw new Error(`sem ponto ${d}`);
    return p;
  };

  it('gera 30 datas civis consecutivas a partir do dia seguinte à data-base', () => {
    expect(result.points).toHaveLength(30);
    expect(result.points[0]?.date).toBe('2026-11-12');
    expect(result.points[29]?.date).toBe('2026-12-11');
  });

  it('12/11 saldo R$ 500, abaixo do mínimo por R$ 500', () => {
    const p = byDate('2026-11-12');
    expect(p.openingCents).toBe(300000n);
    expect(p.outgoingCents).toBe(250000n);
    expect(p.closingCents).toBe(50000n);
    expect(p.risk).toBe('below_minimum');
    expect(p.shortfallCents).toBe(50000n);
    expect(p.entryIds).toEqual(['demo-despesa-01']);
  });

  it('13/11 saldo R$ 1.300 sem alerta', () => {
    const p = byDate('2026-11-13');
    expect(p.closingCents).toBe(130000n);
    expect(p.incomingCents).toBe(80000n);
    expect(p.risk).toBe('ok');
    expect(p.shortfallCents).toBe(0n);
  });

  it('14/11 saldo -R$ 700, negativo, déficit de R$ 1.700', () => {
    const p = byDate('2026-11-14');
    expect(p.closingCents).toBe(-70000n);
    expect(p.risk).toBe('negative');
    expect(p.shortfallCents).toBe(170000n);
    expect(p.entryIds).toEqual(['demo-despesa-02']);
  });

  it('15/11 saldo R$ 3.300 e segue até 11/12 sem novos lançamentos', () => {
    expect(byDate('2026-11-15').closingCents).toBe(330000n);
    expect(byDate('2026-11-15').risk).toBe('ok');
    expect(byDate('2026-12-11').closingCents).toBe(330000n);
    expect(byDate('2026-11-20').entryIds).toEqual([]);
  });

  it('resumo: primeiro risco em 12/11, primeiro saldo negativo em 14/11, menor saldo -R$ 700', () => {
    expect(result.summary.firstRisk?.date).toBe('2026-11-12');
    expect(result.summary.firstNegative?.date).toBe('2026-11-14');
    expect(result.summary.lowest.date).toBe('2026-11-14');
    expect(result.summary.lowest.closingCents).toBe(-70000n);
    expect(result.summary.endingCents).toBe(330000n);
    expect(result.summary.riskDays).toBe(2);
    expect(result.summary.openingCents).toBe(300000n);
    expect(result.summary.baseDate).toBe('2026-11-11');
    expect(result.summary.totalIncomingCents).toBe(480000n);
    expect(result.summary.totalOutgoingCents).toBe(450000n);
  });
});

describe('project: invariantes', () => {
  it('saldo de cada dia = anterior + entradas - saídas, e abertura = fechamento anterior', () => {
    const entries = [
      entry('out', '12345', '2026-11-12'),
      entry('in', '99999', '2026-11-12'),
      entry('out', '1', '2026-11-20'),
      entry('in', '7', '2026-12-11'),
    ];
    const { points } = project(settings(), entries);
    let previous = 300000n;
    for (const p of points) {
      expect(p.openingCents).toBe(previous);
      expect(p.closingCents).toBe(p.openingCents + p.incomingCents - p.outgoingCents);
      previous = p.closingCents;
    }
  });

  it('é determinística e independente da ordem dos lançamentos', () => {
    const a = demoEntries();
    const b = [...a].reverse();
    const ra = project(settings(), a);
    const rb = project(settings(), b);
    expect(rb).toEqual(ra);
    expect(project(settings(), a)).toEqual(ra);
  });

  it('não altera os dados de entrada', () => {
    const entries = demoEntries();
    const snapshot = JSON.stringify(entries);
    const s = settings();
    project(s, entries);
    expect(JSON.stringify(entries)).toBe(snapshot);
    expect(s).toEqual(settings());
  });

  it('sem lançamentos: saldo constante; abaixo do mínimo gera alerta todos os dias', () => {
    const flat = project(settings(), []);
    expect(flat.points.every((p) => p.closingCents === 300000n && p.risk === 'ok')).toBe(true);
    expect(flat.summary.firstRisk).toBeNull();
    expect(flat.summary.firstNegative).toBeNull();
    const low = project(settings({ openingBalanceCents: '50000' }), []);
    expect(low.points.every((p) => p.risk === 'below_minimum' && p.shortfallCents === 50000n)).toBe(true);
    expect(low.summary.riskDays).toBe(30);
    expect(low.summary.firstRisk?.date).toBe('2026-11-12');
  });

  it('saldo inicial negativo é aceito e gera risco negativo', () => {
    const r = project(settings({ openingBalanceCents: '-2500' }), []);
    expect(r.points[0]?.risk).toBe('negative');
    expect(r.points[0]?.shortfallCents).toBe(102500n);
  });

  it('saldo exatamente igual ao mínimo não gera alerta', () => {
    const r = project(settings(), [entry('out', '200000', '2026-11-12')]);
    expect(r.points[0]?.closingCents).toBe(100000n);
    expect(r.points[0]?.risk).toBe('ok');
    expect(r.summary.firstRisk).toBeNull();
  });

  it('atravessa fim de mês, de ano e ano bissexto', () => {
    const r = project(settings({ baseDate: '2027-12-20' }), [entry('out', '100', '2028-01-01')]);
    expect(r.points.find((p) => p.date === '2028-01-01')?.outgoingCents).toBe(100n);
    const leap = project(settings({ baseDate: '2028-02-20' }), [entry('in', '5', '2028-02-29')]);
    expect(leap.points.map((p) => p.date)).toContain('2028-02-29');
    expect(leap.points.find((p) => p.date === '2028-02-29')?.incomingCents).toBe(5n);
    expect(leap.points.map((p) => p.date)).toContain('2028-03-01');
  });

  it('não perde precisão com valores acima de Number.MAX_SAFE_INTEGER', () => {
    const big = '900719925474099300';
    const r = project(settings({ openingBalanceCents: '0', minimumBalanceCents: '0' }), [
      entry('in', big, '2026-11-12'),
      entry('in', '3', '2026-11-12'),
    ]);
    expect(r.points[0]?.closingCents).toBe(900719925474099303n);
  });

  it('soma centavos sem erro de ponto flutuante (10 x R$ 0,10 = R$ 1,00)', () => {
    const entries = Array.from({ length: 10 }, () => entry('in', '10', '2026-11-12'));
    const r = project(settings({ openingBalanceCents: '0', minimumBalanceCents: '0' }), entries);
    expect(r.points[0]?.closingCents).toBe(100n);
  });

  it('respeita o horizonte configurado', () => {
    expect(project(settings(), [], { horizonDays: 7 }).points).toHaveLength(7);
    expect(() => project(settings(), [], { horizonDays: 0 })).toThrow(ProjectionError);
    expect(() => project(settings(), [], { horizonDays: 1.5 })).toThrow(ProjectionError);
  });
});

describe('project: elegibilidade e sem dupla contagem', () => {
  it('lançamentos liquidados não entram na projeção', () => {
    const r = project(settings(), [entry('out', '250000', '2026-11-12', { state: 'settled', settledAt: '2026-11-11' })]);
    expect(r.points[0]?.closingCents).toBe(300000n);
    expect(r.points[0]?.entryIds).toEqual([]);
    expect(r.flagged).toEqual([]);
  });

  it('contas agendadas até a data-base são sinalizadas e não somadas implicitamente', () => {
    const r = project(settings(), [
      entry('out', '50000', '2026-11-10', { id: 'vencida' }),
      entry('out', '70000', '2026-11-11', { id: 'na-data-base' }),
    ]);
    expect(r.points.every((p) => p.closingCents === 300000n)).toBe(true);
    expect(r.flagged.map((f) => f.entryId).sort()).toEqual(['na-data-base', 'vencida']);
    expect(r.flagged.every((f) => f.reason === 'on_or_before_base_date')).toBe(true);
  });

  it('lançamentos depois do horizonte são ignorados na projeção', () => {
    const r = project(settings(), [entry('out', '100000', '2026-12-12', { id: 'depois' })]);
    expect(r.points.every((p) => p.closingCents === 300000n)).toBe(true);
    expect(r.summary.beyondHorizon).toBe(1);
  });

  it('o último dia do horizonte (data-base + 30) é incluído', () => {
    const r = project(settings(), [entry('out', '100', addDays('2026-11-11', 30), { id: 'ultimo' })]);
    expect(r.points[29]?.entryIds).toEqual(['ultimo']);
    expect(r.summary.beyondHorizon).toBe(0);
  });

  it('mesmo id ou mesma chave de origem conta uma única vez e é reportado', () => {
    const a = entry('out', '100000', '2026-11-12', { id: 'a', sourceKey: 'csv:external:1' });
    const dupId = { ...a };
    const dupKey = entry('out', '100000', '2026-11-12', { id: 'b', sourceKey: 'csv:external:1' });
    const r = project(settings(), [a, dupId, dupKey]);
    expect(r.points[0]?.outgoingCents).toBe(100000n);
    expect(r.points[0]?.entryIds).toEqual(['a']);
    expect(r.duplicates.map((d) => d.entryId).sort()).toEqual(['a', 'b']);
  });

  it('chaves de origem distintas não são duplicatas, mesmo com valores iguais', () => {
    const r = project(settings(), [
      entry('out', '100', '2026-11-12', { id: 'x', sourceKey: 'csv:external:A' }),
      entry('out', '100', '2026-11-12', { id: 'y', sourceKey: 'csv:external:B' }),
    ]);
    expect(r.points[0]?.outgoingCents).toBe(200n);
    expect(r.duplicates).toEqual([]);
  });

  it('chave de origem vazia nunca é tratada como duplicata', () => {
    const r = project(settings(), [
      entry('out', '100', '2026-11-12', { id: 'x', sourceKey: '' }),
      entry('out', '100', '2026-11-12', { id: 'y', sourceKey: '' }),
    ]);
    expect(r.points[0]?.outgoingCents).toBe(200n);
  });

  it('identifica as origens (entryIds) de cada dia em ordem estável', () => {
    const r = project(settings(), [entry('in', '1', '2026-11-12', { id: 'z' }), entry('out', '1', '2026-11-12', { id: 'a' }), entry('in', '1', '2026-11-12', { id: 'm' })]);
    expect(r.points[0]?.entryIds).toEqual(['a', 'm', 'z']);
  });
});

describe('project: entradas inválidas falham em vez de produzir saldo errado', () => {
  it.each([
    ['saldo inicial não inteiro', settings({ openingBalanceCents: '10.5' })],
    ['mínimo negativo', settings({ minimumBalanceCents: '-1' })],
    ['mínimo inválido', settings({ minimumBalanceCents: 'abc' })],
    ['data-base inválida', settings({ baseDate: '2026-02-30' })],
  ])('configuração com %s', (_n, s) => {
    expect(() => project(s, [])).toThrow(ProjectionError);
  });

  it.each([
    ['valor zero', entry('out', '0', '2026-11-12')],
    ['valor negativo', entry('out', '-5', '2026-11-12')],
    ['valor decimal', entry('out', '1.5', '2026-11-12')],
    ['data inválida', entry('out', '5', '2026-13-12')],
    ['direção inválida', { ...entry('out', '5', '2026-11-12'), direction: 'x' as 'in' }],
  ])('lançamento com %s', (_n, e) => {
    expect(() => project(settings(), [e])).toThrow(ProjectionError);
  });

  it('lançamento inválido já liquidado ou duplicado também é rejeitado (dado corrompido não passa em silêncio)', () => {
    expect(() => project(settings(), [entry('out', '0', '2026-11-12', { state: 'settled' })])).toThrow(ProjectionError);
  });
});

describe('project: propriedade — soma final confere com cálculo independente', () => {
  it('para lançamentos pseudoaleatórios determinísticos', () => {
    let state = 123456789;
    const rnd = (n: number) => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state % n;
    };
    for (let round = 0; round < 25; round += 1) {
      const entries: CashEntry[] = [];
      let expected = 300000n;
      const count = rnd(40);
      for (let i = 0; i < count; i += 1) {
        const dir = rnd(2) === 0 ? 'in' : 'out';
        const cents = BigInt(1 + rnd(500000));
        const offset = 1 + rnd(30);
        entries.push(entry(dir, cents.toString(), addDays('2026-11-11', offset), { id: `r${round}-${i}`, sourceKey: `k${round}-${i}` }));
        expected += dir === 'in' ? cents : -cents;
      }
      const r = project(settings(), entries);
      expect(r.points[29]?.closingCents).toBe(expected);
      expect(r.summary.endingCents).toBe(expected);
    }
  });
});
