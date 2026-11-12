import { describe, expect, it } from 'vitest';
import { addDays } from '../../finance/dates';
import { project, ProjectionError } from '../../finance/projection';
import type { CashEntry, CashSettings } from '../../finance/types';
import { createBaseSnapshot, createScenario, deepFreeze, simulate, simulateScenario, simulateWith } from '../engine';
import { HYPOTHETICAL_LABEL, ScenarioError } from '../types';
import type { Adjustment, ApplierRegistry, BaseSnapshot, DelayReceiptAdjustment, ScaleExpenseAdjustment } from '../types';

const settings = (o: Partial<CashSettings> = {}): CashSettings => ({ baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000', ...o });

const entry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string, extra: Partial<CashEntry> = {}): CashEntry => ({
  id, direction, amountCents, dueDate, description: `L ${id}`, category: '', origin: 'manual', sourceKey: `manual:${id}`, state: 'scheduled', ...extra,
});

// Dataset fictício do contrato demo-s01 (valores calculados à mão: 12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 · 15/11 R$ 3.300).
const demo = (): CashEntry[] => [
  entry('demo-despesa-01', 'out', '250000', '2026-11-12'),
  entry('demo-receita-01', 'in', '80000', '2026-11-13'),
  entry('demo-despesa-02', 'out', '200000', '2026-11-14'),
  entry('demo-receita-02', 'in', '400000', '2026-11-15'),
];

// Aplicadores FALSOS só para testar o motor genérico (os reais são testados em delay/shocks).
const fakeDelay = (adj: DelayReceiptAdjustment, ctx: Parameters<NonNullable<ApplierRegistry['delay_receipt']>>[1]) => {
  const e = ctx.live.get(adj.entryId);
  return { changes: e ? [{ entryId: e.id, dueDate: addDays(e.dueDate, adj.days) }] : [], assumptions: [`fake atraso ${adj.entryId}`], warnings: e ? [] : [`sem ${adj.entryId}`] };
};
const fakeHalve = (adj: ScaleExpenseAdjustment, ctx: Parameters<NonNullable<ApplierRegistry['scale_expense']>>[1]) => ({
  changes: [...ctx.live.values()].filter((e) => e.direction === 'out' && e.dueDate >= adj.from && e.dueDate <= adj.to).map((e) => ({ entryId: e.id, amountCents: (BigInt(e.amountCents) / 2n).toString() })),
  assumptions: [],
  warnings: [],
});
const fakes: ApplierRegistry = { delay_receipt: fakeDelay, scale_expense: fakeHalve };

const snap = (entries: CashEntry[] = demo(), s: CashSettings = settings(), horizonDays?: number): BaseSnapshot => createBaseSnapshot({ settings: s, entries, horizonDays });
const delay = (id: string, entryId: string, days: number): DelayReceiptAdjustment => ({ id, kind: 'delay_receipt', entryId, days });
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
const closing = (r: { points: { date: string; closingCents: bigint }[] }, date: string) => r.points.find((p) => p.date === date)?.closingCents;

describe('createBaseSnapshot', () => {
  it('gera id estável (snap_ + 16 hex), independente da ordem dos lançamentos e do objeto de origem', () => {
    const a = snap(demo());
    const b = snap([...demo()].reverse());
    expect(a.id).toMatch(/^snap_[0-9a-f]{16}$/);
    expect(b.id).toBe(a.id);
    expect(snap(demo()).id).toBe(a.id);
  });

  it('o id muda quando qualquer dado da base muda (valor, data, configuração, horizonte, base de venda)', () => {
    const ref = snap().id;
    const changedAmount = demo();
    changedAmount[0] = { ...(changedAmount[0] as CashEntry), amountCents: '250001' };
    expect(snap(changedAmount).id).not.toBe(ref);
    expect(snap(demo(), settings({ openingBalanceCents: '300001' })).id).not.toBe(ref);
    expect(snap(demo(), settings(), 31).id).not.toBe(ref);
    const sale = createBaseSnapshot({ settings: settings(), entries: demo(), saleBasis: [{ entryId: 'x', saleDate: '2026-11-01', grossCents: '1000', costBps: 100 }] });
    expect(sale.id).not.toBe(ref);
  });

  it('é profundamente congelado (nem o snapshot nem seus lançamentos aceitam escrita)', () => {
    const s = snap();
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.settings)).toBe(true);
    expect(Object.isFrozen(s.entries)).toBe(true);
    expect(Object.isFrozen(s.entries[0])).toBe(true);
    expect(() => {
      (s.entries[0] as CashEntry).amountCents = '1';
    }).toThrow(TypeError);
  });

  it('não congela nem altera os objetos passados pelo chamador', () => {
    const entries = demo();
    const before = json(entries);
    snap(entries);
    expect(json(entries)).toBe(before);
    expect(Object.isFrozen(entries[0])).toBe(false);
  });

  it('descarta duplicados (mesmo id ou sourceKey) como o project() e a projeção da base é idêntica', () => {
    const dirty = [...demo(), entry('demo-receita-02', 'in', '400000', '2026-11-15'), entry('outro-id', 'in', '999', '2026-11-16', { sourceKey: 'manual:demo-receita-01' })];
    const s = snap(dirty);
    expect(s.entries.length).toBe(4);
    const original = project(settings(), dirty);
    expect(original.duplicates.length).toBe(2);
    const viaSnapshot = project(s.settings, s.entries, { horizonDays: s.horizonDays });
    expect(viaSnapshot.duplicates).toEqual([]);
    expect(json(viaSnapshot.points)).toBe(json(original.points));
    expect(json(viaSnapshot.summary)).toBe(json(original.summary));
  });

  it('duplicado só por id (sourceKey diferente) também é descartado, e só por sourceKey (id diferente) também', () => {
    const byId = snap([...demo(), entry('demo-receita-02', 'in', '1', '2026-11-20', { sourceKey: 'outra-chave' })]);
    expect(byId.entries.filter((e) => e.id === 'demo-receita-02')).toHaveLength(1);
    const bySource = snap([...demo(), entry('id-novo', 'in', '1', '2026-11-20', { sourceKey: 'manual:demo-receita-02' })]);
    expect(bySource.entries.map((e) => e.id)).not.toContain('id-novo');
  });

  it('o id não depende da ordem das chaves dos objetos (JSON canônico)', () => {
    const reordered = demo().map((e) => Object.fromEntries(Object.entries(e).reverse()) as unknown as CashEntry);
    const s = createBaseSnapshot({ settings: { minimumBalanceCents: '100000', openingBalanceCents: '300000', baseDate: '2026-11-11' }, entries: reordered });
    expect(s.id).toBe(snap().id);
  });

  it('lançamentos liquidados ficam na base, mas não contam no saldo nem aceitam mudança', () => {
    const s = snap([...demo(), entry('pago', 'in', '70000', '2026-11-13', { state: 'settled', settledAt: '2026-11-11' }), entry('velho', 'in', '10000', '2026-11-11')]);
    const r = simulateWith(fakes, s, [delay('p', 'pago', 2), delay('v', 'velho', 2)]);
    expect(r.effects.map((e) => e.status)).toEqual(['ignored', 'ignored']);
    expect(closing(r.baseProjection, '2026-11-13')).toBe(130_000n);
    expect(r.assumptions.join(' ')).toContain('4 lançamento(s) agendados contam no saldo');
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
  });

  it('rejeita dado inválido com o erro do motor (não passa em silêncio)', () => {
    expect(() => snap([entry('x', 'in', '-5', '2026-11-12')])).toThrow(ProjectionError);
    expect(() => snap(demo(), settings({ baseDate: '2026-13-40' }))).toThrow(ProjectionError);
  });

  it('exige base de venda com bruto positivo e custo inteiro entre 0 e 10 000 bps', () => {
    const mk = (b: object) => () => createBaseSnapshot({ settings: settings(), entries: demo(), saleBasis: [b as never] });
    expect(mk({ entryId: 'a', saleDate: '2026-11-01', grossCents: '1000', costBps: 10_001 })).toThrow(ScenarioError);
    expect(mk({ entryId: 'a', saleDate: '2026-11-01', grossCents: '1000', costBps: 1.5 })).toThrow(ScenarioError);
    expect(mk({ entryId: 'a', saleDate: '2026-11-01', grossCents: '0', costBps: 100 })).toThrow(ScenarioError);
    expect(mk({ entryId: 'a', saleDate: 'x', grossCents: '10', costBps: 100 })).toThrow(ScenarioError);
  });

  it('rejeita horizonte inválido', () => {
    expect(() => snap(demo(), settings(), 0)).toThrow(ProjectionError);
  });
});

describe('simulate — sem ajustes', () => {
  it('a alternativa é igual à base, a diferença é zero em todos os dias e o resultado é rotulado como hipotético', () => {
    const s = snap();
    const r = simulate(s, []);
    expect(r.hypothetical).toBe(true);
    expect(r.label).toBe(HYPOTHETICAL_LABEL);
    expect(r.baseSnapshotId).toBe(s.id);
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
    expect(r.deltaByDate).toHaveLength(30);
    expect(r.deltaByDate.every((d) => d.deltaCents === 0n && d.deltaIncomingCents === 0n && d.deltaOutgoingCents === 0n)).toBe(true);
    expect(r.effects).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.riskDiff).toEqual({ newRiskDates: [], resolvedRiskDates: [] });
    expect(r.assumptions.join(' ')).toContain('Hipótese');
    expect(r.assumptions.join(' ')).toContain(s.id);
  });

  it('a projeção da base é exatamente a do project() (S01 intacta: 500 · 1.300 · −700 · 3.300)', () => {
    const r = simulate(snap(), []);
    expect(closing(r.baseProjection, '2026-11-12')).toBe(50_000n);
    expect(closing(r.baseProjection, '2026-11-13')).toBe(130_000n);
    expect(closing(r.baseProjection, '2026-11-14')).toBe(-70_000n);
    expect(closing(r.baseProjection, '2026-11-15')).toBe(330_000n);
    expect(r.baseProjection.summary.firstNegative?.date).toBe('2026-11-14');
    expect(r.baseProjection.summary.firstNegative?.shortfallCents).toBe(170_000n);
  });

  it('respeita o horizonte do snapshot', () => {
    expect(simulate(snap(demo(), settings(), 7), []).deltaByDate).toHaveLength(7);
  });
});

describe('simulate — imutabilidade, determinismo e delta exato', () => {
  it('base antes e depois idênticas, mesmo com snapshot e ajustes profundamente congelados', () => {
    const s = snap();
    const adjustments = deepFreeze<Adjustment[]>([delay('a1', 'demo-receita-02', 1)]);
    const before = json(s);
    const baseBefore = json(project(s.settings, s.entries, { horizonDays: s.horizonDays }));
    const r = simulateWith(fakes, s, adjustments);
    expect(json(s)).toBe(before);
    expect(json(project(s.settings, s.entries, { horizonDays: s.horizonDays }))).toBe(baseBefore);
    expect(json(r.baseProjection)).toBe(baseBefore);
    expect(s.entries.find((e) => e.id === 'demo-receita-02')?.dueDate).toBe('2026-11-15');
  });

  it('mesmo input ⇒ mesmo resultado (sem relógio nem aleatoriedade)', () => {
    const adj = [delay('a1', 'demo-receita-02', 3), { id: 'a2', kind: 'scale_expense', from: '2026-11-01', to: '2026-12-31', change: { mode: 'factor', factorBps: 5000 } } as Adjustment];
    expect(json(simulateWith(fakes, snap(), adj))).toBe(json(simulateWith(fakes, snap([...demo()].reverse()), adj)));
  });

  it('diferença diária calculada à mão: mover a receita de R$ 4.000 de 15/11 para 16/11', () => {
    const r = simulateWith(fakes, snap(), [delay('a1', 'demo-receita-02', 1)]);
    const d = (date: string) => r.deltaByDate.find((p) => p.date === date);
    // alternativa: 12/11 500 · 13/11 1.300 · 14/11 −700 · 15/11 −700 (a receita saiu) · 16/11 3.300
    expect(closing(r.alternativeProjection, '2026-11-15')).toBe(-70_000n);
    expect(closing(r.alternativeProjection, '2026-11-16')).toBe(330_000n);
    expect(d('2026-11-14')?.deltaCents).toBe(0n);
    expect(d('2026-11-15')?.deltaCents).toBe(-400_000n);
    expect(d('2026-11-15')?.deltaIncomingCents).toBe(-400_000n);
    expect(d('2026-11-16')?.deltaCents).toBe(0n);
    expect(d('2026-11-16')?.deltaIncomingCents).toBe(400_000n);
    expect(d('2026-11-15')?.baseClosingCents).toBe(330_000n);
    expect(d('2026-11-15')?.alternativeClosingCents).toBe(-70_000n);
    expect(d('2026-11-15')?.baseRisk).toBe('ok');
    expect(d('2026-11-15')?.alternativeRisk).toBe('negative');
  });

  it('propriedade: delta[d] = alt.closing[d] − base.closing[d] e base + delta = alt, com dados pseudoaleatórios determinísticos', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 60; round += 1) {
      const entries: CashEntry[] = [];
      for (let i = 0; i < 1 + rnd(25); i += 1) {
        entries.push(entry(`r${round}-${i}`, rnd(2) === 0 ? 'in' : 'out', String(1 + rnd(900_000)), addDays('2026-11-11', 1 + rnd(45))));
      }
      const s = snap(entries, settings({ openingBalanceCents: String(rnd(2_000_000)), minimumBalanceCents: String(rnd(300_000)) }));
      const adj: Adjustment[] = [delay('d1', `r${round}-0`, rnd(40)), { id: 'h1', kind: 'scale_expense', from: '2026-11-12', to: addDays('2026-11-12', rnd(40)), change: { mode: 'factor', factorBps: 5000 } }];
      const r = simulateWith(fakes, s, adj);
      let prevDelta = 0n;
      r.deltaByDate.forEach((p, i) => {
        const b = r.baseProjection.points[i];
        const a = r.alternativeProjection.points[i];
        expect(p.date).toBe(b?.date);
        expect(p.deltaCents).toBe((a?.closingCents as bigint) - (b?.closingCents as bigint));
        expect((b?.closingCents as bigint) + p.deltaCents).toBe(a?.closingCents);
        expect(p.deltaCents).toBe(prevDelta + p.deltaIncomingCents - p.deltaOutgoingCents);
        prevDelta = p.deltaCents;
      });
    }
  });
});

describe('simulate — composição sem soma dupla', () => {
  it('dois ajustes de data no mesmo recebível: o primeiro vence, o segundo é ignorado com aviso', () => {
    const r = simulateWith(fakes, snap(), [delay('a1', 'demo-receita-02', 1), delay('a2', 'demo-receita-02', 5)]);
    expect(closing(r.alternativeProjection, '2026-11-16')).toBe(330_000n);
    expect(r.effects.map((e) => [e.adjustmentId, e.status])).toEqual([['a1', 'applied'], ['a2', 'ignored']]);
    expect(r.warnings.join(' ')).toContain('demo-receita-02');
    expect(r.warnings.join(' ')).toContain('a1');
    const incoming = r.alternativeProjection.points.reduce((s, p) => s + p.incomingCents, 0n);
    expect(incoming).toBe(480_000n); // soma preservada: 800 + 4.000
  });

  it('id de ajuste repetido é ignorado (idempotente), mesmo com conteúdo diferente', () => {
    const once = simulateWith(fakes, snap(), [delay('a1', 'demo-receita-02', 1)]);
    const twice = simulateWith(fakes, snap(), [delay('a1', 'demo-receita-02', 1), delay('a1', 'demo-receita-01', 9)]);
    expect(json(twice.alternativeProjection)).toBe(json(once.alternativeProjection));
    expect(twice.effects.filter((e) => e.adjustmentId === 'a1')).toHaveLength(1);
    expect(twice.warnings.join(' ')).toContain('a1');
  });

  it('data e valor do mesmo lançamento são campos independentes e se combinam, ambos a partir do original', () => {
    const entries = [entry('despesa', 'out', '100000', '2026-11-12')];
    const r = simulateWith(fakes, snap(entries), [delay('a1', 'despesa', 2), { id: 'h1', kind: 'scale_expense', from: '2026-11-12', to: '2026-11-12', change: { mode: 'factor', factorBps: 5000 } }]);
    // o período do choque usa o vencimento ORIGINAL (12/11), embora o atraso mova o lançamento para 14/11
    expect(closing(r.alternativeProjection, '2026-11-12')).toBe(300_000n);
    expect(closing(r.alternativeProjection, '2026-11-14')).toBe(250_000n);
    expect(r.alternativeProjection.points.reduce((s, p) => s + p.outgoingCents, 0n)).toBe(50_000n);
  });

  it('valor ajustado a zero remove o lançamento da alternativa (project() exige valor > 0) e avisa', () => {
    const zero: ApplierRegistry = { scale_expense: (_a, ctx) => ({ changes: [...ctx.live.keys()].map((entryId) => ({ entryId, amountCents: '0' })), assumptions: [], warnings: [] }) };
    const r = simulateWith(zero, snap([entry('d', 'out', '5000', '2026-11-12')]), [{ id: 'z', kind: 'scale_expense', from: '2026-11-12', to: '2026-11-12', change: { mode: 'factor', factorBps: 0 } }]);
    expect(r.alternativeProjection.points[0]?.outgoingCents).toBe(0n);
    expect(r.alternativeProjection.points[0]?.entryIds).toEqual([]);
    expect(r.warnings.join(' ')).toContain('ficou com valor zero');
    expect(r.baseProjection.points[0]?.outgoingCents).toBe(5000n);
  });

  it('mudança para um lançamento que não conta no saldo é ignorada com aviso (defesa do motor)', () => {
    const bad: ApplierRegistry = { delay_receipt: () => ({ changes: [{ entryId: 'fantasma', dueDate: '2026-11-20' }], assumptions: [], warnings: [] }) };
    const r = simulateWith(bad, snap(), [delay('a1', 'x', 1)]);
    expect(r.effects[0]?.status).toBe('ignored');
    expect(r.warnings.join(' ')).toContain('fantasma');
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
  });

  it('tipos reservados à S06 e sem aplicador são ignorados com aviso, sem alterar nada', () => {
    const r = simulate(snap(), [{ id: 'h', kind: 'hiring' }, { id: 'e', kind: 'equipment_purchase' }]);
    expect(r.effects.map((e) => e.status)).toEqual(['ignored', 'ignored']);
    expect(r.warnings.join(' ')).toContain('ainda não suportado');
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
  });

  it('o aplicador registrado no motor padrão é usado só para os tipos que existem (S05 sem aplicadores no T01 ⇒ aviso)', () => {
    const r = simulateWith({}, snap(), [delay('a1', 'demo-receita-02', 1)]);
    expect(r.effects[0]?.status).toBe('ignored');
  });

  it('ajuste sem id é erro de entrada (ScenarioError)', () => {
    expect(() => simulateWith(fakes, snap(), [{ ...delay('', 'x', 1) }])).toThrow(ScenarioError);
  });
});

describe('simulate — avisos gerais de risco e horizonte', () => {
  it('atraso que CRIA risco: avisa o primeiro dia em risco e lista os dias novos', () => {
    const entries = [entry('r', 'in', '500000', '2026-11-12'), entry('d', 'out', '600000', '2026-11-14')];
    const r = simulateWith(fakes, snap(entries, settings({ openingBalanceCents: '300000', minimumBalanceCents: '0' })), [delay('a1', 'r', 3)]);
    // base: 12/11 8.000 · 14/11 2.000 (ok). alternativa: 12/11 3.000 · 14/11 −3.000 (negativo) · 15/11 2.000
    expect(r.baseProjection.summary.firstRisk).toBeNull();
    expect(r.alternativeProjection.summary.firstNegative?.date).toBe('2026-11-14');
    expect(r.riskDiff.newRiskDates).toEqual(['2026-11-14']);
    expect(r.riskDiff.resolvedRiskDates).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/cria risco.*14\/11\/2026/);
  });

  it('atraso que REMOVE risco (mover uma despesa) é dito e lista os dias resolvidos', () => {
    const r = simulateWith(fakes, snap(), [delay('a1', 'demo-despesa-02', 2)]);
    // base: 14/11 −700 (negativo). alternativa: despesa em 16/11 ⇒ 14/11 1.300 ... 15/11 5.300 · 16/11 3.300
    expect(r.riskDiff.resolvedRiskDates).toContain('2026-11-14');
    // 12/11 continua abaixo do mínimo (R$ 500 < R$ 1.000): o risco diminui, mas não some
    expect(r.alternativeProjection.summary.firstRisk?.date).toBe('2026-11-12');
    expect(r.warnings.join(' ')).toMatch(/reduz o risco: \d+ dia\(s\) deixam de estar em risco/);
    expect(r.warnings.join(' ')).not.toContain('elimina');
  });

  it('atraso que ELIMINA todo o risco diz que elimina', () => {
    // base: despesa de R$ 6.000 antes da receita: 12/11 −3.000 · 13/11 −3.000 · 14/11 2.000
    const s = snap([entry('r', 'in', '500000', '2026-11-14'), entry('d', 'out', '600000', '2026-11-12')], settings({ openingBalanceCents: '300000', minimumBalanceCents: '0' }));
    const r = simulateWith(fakes, s, [delay('a1', 'd', 3)]); // alternativa: despesa em 15/11 ⇒ 14/11 8.000 · 15/11 2.000
    expect(r.baseProjection.summary.firstNegative?.date).toBe('2026-11-12');
    expect(r.alternativeProjection.summary.firstRisk).toBeNull();
    expect(r.warnings.join(' ')).toContain('elimina o risco de caixa dos próximos 30 dias');
  });

  it('empurrar um recebimento para depois do horizonte é dito', () => {
    const r = simulateWith(fakes, snap(demo(), settings(), 10), [delay('a1', 'demo-receita-02', 30)]);
    expect(r.alternativeProjection.summary.beyondHorizon).toBe(1);
    expect(r.baseProjection.summary.beyondHorizon).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/depois do horizonte de 10 dias/);
    expect(r.alternativeProjection.points.reduce((s, p) => s + p.incomingCents, 0n)).toBe(80_000n);
  });

  it('cada aplicador contribui com premissas, e elas aparecem em texto', () => {
    const r = simulateWith(fakes, snap(), [delay('a1', 'demo-receita-02', 1)]);
    expect(r.assumptions).toContain('fake atraso demo-receita-02');
  });
});

describe('cenário replayável', () => {
  it('simulateScenario refaz o mesmo resultado e recusa uma base diferente', () => {
    const s = snap();
    const scenario = createBaseScenario(s);
    expect(scenario.baseSnapshotId).toBe(s.id);
    const a = simulateScenario(s, scenario, fakes);
    const b = simulateScenario(snap([...demo()].reverse()), scenario, fakes);
    expect(json(a)).toBe(json(b));
    const other = snap(demo(), settings({ openingBalanceCents: '1' }));
    expect(() => simulateScenario(other, scenario, fakes)).toThrow(ScenarioError);
  });

  it('o cenário guarda uma cópia dos ajustes (mudar a lista de origem não muda o cenário)', () => {
    const list: Adjustment[] = [delay('a1', 'demo-receita-02', 1)];
    const sc = createScenario(snap(), 'Atraso', list, 'cen-1');
    list.push(delay('a2', 'demo-receita-01', 1));
    expect(sc.adjustments).toHaveLength(1);
    expect(Object.isFrozen(sc.adjustments)).toBe(true);
  });
});

function createBaseScenario(s: BaseSnapshot) {
  return createScenario(s, 'Atraso de R$ 4.000', [delay('a1', 'demo-receita-02', 1)], 'cen-1');
}
