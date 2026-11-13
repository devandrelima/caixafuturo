import { describe, expect, it } from 'vitest';
import type { CashEntry, CashSettings } from '../../finance/types';
import { createBaseSnapshot, simulate } from '../engine';
import { hiringMonthlyCost, hiringPaymentDates, HIRING_PREMISE, MAX_CHARGES_BPS } from '../hiring';
import { ScenarioError } from '../types';
import type { BaseSnapshot, HiringAdjustment } from '../types';

const settings: CashSettings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };
const entry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string): CashEntry => ({ id, direction, amountCents, dueDate, description: `L ${id}`, category: '', origin: 'manual', sourceKey: `manual:${id}`, state: 'scheduled' });
// Demo S01 (à mão): 12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 · 15/11 R$ 3.300 (e nada depois).
const demo = (): CashEntry[] => [entry('demo-despesa-01', 'out', '250000', '2026-11-12'), entry('demo-receita-01', 'in', '80000', '2026-11-13'), entry('demo-despesa-02', 'out', '200000', '2026-11-14'), entry('demo-receita-02', 'in', '400000', '2026-11-15')];
const snap = (horizonDays = 120, s: CashSettings = settings): BaseSnapshot => createBaseSnapshot({ settings: s, entries: demo(), horizonDays });
const hire = (o: Partial<HiringAdjustment> = {}): HiringAdjustment => ({ id: 'h1', kind: 'hiring', role: 'Auxiliar de cozinha', monthlyCostCents: '200000', chargesBps: 7000, fixedMonthlyCents: '30000', payDay: 5, startDate: '2026-11-20', ...o });
const closing = (r: { points: { date: string; closingCents: bigint }[] }, date: string) => r.points.find((p) => p.date === date)?.closingCents;
const dates = (r: { createdEntries: CashEntry[] }) => r.createdEntries.map((e) => e.dueDate);

describe('hiringMonthlyCost — tudo informado, nada estimado (à mão)', () => {
  it('R$ 2.000,00 + 70% de encargos informados (R$ 1.400,00) + R$ 300,00 fixos = R$ 3.700,00 por mês', () => {
    expect(hiringMonthlyCost(hire())).toEqual({ baseCents: 200_000n, chargesCents: 140_000n, fixedCents: 30_000n, totalCents: 370_000n });
  });
  it('encargo em meio-sobe: 70% de R$ 1.000,01 = R$ 700,007 → R$ 700,01', () => {
    expect(hiringMonthlyCost(hire({ monthlyCostCents: '100001', chargesBps: 7000, fixedMonthlyCents: undefined })).chargesCents).toBe(70_001n);
    expect(hiringMonthlyCost(hire({ monthlyCostCents: '1', chargesBps: 5000, fixedMonthlyCents: undefined })).chargesCents).toBe(1n); // 0,5 centavo → 1 (meio-sobe)
  });
  it('campos não informados contam como zero no custo (e a hipótese é sinalizada incompleta, abaixo)', () => {
    expect(hiringMonthlyCost(hire({ chargesBps: undefined, fixedMonthlyCents: undefined })).totalCents).toBe(200_000n);
    expect(hiringMonthlyCost(hire({ chargesBps: 0 })).totalCents).toBe(230_000n);
  });
});

describe('hiringPaymentDates — só a partir da data inicial, no dia de pagamento', () => {
  const dts = (o: Partial<HiringAdjustment>, base = '2026-11-11', end = '2027-06-30') => hiringPaymentDates(hire(o), base, end);
  it('dia de pagamento que já passou no mês da data inicial: o primeiro pagamento é no mês seguinte', () => {
    expect(dts({ startDate: '2026-11-20', payDay: 5 }).slice(0, 2)).toEqual(['2026-12-05', '2027-01-05']);
  });
  it('dia de pagamento depois da data inicial, no mesmo mês: paga já neste mês (30/11 com início 30/11 inclui o dia)', () => {
    expect(dts({ startDate: '2026-11-20', payDay: 25 }).slice(0, 2)).toEqual(['2026-11-25', '2026-12-25']);
    expect(dts({ startDate: '2026-11-30', payDay: 30 }).slice(0, 2)).toEqual(['2026-11-30', '2026-12-30']);
    expect(dts({ startDate: '2026-12-01', payDay: 30 })[0]).toBe('2026-12-30');
  });
  it('NUNCA uma data antes da data inicial (nem antes da data-base)', () => {
    const all = dts({ startDate: '2026-11-20', payDay: 1 }, '2026-11-11', '2028-01-01');
    expect(all.every((d) => d >= '2026-11-20')).toBe(true);
    expect(dts({ startDate: '2026-09-01', payDay: 5 })[0]).toBe('2026-12-05'); // 05/10 e 05/11 já estão no saldo informado
  });
  it('dia de pagamento ANTES da data inicial no mês de início, com data-base bem antes: esse pagamento não existe', () => {
    // início 20/12, pagamento dia 5: 05/12 é depois da data-base (11/11) mas ANTES da data inicial → o 1º pagamento é 05/01
    expect(dts({ startDate: '2026-12-20', payDay: 5 }).slice(0, 2)).toEqual(['2027-01-05', '2027-02-05']);
  });
  it('pagamento exatamente na data-base não entra (já está no saldo informado); no dia seguinte entra', () => {
    expect(dts({ startDate: '2026-11-01', payDay: 11 })[0]).toBe('2026-12-11');
    expect(dts({ startDate: '2026-11-01', payDay: 12 })[0]).toBe('2026-11-12');
  });
  it('âncora do dia: payDay 31 → 31/jan, 28/fev, 31/mar, 30/abr; bissexto 29/fev', () => {
    expect(dts({ startDate: '2027-01-15', payDay: 31 }, '2026-11-11', '2027-05-01')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
    expect(dts({ startDate: '2028-01-15', payDay: 31 }, '2026-11-11', '2028-03-31').slice(0, 3)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });
  it('data final inclusiva e opcional; sem data final vai até o fim do horizonte (inclusive)', () => {
    expect(dts({ startDate: '2026-11-12', payDay: 12, endDate: '2027-01-12' })).toEqual(['2026-11-12', '2026-12-12', '2027-01-12']);
    expect(dts({ startDate: '2026-11-12', payDay: 12, endDate: '2027-01-11' })).toEqual(['2026-11-12', '2026-12-12']);
    expect(dts({ startDate: '2026-11-12', payDay: 12 }, '2026-11-11', '2027-01-12')).toEqual(['2026-11-12', '2026-12-12', '2027-01-12']);
    expect(dts({ startDate: '2026-11-12', payDay: 12 }, '2026-11-11', '2027-01-11')).toEqual(['2026-11-12', '2026-12-12']);
  });
  it('data final antes do primeiro pagamento: nenhum pagamento', () => {
    expect(dts({ startDate: '2026-11-20', payDay: 5, endDate: '2026-12-04' })).toEqual([]);
  });
});

describe('simulate — contratação (hipótese) no motor', () => {
  it('cria uma saída por mês só depois da data inicial; saldo à mão: 3.300 − 3.700 = −400 em 05/12 e −4.100 em 05/01', () => {
    const s = snap(120);
    const before = JSON.stringify(s);
    const r = simulate(s, [hire()]);
    expect(dates(r)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05', '2027-03-05']);
    expect(r.createdEntries.every((e) => e.direction === 'out' && e.amountCents === '370000')).toBe(true);
    expect(closing(r.alternativeProjection, '2026-12-04')).toBe(330_000n); // nada antes da data inicial/1º pagamento
    expect(closing(r.alternativeProjection, '2026-12-05')).toBe(-40_000n);
    expect(closing(r.alternativeProjection, '2027-01-05')).toBe(-410_000n);
    expect(closing(r.baseProjection, '2027-01-05')).toBe(330_000n);
    expect(r.alternativeProjection.points.filter((p) => p.date < '2026-12-05').every((p, i) => p.closingCents === (r.baseProjection.points[i] as { closingCents: bigint }).closingCents)).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('o texto explicita custo mensal, encargos, fixos, total, dia e data inicial, e a premissa trabalhista fixa', () => {
    const r = simulate(snap(), [hire()]);
    const text = r.assumptions.join(' ');
    expect(text).toContain('Hipótese');
    expect(text).toContain('"Auxiliar de cozinha"');
    expect(text).toContain('20/11/2026');
    expect(text).toContain('todo dia 5');
    expect(text).toContain('R$ 2.000,00');
    expect(text).toContain('encargos informados de 70% (R$ 1.400,00)');
    expect(text).toContain('R$ 300,00');
    expect(text).toContain('R$ 3.700,00 por mês');
    expect(text).toContain(HIRING_PREMISE);
    expect(HIRING_PREMISE).toMatch(/13º.*férias.*FGTS.*rescisão/);
    expect(HIRING_PREMISE).toMatch(/não calcula/i);
    expect(text).toMatch(/Nada é contratado/);
  });

  it('a premissa trabalhista aparece SEMPRE, mesmo com encargos e fixos informados', () => {
    expect(simulate(snap(), [hire({ chargesBps: 0, fixedMonthlyCents: '0' })]).assumptions.join(' ')).toContain(HIRING_PREMISE);
  });

  it('hipótese incompleta: sinaliza o que faltou (encargos, fixos ou ambos); 0 informado conta como informado', () => {
    const warns = (o: Partial<HiringAdjustment>) => simulate(snap(), [hire(o)]).warnings.filter((w) => w.includes('incompleta'));
    expect(warns({ chargesBps: undefined, fixedMonthlyCents: undefined })).toHaveLength(1);
    expect(warns({ chargesBps: undefined, fixedMonthlyCents: undefined })[0]).toMatch(/encargos.*outros custos mensais fixos/);
    expect(warns({ chargesBps: undefined })[0]).toMatch(/encargos/);
    expect(warns({ chargesBps: undefined })[0]).not.toMatch(/fixos/);
    expect(warns({ fixedMonthlyCents: undefined })[0]).toMatch(/fixos/);
    expect(warns({ fixedMonthlyCents: undefined })[0]).not.toMatch(/encargos/);
    expect(warns({ chargesBps: 0, fixedMonthlyCents: '0' })).toEqual([]);
    expect(warns({})).toEqual([]);
  });

  it('data inicial até a data-base: pagamentos até a data-base não entram (já estão no saldo) e isso é dito', () => {
    const r = simulate(snap(), [hire({ startDate: '2026-10-01', payDay: 5 })]);
    expect(dates(r)[0]).toBe('2026-12-05');
    expect(r.warnings.join(' ')).toMatch(/data inicial.*até a data-base/);
  });

  it('data inicial IGUAL à data-base também é avisada (o pagamento do dia já estaria no saldo)', () => {
    const r = simulate(snap(), [hire({ startDate: '2026-11-11', payDay: 20 })]);
    expect(r.warnings.join(' ')).toMatch(/data inicial \(11\/11\/2026\).*até a data-base/);
    expect(simulate(snap(), [hire({ startDate: '2026-11-12', payDay: 20 })]).warnings.join(' ')).not.toMatch(/data inicial.*até a data-base/);
  });

  it('primeiro pagamento só depois do horizonte: nada entra no saldo e a data é dita', () => {
    const r = simulate(snap(30), [hire({ startDate: '2027-02-01', payDay: 5 })]);
    expect(r.createdEntries).toEqual([]);
    expect(r.effects[0]?.status).toBe('ignored');
    expect(r.warnings.join(' ')).toMatch(/primeiro pagamento.*05\/02\/2027.*depois do horizonte/);
    expect(r.alternativeProjection.points.map((p) => p.closingCents)).toEqual(r.baseProjection.points.map((p) => p.closingCents));
  });

  it('data final antes do primeiro pagamento: ignorada com aviso', () => {
    const r = simulate(snap(), [hire({ startDate: '2026-11-20', payDay: 5, endDate: '2026-12-04' })]);
    expect(r.createdEntries).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/nenhum pagamento/i);
  });

  it('com data final: quantidade de pagamentos e total ditos', () => {
    const r = simulate(snap(), [hire({ endDate: '2027-01-31' })]);
    expect(dates(r)).toEqual(['2026-12-05', '2027-01-05']);
    expect(r.assumptions.join(' ')).toMatch(/2 pagamento\(s\).*R\$ 7\.400,00/);
    expect(r.assumptions.join(' ')).toContain('até 31/01/2027');
  });

  it('entradas inválidas viram ScenarioError', () => {
    const bad = (o: Partial<HiringAdjustment>) => () => simulate(snap(), [hire(o)]);
    expect(bad({ role: ' ' })).toThrow(/função|cargo/i);
    expect(bad({ monthlyCostCents: '0' })).toThrow(ScenarioError);
    expect(bad({ monthlyCostCents: 'x' })).toThrow(ScenarioError);
    expect(bad({ chargesBps: -1 })).toThrow(/encargos/i);
    expect(bad({ chargesBps: MAX_CHARGES_BPS + 1 })).toThrow(/encargos/i);
    expect(bad({ chargesBps: 10.5 })).toThrow(/encargos/i);
    expect(bad({ fixedMonthlyCents: '-1' })).toThrow(/fixos/i);
    expect(bad({ fixedMonthlyCents: 'x' })).toThrow(/fixos/i);
    expect(bad({ payDay: 0 })).toThrow(/dia/i);
    expect(bad({ payDay: 32 })).toThrow(/dia/i);
    expect(bad({ payDay: 5.5 })).toThrow(/dia/i);
    expect(bad({ startDate: '2026-02-30' })).toThrow(/inicial/i);
    expect(bad({ endDate: '2026-13-01' })).toThrow(/final/i);
    expect(bad({ endDate: '2026-11-19' })).toThrow(/final/i);
  });

  it('coexiste com atraso (S05) e é determinístico (ids scn:h1:n)', () => {
    const adj = [{ id: 'd1', kind: 'delay_receipt' as const, entryId: 'demo-receita-02', days: 2 }, hire({ startDate: '2026-11-12', payDay: 16, endDate: '2026-12-16' })];
    const a = simulate(snap(), adj);
    const b = simulate(snap(), adj);
    expect(JSON.stringify(a, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x))).toBe(JSON.stringify(b, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x)));
    expect(a.createdEntries.map((e) => e.id)).toEqual(['scn:h1:1', 'scn:h1:2']);
    expect(a.effects.map((e) => e.status)).toEqual(['applied', 'applied']);
    // à mão: 15/11 −700 (o 4.000 foi para 17/11); 16/11 −700−3.700 = −4.400; 17/11 −400
    expect(closing(a.alternativeProjection, '2026-11-16')).toBe(-440_000n);
    expect(closing(a.alternativeProjection, '2026-11-17')).toBe(-40_000n);
  });

  it('os lançamentos criados são rotulados como hipótese e não afirmam contratação', () => {
    const r = simulate(snap(), [hire()]);
    expect(r.createdEntries[0]?.description).toBe('Contratação (hipótese): Auxiliar de cozinha — custo mensal');
    expect(r.createdEntries[0]?.category).toBe('Pessoal (hipótese)');
    expect(r.assumptions.join(' ')).not.toMatch(/\b(contrate|confirme|efetue)\b/i);
  });
});
