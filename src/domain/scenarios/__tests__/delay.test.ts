import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../../finance/dates';
import { project } from '../../finance/projection';
import type { CashEntry, CashSettings } from '../../finance/types';
import { createBaseSnapshot, createScenario, deepFreeze, simulate, simulateScenario } from '../engine';
import { applyDelay, MAX_DELAY_DAYS } from '../delay';
import { ScenarioError } from '../types';
import type { ApplierContext, BaseSnapshot, DelayReceiptAdjustment } from '../types';

const settings = (o: Partial<CashSettings> = {}): CashSettings => ({ baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000', ...o });
const entry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string, extra: Partial<CashEntry> = {}): CashEntry => ({
  id, direction, amountCents, dueDate, description: `L ${id}`, category: '', origin: 'manual', sourceKey: `manual:${id}`, state: 'scheduled', ...extra,
});
// Demo S01 (valores à mão): 12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 · 15/11 R$ 3.300.
const demo = (): CashEntry[] => [
  entry('demo-despesa-01', 'out', '250000', '2026-11-12'),
  entry('demo-receita-01', 'in', '80000', '2026-11-13'),
  entry('demo-despesa-02', 'out', '200000', '2026-11-14'),
  entry('demo-receita-02', 'in', '400000', '2026-11-15'),
];
const snap = (entries: CashEntry[] = demo(), s: CashSettings = settings(), horizonDays?: number): BaseSnapshot => createBaseSnapshot({ settings: s, entries, horizonDays });
const delay = (id: string, entryId: string, days: number): DelayReceiptAdjustment => ({ id, kind: 'delay_receipt', entryId, days });
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
const at = (r: { points: { date: string; closingCents: bigint; entryIds: string[]; incomingCents: bigint }[] }, date: string) => r.points.find((p) => p.date === date);
const totalIn = (r: { points: { incomingCents: bigint }[] }) => r.points.reduce((s, p) => s + p.incomingCents, 0n);

describe('atraso: o valor sai da data anterior e aparece uma única vez na nova', () => {
  it('demo S01: R$ 4.000 de 15/11 atrasa 2 dias → 17/11 (valores calculados à mão)', () => {
    const r = simulate(snap(), [delay('a1', 'demo-receita-02', 2)]);
    // base:        12/11 500 · 13/11 1.300 · 14/11 −700 · 15/11 3.300 · 16/11 3.300 · 17/11 3.300
    // alternativa: 12/11 500 · 13/11 1.300 · 14/11 −700 · 15/11 −700  · 16/11 −700  · 17/11 3.300
    expect(at(r.baseProjection, '2026-11-15')?.closingCents).toBe(330_000n);
    expect(at(r.alternativeProjection, '2026-11-15')?.closingCents).toBe(-70_000n);
    expect(at(r.alternativeProjection, '2026-11-16')?.closingCents).toBe(-70_000n);
    expect(at(r.alternativeProjection, '2026-11-17')?.closingCents).toBe(330_000n);
    const d = (date: string) => r.deltaByDate.find((p) => p.date === date)?.deltaCents;
    expect([d('2026-11-14'), d('2026-11-15'), d('2026-11-16'), d('2026-11-17'), d('2026-11-18')]).toEqual([0n, -400_000n, -400_000n, 0n, 0n]);
    // sai da data anterior e aparece uma única vez na nova, com o mesmo id causal
    expect(at(r.baseProjection, '2026-11-15')?.entryIds).toEqual(['demo-receita-02']);
    expect(at(r.alternativeProjection, '2026-11-15')?.entryIds).toEqual([]);
    expect(at(r.alternativeProjection, '2026-11-17')?.entryIds).toEqual(['demo-receita-02']);
    const occurrences = r.alternativeProjection.points.flatMap((p) => p.entryIds).filter((id) => id === 'demo-receita-02');
    expect(occurrences).toHaveLength(1);
    // soma total preservada (R$ 4.800 de recebimentos na base e na alternativa)
    expect(totalIn(r.baseProjection)).toBe(480_000n);
    expect(totalIn(r.alternativeProjection)).toBe(480_000n);
    expect(r.effects).toMatchObject([{ adjustmentId: 'a1', status: 'applied', changedEntryIds: ['demo-receita-02'] }]);
  });

  it('o cenário base fica intacto (snapshot congelado, mesma projeção antes e depois)', () => {
    const s = snap();
    deepFreeze(s);
    const before = json(s);
    const baseBefore = json(project(s.settings, s.entries, { horizonDays: s.horizonDays }));
    const adjustments = deepFreeze([delay('a1', 'demo-receita-02', 2)]);
    const r = simulate(s, adjustments);
    expect(json(s)).toBe(before);
    expect(json(r.baseProjection)).toBe(baseBefore);
    expect(s.entries.find((e) => e.id === 'demo-receita-02')?.dueDate).toBe('2026-11-15');
    expect(json(simulate(s, adjustments))).toBe(json(r)); // determinístico
  });

  it('outro lançamento no mesmo dia não é afetado', () => {
    const entries = [entry('a', 'in', '10000', '2026-11-20'), entry('b', 'in', '20000', '2026-11-20')];
    const r = simulate(snap(entries), [delay('a1', 'a', 3)]);
    expect(at(r.alternativeProjection, '2026-11-20')?.entryIds).toEqual(['b']);
    expect(at(r.alternativeProjection, '2026-11-23')?.entryIds).toEqual(['a']);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(20_000n);
  });
});

describe('atraso: datas de calendário', () => {
  it('fim de mês: 30/11 + 1 dia → 01/12', () => {
    const r = simulate(snap([entry('r', 'in', '30000', '2026-11-30')]), [delay('a1', 'r', 1)]);
    expect(at(r.alternativeProjection, '2026-11-30')?.entryIds).toEqual([]);
    expect(at(r.alternativeProjection, '2026-12-01')?.entryIds).toEqual(['r']);
    expect(at(r.alternativeProjection, '2026-11-30')?.closingCents).toBe(300_000n);
    expect(at(r.alternativeProjection, '2026-12-01')?.closingCents).toBe(330_000n);
  });

  it('fevereiro: 28/02/2027 + 1 → 01/03 (não bissexto); 28/02/2028 + 2 → 01/03 passando por 29/02 (bissexto)', () => {
    const common = { openingBalanceCents: '0', minimumBalanceCents: '0' };
    const a = simulate(snap([entry('r', 'in', '1000', '2027-02-28')], settings({ baseDate: '2027-02-20', ...common })), [delay('a1', 'r', 1)]);
    expect(at(a.alternativeProjection, '2027-03-01')?.entryIds).toEqual(['r']);
    const b = simulate(snap([entry('r', 'in', '1000', '2028-02-28')], settings({ baseDate: '2028-02-20', ...common })), [delay('a1', 'r', 2)]);
    expect(at(b.alternativeProjection, '2028-02-29')?.entryIds).toEqual([]);
    expect(at(b.alternativeProjection, '2028-03-01')?.entryIds).toEqual(['r']);
    const c = simulate(snap([entry('r', 'in', '1000', '2028-02-28')], settings({ baseDate: '2028-02-20', ...common })), [delay('a1', 'r', 1)]);
    expect(at(c.alternativeProjection, '2028-02-29')?.entryIds).toEqual(['r']);
  });

  it('virada de ano: 30/12/2026 + 3 → 02/01/2027', () => {
    const r = simulate(snap([entry('r', 'in', '5000', '2026-12-30')], settings({ baseDate: '2026-12-20' })), [delay('a1', 'r', 3)]);
    expect(at(r.alternativeProjection, '2027-01-02')?.entryIds).toEqual(['r']);
    expect(at(r.alternativeProjection, '2026-12-30')?.entryIds).toEqual([]);
    expect(at(r.alternativeProjection, '2027-01-02')?.closingCents).toBe(305_000n);
  });

  it('limite superior: 365 dias é aceito e 366 é recusado', () => {
    expect(MAX_DELAY_DAYS).toBe(365);
    expect(() => simulate(snap(), [delay('a1', 'demo-receita-02', 365)])).not.toThrow();
    expect(() => simulate(snap(), [delay('a1', 'demo-receita-02', 366)])).toThrow(ScenarioError);
  });
});

describe('atraso: horizonte', () => {
  it('atraso que empurra para fora do horizonte: o valor deixa de contar nele e isso é dito', () => {
    const r = simulate(snap(demo(), settings(), 10), [delay('a1', 'demo-receita-02', 30)]); // 15/11 → 15/12 (horizonte termina em 21/11)
    expect(r.alternativeProjection.summary.beyondHorizon).toBe(1);
    expect(totalIn(r.baseProjection)).toBe(480_000n);
    expect(totalIn(r.alternativeProjection)).toBe(80_000n);
    expect(r.alternativeProjection.summary.endingCents).toBe(r.baseProjection.summary.endingCents - 400_000n);
    const text = r.warnings.join(' | ');
    expect(text).toContain('15/12/2026');
    expect(text).toContain('depois do horizonte de 10 dias');
    expect(text).toContain('R$ 4.000,00');
  });

  it('atraso que cai dentro do horizonte (último dia incluído) não avisa sobre horizonte', () => {
    const r = simulate(snap(demo(), settings(), 10), [delay('a1', 'demo-receita-02', 6)]); // 21/11 = último dia do horizonte
    expect(at(r.alternativeProjection, '2026-11-21')?.entryIds).toEqual(['demo-receita-02']);
    expect(r.alternativeProjection.summary.beyondHorizon).toBe(0);
    expect(r.warnings.join(' ')).not.toContain('horizonte');
  });
});

describe('atraso: dados críticos recalculados e risco', () => {
  const risky = () => snap([entry('r', 'in', '500000', '2026-11-12'), entry('d', 'out', '600000', '2026-11-14')], settings({ openingBalanceCents: '300000', minimumBalanceCents: '0' }));

  it('novo risco: data e valor críticos mudam (base 12/11 8.000 · 14/11 2.000; alternativa 14/11 −3.000)', () => {
    const r = simulate(risky(), [delay('a1', 'r', 3)]);
    expect(r.baseProjection.summary.firstRisk).toBeNull();
    expect(r.baseProjection.summary.lowest.closingCents).toBe(200_000n);
    expect(r.alternativeProjection.summary.firstNegative?.date).toBe('2026-11-14');
    expect(r.alternativeProjection.summary.firstNegative?.shortfallCents).toBe(300_000n);
    expect(r.alternativeProjection.summary.lowest).toMatchObject({ date: '2026-11-14', closingCents: -300_000n });
    expect(r.riskDiff.newRiskDates).toEqual(['2026-11-14']);
    expect(r.warnings.join(' ')).toContain('cria risco');
  });

  it('o risco some ao voltar ao original (cenário sem o atraso)', () => {
    const s = risky();
    expect(simulate(s, [delay('a1', 'r', 3)]).alternativeProjection.summary.firstNegative).not.toBeNull();
    const back = simulate(s, []);
    expect(back.alternativeProjection.summary.firstRisk).toBeNull();
    expect(json(back.alternativeProjection)).toBe(json(back.baseProjection));
  });

  it('atraso de 0 dia não muda nada e diz isso', () => {
    const r = simulate(snap(), [delay('a1', 'demo-receita-02', 0)]);
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
    expect(r.effects[0]?.status).toBe('ignored');
    expect(r.warnings.join(' ')).toContain('0 dia');
  });
});

describe('atraso: composição (dois ajustes no mesmo recebível)', () => {
  it('o primeiro vale, o segundo é ignorado com aviso e o valor nunca aparece duas vezes', () => {
    const r = simulate(snap(), [delay('a1', 'demo-receita-02', 2), delay('a2', 'demo-receita-02', 5)]);
    const ids = r.alternativeProjection.points.flatMap((p) => p.entryIds).filter((id) => id === 'demo-receita-02');
    expect(ids).toHaveLength(1);
    expect(at(r.alternativeProjection, '2026-11-17')?.entryIds).toEqual(['demo-receita-02']); // +2, não +5 nem +7
    expect(totalIn(r.alternativeProjection)).toBe(480_000n);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(r.warnings.join(' ')).toContain('já alterado por');
  });

  it('atrasos em recebíveis diferentes se combinam; o mesmo id de ajuste repetido não dobra', () => {
    const r = simulate(snap(), [delay('a1', 'demo-receita-01', 1), delay('a2', 'demo-receita-02', 1), delay('a1', 'demo-receita-02', 9)]);
    expect(at(r.alternativeProjection, '2026-11-14')?.entryIds).toEqual(['demo-despesa-02', 'demo-receita-01']);
    expect(at(r.alternativeProjection, '2026-11-16')?.entryIds).toEqual(['demo-receita-02']);
    expect(totalIn(r.alternativeProjection)).toBe(480_000n);
  });
});

describe('atraso: semântica por origem e alvos inválidos', () => {
  it('repasse derivado de venda e conta importada têm textos diferentes', () => {
    const sale = entry('rcv_1', 'in', '9000', '2026-11-20', { origin: 'sale', sourceKey: 'sale-settlement:sale_1', description: 'Repasse estimado da venda V1', linkedSaleId: 'sale_1' });
    const csv = entry('conta-1', 'in', '8000', '2026-11-20', { origin: 'csv', sourceKey: 'csv:1', description: 'Cliente X' });
    const s = snap([sale, csv]);
    const a = simulate(s, [delay('a1', 'rcv_1', 2)]).assumptions.join(' | ');
    const b = simulate(s, [delay('a1', 'conta-1', 2)]).assumptions.join(' | ');
    expect(a).toContain('repasse estimado');
    expect(a).toContain('R$ 90,00');
    expect(a).toContain('20/11/2026');
    expect(a).toContain('22/11/2026');
    expect(a).toContain('sem dias úteis nem feriados');
    expect(b).toContain('conta importada');
    expect(b).not.toContain('repasse estimado');
  });

  it.each([
    ['inexistente', 'nao-existe', 'não existe na base'],
    ['saída (pagamento)', 'demo-despesa-01', 'não é um recebível'],
    ['já liquidado', 'pago', 'já foi liquidado'],
    ['vencido até a data-base', 'velho', 'já está no saldo informado'],
  ])('recebível %s é ignorado com aviso e nada muda', (_nome, entryId, trecho) => {
    const s = snap([...demo(), entry('pago', 'in', '1000', '2026-11-13', { state: 'settled', settledAt: '2026-11-11' }), entry('velho', 'in', '2000', '2026-11-11')]);
    const r = simulate(s, [delay('a1', entryId, 2)]);
    expect(r.effects[0]?.status).toBe('ignored');
    expect(r.warnings.join(' ')).toContain(trecho);
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
  });

  it.each([[-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY], ['3' as unknown as number]])('dias inválidos (%s) são erro de entrada', (days) => {
    expect(() => simulate(snap(), [delay('a1', 'demo-receita-02', days)])).toThrow(ScenarioError);
  });

  it('id do lançamento vazio é erro de entrada', () => {
    expect(() => simulate(snap(), [delay('a1', '', 1)])).toThrow(ScenarioError);
  });

  it('applyDelay isolado devolve só a mudança de data (nunca de valor)', () => {
    const s = snap();
    const ctx: ApplierContext = { snapshot: s, live: new Map(s.entries.map((e) => [e.id, e])), all: new Map(s.entries.map((e) => [e.id, e])), saleBasis: new Map() };
    const out = applyDelay(delay('a1', 'demo-receita-02', 2), ctx);
    expect(out.changes).toEqual([{ entryId: 'demo-receita-02', dueDate: '2026-11-17' }]);
  });
});

describe('atraso: propriedades (dados pseudoaleatórios determinísticos)', () => {
  it('um recebível atrasado aparece exatamente uma vez (na data nova), a soma é preservada e nenhum dia melhora', () => {
    let seed = 987;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 80; round += 1) {
      const entries: CashEntry[] = [];
      const count = 2 + rnd(12);
      for (let i = 0; i < count; i += 1) entries.push(entry(`e${i}`, rnd(3) === 0 ? 'out' : 'in', String(1 + rnd(500_000)), addDays('2026-11-11', 1 + rnd(30))));
      const target = entries.find((e) => e.direction === 'in');
      if (!target) continue;
      const days = rnd(70);
      const s = snap(entries, settings({ openingBalanceCents: String(rnd(1_000_000)), minimumBalanceCents: '0' }));
      const r = simulate(s, [delay('a1', target.id, days)]);
      const newDate = addDays(target.dueDate, days);
      const horizonEnd = addDays('2026-11-11', 30);
      const seen = r.alternativeProjection.points.filter((p) => p.entryIds.includes(target.id)).map((p) => p.date);
      expect(seen).toEqual(newDate <= horizonEnd ? [newDate] : []);
      if (days > 0 && newDate <= horizonEnd) expect(totalIn(r.alternativeProjection)).toBe(totalIn(r.baseProjection));
      if (newDate > horizonEnd) expect(totalIn(r.baseProjection) - totalIn(r.alternativeProjection)).toBe(BigInt(target.amountCents));
      for (const p of r.deltaByDate) {
        expect(p.deltaCents <= 0n).toBe(true); // atrasar um recebimento nunca melhora o saldo de nenhum dia
        if (p.date < target.dueDate || daysBetween(newDate, p.date) >= 0) expect(p.deltaCents).toBe(0n);
      }
    }
  });
});

describe('atraso: cenário replayável', () => {
  it('createScenario + simulateScenario (motor padrão) equivale a simulate', () => {
    const s = snap();
    const adjustments = [delay('a1', 'demo-receita-02', 2)];
    const scenario = createScenario(s, 'Cliente paga 2 dias depois', adjustments, 'cen-1');
    expect(json(simulateScenario(s, scenario))).toBe(json(simulate(s, adjustments)));
  });
});
