import { describe, expect, it } from 'vitest';
import { addDays } from '../../finance/dates';
import type { CashEntry, CashSettings } from '../../finance/types';
import { createBaseSnapshot, deepFreeze, simulate } from '../engine';
import { applyScaleExpense, applyScaleSales, bpsText, MAX_FACTOR_BPS, roundHalfUpBps } from '../shocks';
import { HYPOTHETICAL_LABEL, ScenarioError } from '../types';
import type { Adjustment, ApplierContext, BaseSnapshot, SaleBasis, ScaleExpenseAdjustment, ScaleSalesAdjustment, ShockChange } from '../types';

const zero = (o: Partial<CashSettings> = {}): CashSettings => ({ baseDate: '2026-11-11', openingBalanceCents: '0', minimumBalanceCents: '0', ...o });
const entry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string, extra: Partial<CashEntry> = {}): CashEntry => ({
  id, direction, amountCents, dueDate, description: `L ${id}`, category: '', origin: 'manual', sourceKey: `manual:${id}`, state: 'scheduled', ...extra,
});
const sale = (id: string, net: string, dueDate: string, extra: Partial<CashEntry> = {}): CashEntry =>
  entry(id, 'in', net, dueDate, { origin: 'sale', sourceKey: `sale-settlement:${id}`, linkedSaleId: `sale_${id}`, ...extra });
const basis = (entryId: string, grossCents: string, costBps: number, saleDate = '2026-11-01'): SaleBasis => ({ entryId, saleDate, grossCents, costBps });
const snap = (entries: CashEntry[], saleBasis: SaleBasis[] = [], s: CashSettings = zero(), horizonDays?: number): BaseSnapshot => createBaseSnapshot({ settings: s, entries, saleBasis, horizonDays });
const factor = (factorBps: number): ShockChange => ({ mode: 'factor', factorBps });
const salesShock = (id: string, from: string, to: string, change: ShockChange): ScaleSalesAdjustment => ({ id, kind: 'scale_sales', from, to, change });
const expShock = (id: string, from: string, to: string, change: ShockChange, category?: string): ScaleExpenseAdjustment => ({ id, kind: 'scale_expense', from, to, change, ...(category !== undefined ? { category } : {}) });
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
const at = (r: { points: { date: string; closingCents: bigint; outgoingCents: bigint; incomingCents: bigint; entryIds: string[] }[] }, date: string) => r.points.find((p) => p.date === date);

describe('arredondamento em basis points (meio-sobe, BigInt)', () => {
  it.each([
    [5n, 5000, 3n], // 2,5 → 3
    [1n, 5000, 1n], // 0,5 → 1
    [1n, 4999, 0n], // 0,4999 → 0
    [3n, 5000, 2n], // 1,5 → 2
    [7n, 3333, 2n], // 2,3331 → 2
    [100000n, 7000, 70000n],
    [10n, 10000, 10n],
    [10n, 0, 0n],
    [999n, 10001, 999n], // 999,0999 → 999
    [5n, 15000, 8n], // 7,5 → 8
  ])('%s centavos × %s bps = %s', (amount, bps, expected) => {
    expect(roundHalfUpBps(amount, bps)).toBe(expected);
  });

  it('formata basis points sem ponto flutuante', () => {
    expect([bpsText(10000), bpsText(8000), bpsText(8050), bpsText(8005), bpsText(0), bpsText(100000), bpsText(1)]).toEqual(['100%', '80%', '80,5%', '80,05%', '0%', '1.000%', '0,01%']);
  });
});

describe('choque de vendas (scale_sales): escala o BRUTO e recalcula o líquido pela regra de repasse', () => {
  it('R$ 1.000,00 bruto, custo 3,99%: líquido R$ 960,10 → 70% do bruto → R$ 672,07 (conta feita à mão)', () => {
    // fee = 100000×399/10000 = 3990 → líquido 96010. 70%: bruto 70000; fee = 2793 → líquido 67207.
    const s = snap([sale('rcv_a', '96010', '2026-11-20')], [basis('rcv_a', '100000', 399)]);
    const r = simulate(s, [salesShock('s1', '2026-11-15', '2026-11-30', factor(7000))]);
    expect(at(r.baseProjection, '2026-11-20')?.incomingCents).toBe(96_010n);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(67_207n);
    expect(r.deltaByDate.find((d) => d.date === '2026-11-20')?.deltaCents).toBe(-28_803n);
    expect(r.deltaByDate.find((d) => d.date === '2026-11-19')?.deltaCents).toBe(0n);
    expect(r.effects[0]).toMatchObject({ status: 'applied', changedEntryIds: ['rcv_a'] });
  });

  it('recalcula pelo bruto, não escala o líquido: bruto 10, custo 50% ⇒ líquido 5; 30% do bruto = 3 ⇒ taxa 2 ⇒ líquido 1 (escalar o líquido daria 2)', () => {
    const s = snap([sale('rcv_a', '5', '2026-11-20')], [basis('rcv_a', '10', 5000)]);
    const r = simulate(s, [salesShock('s1', '2026-11-12', '2026-11-30', factor(3000))]);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(1n);
  });

  it('período inclusivo nas duas pontas pelo vencimento ORIGINAL', () => {
    const entries = ['2026-11-14', '2026-11-15', '2026-11-20', '2026-11-21'].map((d, i) => sale(`rcv_${i}`, '9000', d));
    const s = snap(entries, entries.map((e) => basis(e.id, '10000', 1000)));
    const r = simulate(s, [salesShock('s1', '2026-11-15', '2026-11-20', factor(5000))]);
    // bruto 10000 × 50% = 5000; taxa 10% = 500 ⇒ líquido 4500
    expect(['2026-11-14', '2026-11-15', '2026-11-20', '2026-11-21'].map((d) => at(r.alternativeProjection, d)?.incomingCents)).toEqual([9000n, 4500n, 4500n, 9000n]);
    expect(r.effects[0]?.changedEntryIds).toEqual(['rcv_1', 'rcv_2']);
  });

  it('não toca contas importadas, lançamentos manuais, vendas conciliadas (que valem a conta) nem liquidados', () => {
    const csv = entry('conta', 'in', '50000', '2026-11-20', { origin: 'csv', sourceKey: 'csv:1', saleReference: 'V1' });
    const manual = entry('manual-in', 'in', '7000', '2026-11-20');
    const paid = sale('rcv_pago', '9000', '2026-11-20', { state: 'settled', settledAt: '2026-11-11' });
    const s = snap([csv, manual, paid, sale('rcv_ok', '9000', '2026-11-20')], [basis('rcv_ok', '10000', 1000), basis('rcv_pago', '10000', 1000)]);
    const r = simulate(s, [salesShock('s1', '2026-11-12', '2026-11-30', factor(0))]);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(57_000n); // só o repasse derivado agendado sumiu
    expect(at(r.alternativeProjection, '2026-11-20')?.entryIds).toEqual(['conta', 'manual-in']);
    expect(r.assumptions.join(' ')).toContain('contas importadas');
    expect(r.assumptions.join(' ')).toContain('previsão de faturamento');
  });

  it('só origem "sale" é escalada, mesmo que exista uma base de venda para outro lançamento', () => {
    const csv = entry('conta', 'in', '50000', '2026-11-20', { origin: 'csv', sourceKey: 'csv:1' });
    const s = snap([csv, sale('rcv_ok', '9000', '2026-11-20')], [basis('conta', '60000', 100), basis('rcv_ok', '10000', 1000)]);
    const r = simulate(s, [salesShock('s1', '2026-11-12', '2026-11-30', factor(5000))]);
    expect(r.effects[0]?.changedEntryIds).toEqual(['rcv_ok']);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(54_500n); // 50.000 + (5.000 − 10% = 4.500)
  });

  it('fator de 100% não muda nada: sem mudança, sem premissa e o efeito aparece como ignorado', () => {
    const s = snap([sale('rcv_a', '96010', '2026-11-20'), entry('luz', 'out', '30000', '2026-11-15')], [basis('rcv_a', '100000', 399)]);
    const r = simulate(s, [salesShock('s1', '2026-11-12', '2026-11-30', factor(10_000)), expShock('x1', '2026-11-12', '2026-11-30', factor(10_000))]);
    expect(r.effects.map((e) => [e.status, e.changedEntryIds])).toEqual([['ignored', []], ['ignored', []]]);
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
    expect(r.assumptions.some((a) => a.startsWith('Hipótese: '))).toBe(false);
  });

  it('applyScaleSales/applyScaleExpense propõem valor 0 (nunca negativo) quando o valor explícito passa do total', () => {
    const e = entry('luz', 'out', '3000', '2026-11-15');
    const v = sale('rcv_a', '9601', '2026-11-20');
    const s = snap([e, v], [basis('rcv_a', '10000', 399)]);
    const ctx: ApplierContext = { snapshot: s, live: new Map(s.entries.map((x) => [x.id, x])), all: new Map(s.entries.map((x) => [x.id, x])), saleBasis: new Map(s.saleBasis.map((b) => [b.entryId, b])) };
    const change: ShockChange = { mode: 'amount', deltaCents: '-999999' };
    expect(applyScaleExpense(expShock('x', '2026-11-01', '2026-11-30', change), ctx).changes).toEqual([{ entryId: 'luz', amountCents: '0' }]);
    expect(applyScaleSales(salesShock('s', '2026-11-01', '2026-11-30', change), ctx).changes).toEqual([{ entryId: 'rcv_a', amountCents: '0' }]);
  });

  it('repasse sem base de venda não é alterado e o aviso diz quais', () => {
    const s = snap([sale('rcv_sem', '9000', '2026-11-20')], []);
    const r = simulate(s, [salesShock('s1', '2026-11-12', '2026-11-30', factor(5000))]);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(9000n);
    expect(r.effects[0]?.status).toBe('ignored');
    expect(r.warnings.join(' ')).toContain('rcv_sem');
    expect(r.warnings.join(' ')).toContain('sem base de venda');
  });

  it('período sem repasses: nada muda e o aviso diz isso', () => {
    const s = snap([sale('rcv_a', '9000', '2026-11-20')], [basis('rcv_a', '10000', 1000)]);
    const r = simulate(s, [salesShock('s1', '2026-12-01', '2026-12-05', factor(5000))]);
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
    expect(r.warnings.join(' ')).toContain('nenhum repasse de venda');
  });

  it('valor explícito: −R$ 20,00 no bruto de cada repasse (100000 → 98000; taxa 3,99% = 3910 ⇒ líquido 94090)', () => {
    const s = snap([sale('rcv_a', '96010', '2026-11-20')], [basis('rcv_a', '100000', 399)]);
    const r = simulate(s, [salesShock('s1', '2026-11-12', '2026-11-30', { mode: 'amount', deltaCents: '-2000' })]);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(94_090n);
  });

  it('valor explícito maior que o bruto zera o repasse (retirado da alternativa, com aviso)', () => {
    const s = snap([sale('rcv_a', '96010', '2026-11-20')], [basis('rcv_a', '100000', 399)]);
    const r = simulate(s, [salesShock('s1', '2026-11-12', '2026-11-30', { mode: 'amount', deltaCents: '-999999' })]);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(0n);
    expect(r.warnings.join(' ')).toContain('ficou com valor zero');
  });

  it('acima de 100% aumenta o bruto (150%: 150000; taxa 5985 ⇒ líquido 144015)', () => {
    const s = snap([sale('rcv_a', '96010', '2026-11-20')], [basis('rcv_a', '100000', 399)]);
    const r = simulate(s, [salesShock('s1', '2026-11-12', '2026-11-30', factor(15000))]);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(144_015n);
  });
});

describe('choque de despesas (scale_expense)', () => {
  const entries = (): CashEntry[] => [
    entry('luz', 'out', '30000', '2026-11-15', { category: 'Fixas' }),
    entry('carne', 'out', '50001', '2026-11-16', { category: 'Fornecedores' }),
    entry('gas', 'out', '10000', '2026-11-30', { category: 'Fixas' }),
    entry('venda', 'in', '99999', '2026-11-16'),
    entry('paga', 'out', '70000', '2026-11-16', { category: 'Fixas', state: 'settled', settledAt: '2026-11-11' }),
    entry('rec', 'out', '20000', '2026-11-17', { category: 'Fixas', origin: 'recurring', sourceKey: 'rec:x:2026-11-17' }),
  ];

  it('sem categoria afeta todas as saídas agendadas do período, com meio-sobe: 50001 × 50% = 25000,5 → 25001', () => {
    const r = simulate(snap(entries()), [expShock('x1', '2026-11-15', '2026-11-17', factor(5000))]);
    expect(at(r.alternativeProjection, '2026-11-15')?.outgoingCents).toBe(15_000n);
    expect(at(r.alternativeProjection, '2026-11-16')?.outgoingCents).toBe(25_001n);
    expect(at(r.alternativeProjection, '2026-11-17')?.outgoingCents).toBe(10_000n);
    expect(at(r.alternativeProjection, '2026-11-30')?.outgoingCents).toBe(10_000n); // fora do período
    expect(at(r.alternativeProjection, '2026-11-16')?.incomingCents).toBe(99_999n); // entradas intactas
    expect(r.effects[0]?.changedEntryIds).toEqual(['luz', 'carne', 'rec']);
  });

  it('filtra por categoria exata', () => {
    const r = simulate(snap(entries()), [expShock('x1', '2026-11-01', '2026-12-31', factor(20000), 'Fixas')]);
    expect(at(r.alternativeProjection, '2026-11-15')?.outgoingCents).toBe(60_000n);
    expect(at(r.alternativeProjection, '2026-11-16')?.outgoingCents).toBe(50_001n); // Fornecedores intacta
    expect(at(r.alternativeProjection, '2026-11-30')?.outgoingCents).toBe(20_000n);
    expect(r.effects[0]?.changedEntryIds).toEqual(['luz', 'rec', 'gas']);
  });

  it('liquidados nunca mudam (já estão no saldo informado)', () => {
    const r = simulate(snap(entries()), [expShock('x1', '2026-11-01', '2026-12-31', factor(0))]);
    expect(r.effects[0]?.changedEntryIds).not.toContain('paga');
    expect(r.baseProjection.points.flatMap((p) => p.entryIds)).not.toContain('paga');
  });

  it('fator zero retira a despesa; fator 100000 é aceito', () => {
    const r = simulate(snap(entries()), [expShock('x1', '2026-11-15', '2026-11-15', factor(0))]);
    expect(at(r.alternativeProjection, '2026-11-15')?.outgoingCents).toBe(0n);
    expect(r.warnings.join(' ')).toContain('ficou com valor zero');
    expect(() => simulate(snap(entries()), [expShock('x1', '2026-11-15', '2026-11-15', factor(MAX_FACTOR_BPS))])).not.toThrow();
  });

  it('valor explícito por lançamento: +R$ 5,00 em cada saída do período', () => {
    const r = simulate(snap(entries()), [expShock('x1', '2026-11-15', '2026-11-16', { mode: 'amount', deltaCents: '500' })]);
    expect(at(r.alternativeProjection, '2026-11-15')?.outgoingCents).toBe(30_500n);
    expect(at(r.alternativeProjection, '2026-11-16')?.outgoingCents).toBe(50_501n);
    expect(r.assumptions.join(' ')).toContain('+R$ 5,00 por lançamento');
    const down = simulate(snap(entries()), [expShock('x1', '2026-11-15', '2026-11-16', { mode: 'amount', deltaCents: '-500' })]);
    expect(down.assumptions.join(' ')).toContain('-R$ 5,00 por lançamento');
  });

  it('o aviso descreve a hipótese em texto, com percentual e categoria', () => {
    const r = simulate(snap(entries()), [expShock('x1', '2026-11-01', '2026-12-31', factor(8050), 'Fixas')]);
    const text = r.assumptions.join(' | ');
    expect(text).toContain('Fixas');
    expect(text).toContain('80,5%');
    expect(text).toContain('Hipótese');
    expect(r.label).toBe(HYPOTHETICAL_LABEL);
  });

  it('categoria sem despesas no período: nada muda e o aviso diz isso', () => {
    const r = simulate(snap(entries()), [expShock('x1', '2026-11-01', '2026-12-31', factor(5000), 'Inexistente')]);
    expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
    expect(r.warnings.join(' ')).toContain('nenhuma despesa');
  });
});

describe('choques: nunca aplicados duas vezes à mesma origem', () => {
  const s = () => snap([entry('luz', 'out', '30000', '2026-11-15'), sale('rcv_a', '96010', '2026-11-20')], [basis('rcv_a', '100000', 399)]);

  it('o mesmo ajuste (mesmo id) duas vezes = uma vez', () => {
    const once = simulate(s(), [expShock('x1', '2026-11-01', '2026-12-31', factor(5000))]);
    const twice = simulate(s(), [expShock('x1', '2026-11-01', '2026-12-31', factor(5000)), expShock('x1', '2026-11-01', '2026-12-31', factor(5000))]);
    expect(json(twice.alternativeProjection)).toBe(json(once.alternativeProjection));
    expect(at(twice.alternativeProjection, '2026-11-15')?.outgoingCents).toBe(15_000n); // não 7.500
  });

  it('dois ajustes iguais com ids diferentes na mesma origem: o primeiro vale, o segundo é ignorado com aviso (não 25%)', () => {
    const r = simulate(s(), [expShock('x1', '2026-11-01', '2026-12-31', factor(5000)), expShock('x2', '2026-11-01', '2026-12-31', factor(5000))]);
    expect(at(r.alternativeProjection, '2026-11-15')?.outgoingCents).toBe(15_000n);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(r.warnings.join(' ')).toContain('já alterado por');
  });

  it('dois choques de vendas sobrepostos: valem só pelo primeiro (o líquido não é escalado em cascata)', () => {
    const r = simulate(s(), [salesShock('a', '2026-11-01', '2026-12-31', factor(7000)), salesShock('b', '2026-11-01', '2026-12-31', factor(7000))]);
    expect(at(r.alternativeProjection, '2026-11-20')?.incomingCents).toBe(67_207n);
  });

  it('choque (valor) e atraso (data) do mesmo lançamento se combinam e independem da ordem', () => {
    const delay: Adjustment = { id: 'd1', kind: 'delay_receipt', entryId: 'rcv_a', days: 3 };
    const shock = salesShock('s1', '2026-11-20', '2026-11-20', factor(7000));
    const a = simulate(s(), [delay, shock]);
    const b = simulate(s(), [shock, delay]);
    expect(json(a.alternativeProjection)).toBe(json(b.alternativeProjection));
    expect(at(a.alternativeProjection, '2026-11-20')?.incomingCents).toBe(0n); // período usa o vencimento ORIGINAL (20/11)
    expect(at(a.alternativeProjection, '2026-11-23')?.incomingCents).toBe(67_207n);
  });

  it('a base não muda e o resultado é determinístico (snapshot congelado)', () => {
    const base = deepFreeze(s());
    const before = json(base);
    const adjustments = deepFreeze<Adjustment[]>([expShock('x1', '2026-11-01', '2026-12-31', factor(5000)), salesShock('s1', '2026-11-01', '2026-12-31', factor(9000))]);
    const a = simulate(base, adjustments);
    expect(json(base)).toBe(before);
    expect(json(simulate(base, adjustments))).toBe(json(a));
    expect(at(a.baseProjection, '2026-11-15')?.outgoingCents).toBe(30_000n);
  });
});

describe('choques: entradas inválidas são erro (ScenarioError)', () => {
  const base = () => snap([entry('luz', 'out', '30000', '2026-11-15')]);
  it.each([
    ['fator negativo', expShock('x', '2026-11-01', '2026-11-30', factor(-1))],
    ['fator acima do limite', expShock('x', '2026-11-01', '2026-11-30', factor(MAX_FACTOR_BPS + 1))],
    ['fator fracionário', expShock('x', '2026-11-01', '2026-11-30', factor(5000.5))],
    ['fator NaN', expShock('x', '2026-11-01', '2026-11-30', factor(Number.NaN))],
    ['início depois do fim', expShock('x', '2026-11-30', '2026-11-01', factor(5000))],
    ['data inválida', expShock('x', '2026-13-01', '2026-11-30', factor(5000))],
    ['valor explícito inválido', expShock('x', '2026-11-01', '2026-11-30', { mode: 'amount', deltaCents: '12,5' })],
    ['venda: fator inválido', salesShock('x', '2026-11-01', '2026-11-30', factor(-5))],
    ['venda: datas invertidas', salesShock('x', '2026-11-30', '2026-11-01', factor(5000))],
  ])('%s', (_nome, adjustment) => {
    expect(() => simulate(base(), [adjustment])).toThrow(ScenarioError);
  });
});

describe('choques: propriedades (dados pseudoaleatórios determinísticos)', () => {
  it('cada despesa do período vira meio-sobe(valor × bps / 10000) e o resto fica igual', () => {
    let seed = 4242;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 80; round += 1) {
      const list: CashEntry[] = [];
      for (let i = 0; i < 2 + rnd(10); i += 1) list.push(entry(`e${i}`, rnd(3) === 0 ? 'in' : 'out', String(1 + rnd(200_000)), addDays('2026-11-11', 1 + rnd(30)), { category: rnd(2) === 0 ? 'A' : 'B' }));
      const bps = rnd(25_000);
      const from = addDays('2026-11-11', 1 + rnd(15));
      const to = addDays(from, rnd(15));
      const cat = rnd(3) === 0 ? undefined : 'A';
      const r = simulate(snap(list), [expShock('x', from, to, factor(bps), cat)]);
      const expected = list.filter((e) => e.direction === 'out' && e.dueDate >= from && e.dueDate <= to && (cat === undefined || e.category === cat));
      // oráculo independente: floor((v × bps + 5000) / 10000)
      const alt = (e: CashEntry) => (BigInt(e.amountCents) * BigInt(bps) + 5000n) / 10000n;
      const baseOut = r.baseProjection.points.reduce((s, p) => s + p.outgoingCents, 0n);
      const altOut = r.alternativeProjection.points.reduce((s, p) => s + p.outgoingCents, 0n);
      const inHorizon = expected.filter((e) => e.dueDate <= addDays('2026-11-11', 30));
      const delta = inHorizon.reduce((s, e) => s + alt(e) - BigInt(e.amountCents), 0n);
      expect(altOut - baseOut).toBe(delta);
      expect(r.alternativeProjection.points.reduce((s, p) => s + p.incomingCents, 0n)).toBe(r.baseProjection.points.reduce((s, p) => s + p.incomingCents, 0n));
      if (bps === 10_000) expect(json(r.alternativeProjection)).toBe(json(r.baseProjection));
    }
  });
});
