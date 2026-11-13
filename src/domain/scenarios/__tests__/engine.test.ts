import { describe, expect, it } from 'vitest';
import { addDays } from '../../finance/dates';
import { project, ProjectionError } from '../../finance/projection';
import type { CashEntry, CashSettings } from '../../finance/types';
import { createBaseSnapshot, createScenario, deepFreeze, simulate, simulateScenario, simulateWith } from '../engine';
import { HYPOTHETICAL_LABEL, ScenarioError } from '../types';
import type { Adjustment, ApplierRegistry, BaseSnapshot, AdvanceReceivableAdjustment, DelayReceiptAdjustment, EntryAddition, EquipmentPurchaseAdjustment, ScaleExpenseAdjustment } from '../types';

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

  it('qualquer tipo sem aplicador registrado é ignorado com aviso, sem alterar nada', () => {
    const hiring: Adjustment = { id: 'h', kind: 'hiring', role: 'Auxiliar', monthlyCostCents: '100000', payDay: 5, startDate: '2026-11-20' };
    const equipment: Adjustment = { id: 'e', kind: 'equipment_purchase', description: 'Forno', principalCents: '100000', payment: { mode: 'cash', date: '2026-11-20' } };
    const r = simulateWith({}, snap(), [hiring, equipment]);
    expect(r.effects.map((e) => e.status)).toEqual(['ignored', 'ignored']);
    expect(r.warnings.join(' ')).toContain('ainda não suportado');
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
    expect(r.createdEntries).toEqual([]);
  });

  it('tipo sem aplicador registrado é ignorado com aviso', () => {
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


// ───────────── S06 (ADR-0010): lançamentos hipotéticos criados, retirada e trilha ─────────────

const addition = (o: Partial<EntryAddition> = {}): EntryAddition => ({ direction: 'out', amountCents: '100000', dueDate: '2026-11-20', description: 'Hipótese', category: 'Equipamento', ...o });
const buy = (id: string): EquipmentPurchaseAdjustment => ({ id, kind: 'equipment_purchase', description: 'Forno', principalCents: '100000', payment: { mode: 'cash', date: '2026-11-20' } });
const advance = (id: string, entryId: string): AdvanceReceivableAdjustment => ({ id, kind: 'advance_receivable', entryId, advanceDate: '2026-11-13', rateBps: 100 });

/** Compra falsa: cria os lançamentos informados. */
const fakeBuy = (additions: EntryAddition[]): ApplierRegistry => ({ equipment_purchase: () => ({ changes: [], additions, assumptions: ['fake compra'], warnings: [] }) });
/** Antecipação falsa: retira o recebível e cria o líquido na data antecipada (dependente da retirada). */
const fakeAdvance: ApplierRegistry = {
  advance_receivable: (adj, ctx) => {
    const e = ctx.live.get(adj.entryId) as CashEntry;
    return {
      changes: [{ entryId: e.id, remove: true }],
      additions: [{ direction: 'in', amountCents: '396000', dueDate: adj.advanceDate, description: 'Antecipação', category: '', dependsOn: e.id }],
      assumptions: [],
      warnings: [],
    };
  },
};
const both: ApplierRegistry = { ...fakes, ...fakeAdvance };

describe('simulate — lançamentos hipotéticos criados (id determinístico, só na alternativa)', () => {
  it('cria o lançamento com id e sourceKey scn:<ajuste>:<n>, só na alternativa, e a base não muda', () => {
    const s = snap();
    const before = json(s);
    const r = simulateWith(fakeBuy([addition(), addition({ dueDate: '2026-11-21', amountCents: '50000' })]), s, [buy('c1')]);
    expect(r.createdEntries.map((e) => [e.id, e.sourceKey, e.origin, e.state])).toEqual([
      ['scn:c1:1', 'scn:c1:1', 'manual', 'scheduled'],
      ['scn:c1:2', 'scn:c1:2', 'manual', 'scheduled'],
    ]);
    expect(r.effects[0]).toMatchObject({ status: 'applied', createdEntryIds: ['scn:c1:1', 'scn:c1:2'], changedEntryIds: [] });
    // calculado à mão: a base fecha 15/11 em R$ 3.300,00; 20/11 sai R$ 1.000,00 (→ 2.300,00); 21/11 sai R$ 500,00 (→ 1.800,00)
    expect(closing(r.baseProjection, '2026-11-20')).toBe(330000n);
    expect(closing(r.alternativeProjection, '2026-11-20')).toBe(230000n);
    expect(closing(r.alternativeProjection, '2026-11-21')).toBe(180000n);
    expect(json(s)).toBe(before);
    expect(r.alternativeProjection.duplicates).toEqual([]);
  });

  it('é determinístico: o mesmo cenário duas vezes dá o mesmo resultado, com os mesmos ids', () => {
    const s = snap();
    expect(json(simulateWith(fakeBuy([addition()]), s, [buy('c1')]))).toBe(json(simulateWith(fakeBuy([addition()]), s, [buy('c1')])));
  });

  it('id de ajuste repetido não cria o lançamento duas vezes', () => {
    const r = simulateWith(fakeBuy([addition()]), snap(), [buy('c1'), buy('c1')]);
    expect(r.createdEntries).toHaveLength(1);
    expect(r.warnings.join(' ')).toContain('Ajuste repetido ignorado');
  });

  it('adição inválida (data, valor zero, valor não inteiro, direção) é erro de entrada', () => {
    const run = (a: EntryAddition) => () => simulateWith(fakeBuy([a]), snap(), [buy('c1')]);
    expect(run(addition({ dueDate: '2026-02-30' }))).toThrow(ScenarioError);
    expect(run(addition({ amountCents: '0' }))).toThrow(ScenarioError);
    expect(run(addition({ amountCents: '-5' }))).toThrow(ScenarioError);
    expect(run(addition({ amountCents: '12,5' }))).toThrow(ScenarioError);
    expect(run(addition({ direction: 'x' as never }))).toThrow(ScenarioError);
  });

  it('adição com vencimento até a data-base é ignorada com aviso (já estaria no saldo informado)', () => {
    const r = simulateWith(fakeBuy([addition({ dueDate: '2026-11-11' }), addition({ dueDate: '2026-11-12' })]), snap(), [buy('c1')]);
    expect(r.createdEntries.map((e) => e.id)).toEqual(['scn:c1:2']);
    expect(r.warnings.join(' ')).toContain('11/11/2026');
  });

  it('id hipotético que já existe na base é recusado com aviso (a base nunca é sobrescrita)', () => {
    const clash = [...demo(), entry('scn:c1:1', 'out', '777', '2026-11-18', { sourceKey: 'manual:x' })];
    const r = simulateWith(fakeBuy([addition()]), snap(clash), [buy('c1')]);
    expect(r.createdEntries).toEqual([]);
    expect(r.effects[0]?.status).toBe('ignored');
    expect(r.warnings.join(' ')).toContain('scn:c1:1');
  });

  it('o que cai depois do horizonte é dito e não conta no saldo, sem fingir que "passou" para depois', () => {
    const r = simulateWith(fakeBuy([addition({ dueDate: '2026-12-30' })]), snap(), [buy('c1')]);
    expect(r.createdEntries).toHaveLength(1);
    expect(r.alternativeProjection.summary.beyondHorizon).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/1 lançamento\(s\) da hipótese vence\(m\) depois do horizonte/);
    expect(r.warnings.join(' ')).not.toContain('passam a vencer');
    expect(json(r.alternativeProjection.points)).toBe(json(r.baseProjection.points));
  });
});

describe('simulate — retirada de lançamento (antecipação) e composição sem soma dupla', () => {
  it('retira o recebível da data futura e cria o líquido na data antecipada: nunca os dois', () => {
    const r = simulateWith(both, snap(), [advance('a1', 'demo-receita-02')]);
    // base: 12/11 500 · 13/11 1.300 · 14/11 −700 · 15/11 3.300. Antecipa R$ 4.000 de 15/11 por R$ 3.960 em 13/11:
    // alternativa: 13/11 500+800+3.960 = 5.260 · 14/11 3.260 · 15/11 3.260 (o original SUMIU de 15/11)
    expect(r.alternativeProjection.points.slice(0, 4).map((p) => p.closingCents)).toEqual([50000n, 526000n, 326000n, 326000n]);
    expect(r.deltaByDate.slice(0, 4).map((d) => d.deltaCents)).toEqual([0n, 396000n, 396000n, -4000n]);
    expect(r.removedEntryIds).toEqual(['demo-receita-02']);
    expect(r.createdEntries.map((e) => e.id)).toEqual(['scn:a1:1']);
    expect(r.alternativeProjection.points.flatMap((p) => p.entryIds)).not.toContain('demo-receita-02');
    expect(r.effects[0]?.changes).toEqual([{ entryId: 'demo-receita-02', description: 'L demo-receita-02', field: 'removed', from: '2026-11-15', to: null }]);
    // soma explicada: delta final = líquido − bruto = −custo
    expect((r.deltaByDate.at(-1) as { deltaCents: bigint }).deltaCents).toBe(-4000n);
  });

  it('retirar um lançamento já alterado por outro ajuste é conflito: o primeiro vence e a adição dependente NÃO entra', () => {
    const r = simulateWith(both, snap(), [delay('d1', 'demo-receita-02', 2), advance('a1', 'demo-receita-02')]);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(r.createdEntries).toEqual([]);
    expect(r.removedEntryIds).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/Ajuste a1 ignorado em demo-receita-02.*já alterado por/);
    expect(r.warnings.join(' ')).toMatch(/lançamento hipotético.*não foi criado/);
    // só o atraso valeu: 15/11 → 17/11 (soma única)
    expect(closing(r.alternativeProjection, '2026-11-15')).toBe(-70000n);
    expect(closing(r.alternativeProjection, '2026-11-17')).toBe(330000n);
  });

  it('alterar um lançamento já retirado é conflito: o atraso seguinte é ignorado e o valor não volta', () => {
    const r = simulateWith(both, snap(), [advance('a1', 'demo-receita-02'), delay('d1', 'demo-receita-02', 2)]);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(r.warnings.join(' ')).toMatch(/ignorado em demo-receita-02 \(data\): já alterado por/);
    expect(r.alternativeProjection.points.flatMap((p) => p.entryIds).filter((id) => id === 'demo-receita-02')).toEqual([]);
    expect(closing(r.alternativeProjection, '2026-11-17')).toBe(326000n);
  });

  it('retirar o mesmo recebível por dois ajustes vale uma vez só (segundo ignorado e sem criar o líquido de novo)', () => {
    const r = simulateWith(both, snap(), [advance('a1', 'demo-receita-02'), advance('a2', 'demo-receita-02')]);
    expect(r.createdEntries.map((e) => e.id)).toEqual(['scn:a1:1']);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(closing(r.alternativeProjection, '2026-11-15')).toBe(326000n);
  });

  it('retirada de lançamento que não conta no saldo é ignorada com aviso e não cria a adição dependente', () => {
    const ghost: ApplierRegistry = { advance_receivable: () => ({ changes: [{ entryId: 'fantasma', remove: true }], additions: [addition({ dependsOn: 'fantasma' })], assumptions: [], warnings: [] }) };
    const g = simulateWith(ghost, snap(), [advance('g', 'x')]);
    expect(g.removedEntryIds).toEqual([]);
    expect(g.createdEntries).toEqual([]);
    expect(g.effects[0]?.status).toBe('ignored');
    expect(g.warnings.join(' ')).toContain('fantasma');
  });

  it('adição que depende de uma retirada que este ajuste não fez não é criada (avisado)', () => {
    const broken: ApplierRegistry = { advance_receivable: () => ({ changes: [], additions: [addition({ dependsOn: 'demo-receita-02' })], assumptions: [], warnings: [] }) };
    const r = simulateWith(broken, snap(), [advance('b', 'demo-receita-02')]);
    expect(r.createdEntries).toEqual([]);
    expect(r.warnings.join(' ')).toContain('não foi criado');
  });

  it('as hipóteses da S05 e as criadas coexistem na mesma alternativa, cada lançamento uma vez por campo', () => {
    const r = simulateWith({ ...both, ...fakeBuy([addition({ dueDate: '2026-11-16' })]) }, snap(), [delay('d1', 'demo-receita-01', 1), buy('c1'), advance('a1', 'demo-receita-02')]);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'applied', 'applied']);
    // à mão: 12/11 R$ 500 · 13/11 +3.960 (líquido antecipado) = 4.460 · 14/11 +800 (atraso de 13→14) −2.000 = 3.260 ·
    // 15/11 3.260 (o R$ 4.000 original saiu) · 16/11 −1.000 (compra) = 2.260
    expect(r.alternativeProjection.points.slice(0, 5).map((p) => p.closingCents)).toEqual([50000n, 446000n, 326000n, 326000n, 226000n]);
  });
});

describe('simulate — trilha de mudanças (de → para) calculada a partir do valor ORIGINAL', () => {
  it('registra data e valor originais e novos de cada lançamento alterado', () => {
    const r = simulateWith(fakes, snap(), [delay('d1', 'demo-receita-02', 2), { id: 'x', kind: 'scale_expense', from: '2026-11-14', to: '2026-11-14', change: { mode: 'factor', factorBps: 5000 } }]);
    expect(r.effects[0]?.changes).toEqual([{ entryId: 'demo-receita-02', description: 'L demo-receita-02', field: 'dueDate', from: '2026-11-15', to: '2026-11-17' }]);
    expect(r.effects[1]?.changes).toEqual([{ entryId: 'demo-despesa-02', description: 'L demo-despesa-02', field: 'amountCents', from: '200000', to: '100000' }]);
  });

  it('um ajuste ignorado por conflito não registra mudança', () => {
    const r = simulateWith(fakes, snap(), [delay('d1', 'demo-receita-02', 2), delay('d2', 'demo-receita-02', 5)]);
    expect(r.effects[1]?.changes).toEqual([]);
  });
});
