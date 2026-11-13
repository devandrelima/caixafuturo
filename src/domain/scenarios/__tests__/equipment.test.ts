import { describe, expect, it } from 'vitest';
import type { CashEntry, CashSettings } from '../../finance/types';
import { createBaseSnapshot, simulate } from '../engine';
import { buildPaymentPlan, MAX_INSTALLMENTS, MAX_MONTHLY_RATE_BPS, priceInstallment } from '../equipment';
import { ScenarioError } from '../types';
import type { BaseSnapshot, EquipmentPayment, EquipmentPurchaseAdjustment } from '../types';

const settings: CashSettings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };
const entry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string): CashEntry => ({ id, direction, amountCents, dueDate, description: `L ${id}`, category: '', origin: 'manual', sourceKey: `manual:${id}`, state: 'scheduled' });
// Demo S01 (à mão): 12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 · 15/11 R$ 3.300.
const demo = (): CashEntry[] => [entry('demo-despesa-01', 'out', '250000', '2026-11-12'), entry('demo-receita-01', 'in', '80000', '2026-11-13'), entry('demo-despesa-02', 'out', '200000', '2026-11-14'), entry('demo-receita-02', 'in', '400000', '2026-11-15')];
const snap = (horizonDays = 30): BaseSnapshot => createBaseSnapshot({ settings, entries: demo(), horizonDays });
const buy = (principalCents: string, payment: EquipmentPayment, extra: Partial<EquipmentPurchaseAdjustment> = {}): EquipmentPurchaseAdjustment => ({ id: 'c1', kind: 'equipment_purchase', description: 'Forno combinado', principalCents, payment, ...extra });
const amounts = (p: { installments: { amountCents: bigint }[] }) => p.installments.map((i) => i.amountCents);
const closing = (r: { points: { date: string; closingCents: bigint }[] }, date: string) => r.points.find((p) => p.date === date)?.closingCents;

describe('priceInstallment — parcela igual (tabela Price) em inteiros, meio-sobe', () => {
  it('R$ 10.000,00 em 3× a 2,00% a.m. = R$ 3.467,55 (valor conferido com frações exatas)', () => {
    expect(priceInstallment(1_000_000n, 3, 200)).toBe(346_755n);
  });
  it('taxa 0 divide o principal meio-sobe: R$ 1,00 em 3× → R$ 0,33', () => {
    expect(priceInstallment(100n, 3, 0)).toBe(33n);
    expect(priceInstallment(100_000n, 2, 0)).toBe(50_000n);
  });
});

describe('buildPaymentPlan — principal + encargos fecham EXATAMENTE (à mão)', () => {
  it('R$ 10.000,00 em 3× a 2,00% a.m.: 3.467,55 + 3.467,55 + 3.467,54 = 10.402,64 (encargos R$ 402,64)', () => {
    const plan = buildPaymentPlan(1_000_000n, { mode: 'installments', firstDate: '2026-11-20', count: 3, monthlyRateBps: 200 });
    expect(amounts(plan)).toEqual([346_755n, 346_755n, 346_754n]);
    expect(plan.chargesCents).toBe(40_264n);
    expect(plan.totalCents).toBe(1_040_264n);
    // juros mês a mês sobre o saldo devedor: 200,00 · 134,65 · 67,99 (soma 402,64) e saldo final zero
    expect(plan.installments.map((i) => i.interestCents)).toEqual([20_000n, 13_465n, 6_799n]);
    expect(plan.installments.map((i) => i.balanceCents)).toEqual([673_245n, 339_955n, 0n]);
    expect(plan.installments.map((i) => i.dueDate)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
  });

  it('R$ 1,00 em 3× sem juros: a última parcela absorve o resíduo (0,33 + 0,33 + 0,34)', () => {
    const plan = buildPaymentPlan(100n, { mode: 'installments', firstDate: '2026-11-20', count: 3, monthlyRateBps: 0 });
    expect(amounts(plan)).toEqual([33n, 33n, 34n]);
    expect(plan.chargesCents).toBe(0n);
    expect(plan.totalCents).toBe(100n);
  });

  it('R$ 5.000,00 em 6× a 1,50%: seis parcelas, a última R$ 877,61 (resíduo) e encargos R$ 265,76', () => {
    const plan = buildPaymentPlan(500_000n, { mode: 'installments', firstDate: '2026-11-20', count: 6, monthlyRateBps: 150 });
    expect(amounts(plan)).toEqual([87_763n, 87_763n, 87_763n, 87_763n, 87_763n, 87_761n]);
    expect(plan.chargesCents).toBe(26_576n);
  });

  it('R$ 10.000,00 em 12× a 2,50%: 11 parcelas de R$ 974,87 e a última R$ 974,90', () => {
    const plan = buildPaymentPlan(1_000_000n, { mode: 'installments', firstDate: '2026-11-20', count: 12, monthlyRateBps: 250 });
    expect(amounts(plan).slice(0, 11).every((a) => a === 97_487n)).toBe(true);
    expect(plan.installments[11]?.amountCents).toBe(97_490n);
    expect(plan.chargesCents).toBe(169_847n);
  });

  it('à vista: uma saída do principal na data, sem encargos', () => {
    const plan = buildPaymentPlan(500_000n, { mode: 'cash', date: '2026-11-25' });
    expect(plan.installments).toHaveLength(1);
    expect(plan.installments[0]).toMatchObject({ number: 1, dueDate: '2026-11-25', amountCents: 500_000n, interestCents: 0n });
    expect(plan.chargesCents).toBe(0n);
    expect(plan.totalCents).toBe(500_000n);
  });

  it('adiada: uma saída na data posterior com encargo único em bps sobre o principal (meio-sobe)', () => {
    const plan = buildPaymentPlan(100_000n, { mode: 'deferred', date: '2027-01-10', chargeBps: 150 });
    expect(amounts(plan)).toEqual([101_500n]);
    expect(plan.chargesCents).toBe(1_500n);
    expect(buildPaymentPlan(333n, { mode: 'deferred', date: '2027-01-10', chargeBps: 150 }).chargesCents).toBe(5n); // 4,995 → 5 (meio-sobe)
    expect(buildPaymentPlan(100_000n, { mode: 'deferred', date: '2027-01-10', chargeBps: 0 }).totalCents).toBe(100_000n);
  });

  it('âncora do dia, virada de ano e bissexto nas datas das parcelas', () => {
    const dates = (first: string, count: number) => buildPaymentPlan(1_000_000n, { mode: 'installments', firstDate: first, count, monthlyRateBps: 100 }).installments.map((i) => i.dueDate);
    expect(dates('2026-01-31', 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(dates('2028-01-31', 2)).toEqual(['2028-01-31', '2028-02-29']);
    expect(dates('2026-11-30', 4)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
  });

  it('PROPRIEDADE (500 casos determinísticos): Σ parcelas = principal + encargos; parcelas ≥ R$ 0,01; saldo final zero; datas crescentes', () => {
    let seed = 20_261_113;
    const next = (max: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % max;
    };
    for (let i = 0; i < 500; i += 1) {
      const count = 2 + next(MAX_INSTALLMENTS - 1);
      const principal = BigInt(count * 100 + next(5_000_000));
      const rate = next(MAX_MONTHLY_RATE_BPS + 1);
      const plan = buildPaymentPlan(principal, { mode: 'installments', firstDate: '2026-11-30', count, monthlyRateBps: rate });
      const sum = plan.installments.reduce((acc, p) => acc + p.amountCents, 0n);
      expect(sum).toBe(principal + plan.chargesCents);
      expect(plan.totalCents).toBe(sum);
      expect(plan.chargesCents >= 0n).toBe(true);
      expect(plan.installments.every((p) => p.amountCents >= 1n)).toBe(true);
      expect(plan.installments.at(-1)?.balanceCents).toBe(0n);
      expect(plan.installments.map((p) => p.dueDate)).toEqual([...plan.installments.map((p) => p.dueDate)].sort());
      // principal amortizado + juros de cada parcela = a parcela; a soma do principal amortizado = principal
      expect(plan.installments.reduce((acc, p) => acc + p.principalCents, 0n)).toBe(principal);
      expect(plan.installments.every((p) => p.principalCents + p.interestCents === p.amountCents)).toBe(true);
      if (rate === 0) expect(plan.chargesCents).toBe(0n);
    }
  });

  it('valores sem sentido são recusados com mensagem clara', () => {
    const inst = (count: number, monthlyRateBps: number, firstDate = '2026-11-20'): EquipmentPayment => ({ mode: 'installments', firstDate, count, monthlyRateBps });
    expect(() => buildPaymentPlan(0n, { mode: 'cash', date: '2026-11-20' })).toThrow(ScenarioError);
    expect(() => buildPaymentPlan(-1n, { mode: 'cash', date: '2026-11-20' })).toThrow(ScenarioError);
    expect(() => buildPaymentPlan(1000n, { mode: 'cash', date: '2026-02-30' })).toThrow(ScenarioError);
    expect(() => buildPaymentPlan(1000n, inst(1, 100))).toThrow(/2 a 60 parcelas/);
    expect(() => buildPaymentPlan(1000n, inst(MAX_INSTALLMENTS + 1, 100))).toThrow(/2 a 60 parcelas/);
    expect(() => buildPaymentPlan(1000n, inst(2.5, 100))).toThrow(ScenarioError);
    expect(() => buildPaymentPlan(1000n, inst(3, -1))).toThrow(/bps/);
    expect(() => buildPaymentPlan(1000n, inst(3, MAX_MONTHLY_RATE_BPS + 1))).toThrow(/bps/);
    expect(() => buildPaymentPlan(1000n, inst(3, 1.5))).toThrow(/bps/);
    expect(() => buildPaymentPlan(1000n, inst(3, 100, 'x'))).toThrow(ScenarioError);
    expect(() => buildPaymentPlan(1000n, { mode: 'deferred', date: '2026-12-01', chargeBps: 10_001 })).toThrow(ScenarioError);
    expect(() => buildPaymentPlan(1000n, { mode: 'deferred', date: '2026-12-01', chargeBps: -1 })).toThrow(ScenarioError);
    expect(() => buildPaymentPlan(1000n, { mode: 'outro' } as unknown as EquipmentPayment)).toThrow(ScenarioError);
  });

  it('valor pequeno demais para o número de parcelas (parcela abaixo de R$ 0,01) é recusado', () => {
    expect(() => buildPaymentPlan(1n, { mode: 'installments', firstDate: '2026-11-20', count: 60, monthlyRateBps: 2000 })).toThrow(/pequeno demais/);
    expect(() => buildPaymentPlan(10n, { mode: 'installments', firstDate: '2026-11-20', count: 60, monthlyRateBps: 0 })).toThrow(/pequeno demais/);
  });
});

describe('simulate — compra de equipamento (hipótese) no motor', () => {
  it('parcelada em 3×: cria as 3 saídas hipotéticas, soma = principal + encargos, base intacta (calculado à mão)', () => {
    const s = snap(120);
    const before = JSON.stringify(s);
    const r = simulate(s, [buy('1000000', { mode: 'installments', firstDate: '2026-11-16', count: 3, monthlyRateBps: 200 })]);
    // base fecha em R$ 3.300,00 após 15/11. Alternativa: 16/11 −3.467,55 = −167,55 · 16/12 −3.467,55 = −3.635,10 · 16/01 −3.467,54 = −7.102,64
    expect(closing(r.alternativeProjection, '2026-11-15')).toBe(330_000n);
    expect(closing(r.alternativeProjection, '2026-11-16')).toBe(-16_755n);
    expect(closing(r.alternativeProjection, '2026-12-16')).toBe(-363_510n);
    expect(closing(r.alternativeProjection, '2027-01-16')).toBe(-710_264n);
    expect(closing(r.baseProjection, '2027-01-16')).toBe(330_000n);
    expect(r.createdEntries.map((e) => [e.id, e.dueDate, e.direction, e.amountCents])).toEqual([
      ['scn:c1:1', '2026-11-16', 'out', '346755'],
      ['scn:c1:2', '2026-12-16', 'out', '346755'],
      ['scn:c1:3', '2027-01-16', 'out', '346754'],
    ]);
    expect(r.createdEntries.reduce((acc, e) => acc + BigInt(e.amountCents), 0n)).toBe(1_040_264n);
    expect(r.effects[0]).toMatchObject({ status: 'applied', createdEntryIds: ['scn:c1:1', 'scn:c1:2', 'scn:c1:3'], changedEntryIds: [] });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('à vista e adiada: a mesma compra muda a data do desembolso; total em texto (principal, encargos, total)', () => {
    const cash = simulate(snap(), [buy('500000', { mode: 'cash', date: '2026-11-20' })]);
    expect(closing(cash.alternativeProjection, '2026-11-20')).toBe(-170_000n); // 3.300 − 5.000
    const deferred = simulate(snap(), [buy('500000', { mode: 'deferred', date: '2026-12-05', chargeBps: 200 })]);
    expect(closing(deferred.alternativeProjection, '2026-11-20')).toBe(330_000n);
    expect(closing(deferred.alternativeProjection, '2026-12-05')).toBe(-180_000n); // 3.300 − 5.100 (encargo R$ 100,00)
    const text = deferred.assumptions.join(' ');
    expect(text).toContain('principal R$ 5.000,00');
    expect(text).toContain('encargos R$ 100,00');
    expect(text).toContain('total R$ 5.100,00');
  });

  it('o texto da hipótese explicita principal, encargos, total, método, datas e que nada foi pago', () => {
    const r = simulate(snap(120), [buy('1000000', { mode: 'installments', firstDate: '2026-11-16', count: 3, monthlyRateBps: 200 })]);
    const text = r.assumptions.join(' ');
    expect(text).toContain('Hipótese');
    expect(text).toContain('"Forno combinado"');
    expect(text).toContain('principal R$ 10.000,00');
    expect(text).toContain('encargos R$ 402,64');
    expect(text).toContain('total R$ 10.402,64');
    expect(text).toContain('3 parcelas');
    expect(text).toContain('2% ao mês');
    expect(text).toContain('16/11/2026');
    expect(text).toMatch(/Nenhum pagamento/);
    expect(r.assumptions.join(' ')).not.toMatch(/\b(pague|contrate|confirme)\b/i);
  });

  it('parcelas fora do horizonte: ditas, com quantidade e valor, e não entram no saldo projetado', () => {
    const r = simulate(snap(30), [buy('1000000', { mode: 'installments', firstDate: '2026-11-16', count: 3, monthlyRateBps: 200 })]);
    expect(r.createdEntries).toHaveLength(3);
    expect(closing(r.alternativeProjection, '2026-12-11')).toBe(-16_755n); // só a 1ª parcela cabe nos 30 dias
    const w = r.warnings.join(' ');
    expect(w).toMatch(/2 parcela\(s\).*R\$ 6\.935,09.*depois do horizonte/);
    expect(w).toContain('vence(m) depois do horizonte');
  });

  it('data de pagamento até a data-base: compra ignorada com aviso (já estaria no saldo informado)', () => {
    const r = simulate(snap(), [buy('500000', { mode: 'cash', date: '2026-11-11' })]);
    expect(r.effects[0]?.status).toBe('ignored');
    expect(r.createdEntries).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/11\/11\/2026.*data-base.*a compra foi ignorada/);
    expect(JSON.stringify(r.alternativeProjection.points.map((p) => p.closingCents.toString()))).toBe(JSON.stringify(r.baseProjection.points.map((p) => p.closingCents.toString())));
  });

  it('o último dia do horizonte ainda conta (30 dias a partir de 11/11 = 11/12); um dia depois fica de fora e é dito', () => {
    const on = simulate(snap(30), [buy('100000', { mode: 'cash', date: '2026-12-11' })]);
    expect(closing(on.alternativeProjection, '2026-12-11')).toBe(230_000n);
    expect(on.warnings.join(' ')).not.toContain('depois do horizonte');
    const off = simulate(snap(30), [buy('100000', { mode: 'cash', date: '2026-12-12' })]);
    expect(closing(off.alternativeProjection, '2026-12-11')).toBe(330_000n);
    expect(off.warnings.join(' ')).toContain('1 parcela(s) (R$ 1.000,00) vence(m) depois do horizonte');
  });

  it('primeira parcela depois da data-base mas as seguintes cabem: todas entram (nenhuma é "perdida")', () => {
    const r = simulate(snap(120), [buy('100000', { mode: 'installments', firstDate: '2026-11-12', count: 2, monthlyRateBps: 0 })]);
    expect(r.createdEntries.map((e) => e.dueDate)).toEqual(['2026-11-12', '2026-12-12']);
  });

  it('descrição vazia, valor inválido e plano inválido viram ScenarioError', () => {
    expect(() => simulate(snap(), [buy('500000', { mode: 'cash', date: '2026-11-20' }, { description: '  ' })])).toThrow(/descrição/i);
    expect(() => simulate(snap(), [buy('abc', { mode: 'cash', date: '2026-11-20' })])).toThrow(ScenarioError);
    expect(() => simulate(snap(), [buy('0', { mode: 'cash', date: '2026-11-20' })])).toThrow(ScenarioError);
  });

  it('é determinístico e puro: mesmo cenário, mesmo resultado; base congelada continua igual', () => {
    const s = snap(120);
    const adj = [buy('1000000', { mode: 'installments', firstDate: '2026-11-16', count: 3, monthlyRateBps: 200 })];
    const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
    expect(json(simulate(s, adj))).toBe(json(simulate(s, adj)));
    expect(Object.isFrozen(s.entries)).toBe(true);
  });

  it('compra e atraso (S05) coexistem na mesma alternativa, sem soma dupla', () => {
    const r = simulate(snap(), [{ id: 'd1', kind: 'delay_receipt', entryId: 'demo-receita-02', days: 2 }, buy('100000', { mode: 'cash', date: '2026-11-16' })]);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'applied']);
    // à mão: o R$ 4.000 de 15/11 vai para 17/11 (uma vez só): 15/11 fecha em −R$ 700,00; a compra de R$ 1.000 em 16/11 leva a −R$ 1.700,00
    expect(closing(r.alternativeProjection, '2026-11-15')).toBe(-70_000n);
    expect(closing(r.alternativeProjection, '2026-11-16')).toBe(-170_000n);
    expect(closing(r.alternativeProjection, '2026-11-17')).toBe(230_000n);
  });
});
