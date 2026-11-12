import { describe, expect, it } from 'vitest';
import { project } from '../../finance/projection';
import { DEFAULT_SETTLEMENT_RULES, deriveReceivables, netOf, receivableToEntry, validateRules } from '../settlement';
import { previewSalesCsv } from '../importSales';
import type { SettlementRule, SettlementRules } from '../types';

const H = 'identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria';
const salesOf = (rows: string[]) => previewSalesCsv([H, ...rows].join('\n')).valid.map((v) => v.sale);
const rule = (r: Partial<SettlementRule>): SettlementRule => ({ method: 'pix', feeBps: 0, commissionBps: 0, lagDays: 0, ...r });

describe('netOf — líquido calculado à mão, arredondamento meio-sobe por venda', () => {
  it('Pix R$ 100,00 a 0,99%: taxa 99 centavos, líquido 9.901', () => {
    expect(netOf(10000n, rule({ feeBps: 99 }))).toEqual({ feeCents: 99n, netCents: 9901n });
  });
  it('débito R$ 250,50 a 1,99%: 498,495 → 498 centavos; líquido 24.552', () => {
    expect(netOf(25050n, rule({ feeBps: 199 }))).toEqual({ feeCents: 498n, netCents: 24552n });
  });
  it('crédito R$ 1.234,56 com taxa 3,5% + comissão 1%: 5.555,52 → 5.556; líquido 117.900', () => {
    expect(netOf(123456n, rule({ feeBps: 350, commissionBps: 100 }))).toEqual({ feeCents: 5556n, netCents: 117900n });
  });
  it('meio centavo sobe: 50 centavos a 1% = 0,5 → 1', () => {
    expect(netOf(50n, rule({ feeBps: 100 }))).toEqual({ feeCents: 1n, netCents: 49n });
  });
  it('sem taxa: líquido = bruto; taxa total de 100%: líquido zero', () => {
    expect(netOf(777n, rule({}))).toEqual({ feeCents: 0n, netCents: 777n });
    expect(netOf(777n, rule({ feeBps: 9000, commissionBps: 1000 }))).toEqual({ feeCents: 777n, netCents: 0n });
  });
  it('não perde precisão acima de 2^53', () => {
    expect(netOf(9007199254740993n, rule({ feeBps: 100 })).netCents).toBe(9007199254740993n - 90071992547410n);
  });
});

describe('deriveReceivables — data = venda + prazo; um recebível por venda', () => {
  const rules: SettlementRules = {
    ...DEFAULT_SETTLEMENT_RULES,
    pix: rule({ method: 'pix', feeBps: 99, lagDays: 0 }),
    debit: rule({ method: 'debit', feeBps: 199, lagDays: 1 }),
    credit: rule({ method: 'credit', feeBps: 350, commissionBps: 100, lagDays: 30 }),
    voucher: rule({ method: 'voucher', feeBps: 300, lagDays: 30 }),
  };
  const sales = salesOf([
    'V-1;02/11/2026;100,00;pix;',
    'V-2;02/11/2026;250,50;débito;',
    'V-3;03/11/2026;1.234,56;crédito;',
    'V-4;04/11/2026;45,90;voucher;',
    'V-5;31/01/2026;100,00;crédito;',
  ]);
  const r = deriveReceivables(sales, rules);
  const by = (k: string) => r.find((x) => x.externalId === k)!;

  it('valores líquidos e datas conferem com a conta manual', () => {
    expect([by('V-1').netCents, by('V-1').dueDate]).toEqual([9901n, '2026-11-02']);
    expect([by('V-2').netCents, by('V-2').dueDate]).toEqual([24552n, '2026-11-03']);
    expect([by('V-3').netCents, by('V-3').dueDate]).toEqual([117900n, '2026-12-03']);
    expect([by('V-4').netCents, by('V-4').feeCents, by('V-4').dueDate]).toEqual([4452n, 138n, '2026-12-04']);
    expect(by('V-5').dueDate).toBe('2026-03-02'); // 31/01 + 30 dias, fevereiro de 28 dias
  });
  it('um por venda, id estável, ordenado por data e id', () => {
    expect(r).toHaveLength(5);
    expect(new Set(r.map((x) => x.id)).size).toBe(5);
    expect(by('V-1').id).toBe(`rcv_${sales[0]!.id.slice(5)}`);
    expect(r.map((x) => x.dueDate)).toEqual([...r.map((x) => x.dueDate)].sort());
  });
  it('mudar taxa e prazo muda valor e data (não só rótulo)', () => {
    const changed = deriveReceivables(sales, { ...rules, credit: rule({ method: 'credit', feeBps: 200, lagDays: 14 }) });
    const v3 = changed.find((x) => x.externalId === 'V-3')!;
    expect([v3.netCents, v3.dueDate]).toEqual([120987n, '2026-11-17']); // 123456 − 2469,12→2469 = 120987
  });
});

describe('validateRules e padrões', () => {
  it('padrões são válidos para os cinco meios', () => {
    expect(validateRules(DEFAULT_SETTLEMENT_RULES)).toBeNull();
    expect(Object.keys(DEFAULT_SETTLEMENT_RULES).sort()).toEqual(['cash', 'credit', 'debit', 'pix', 'voucher']);
  });
  it.each([
    [{ feeBps: -1 }, /taxa/i],
    [{ feeBps: 1.5 }, /taxa/i],
    [{ commissionBps: 10001 }, /comiss/i],
    [{ feeBps: 6000, commissionBps: 5000 }, /100%/],
    [{ lagDays: -1 }, /prazo/i],
    [{ lagDays: 366 }, /prazo/i],
    [{ lagDays: 0.5 }, /prazo/i],
  ])('recusa %j', (patch, msg) => {
    const bad = { ...DEFAULT_SETTLEMENT_RULES, pix: { ...DEFAULT_SETTLEMENT_RULES.pix, ...patch } };
    expect(validateRules(bad)).toMatch(msg);
  });
});

describe('receivableToEntry — chega ao motor como lançamento comum', () => {
  it('entrada de recebimento líquido, origem sale, chave de origem própria', () => {
    const sale = salesOf(['V-1;12/11/2026;100,00;pix;'])[0]!;
    const [rcv] = deriveReceivables([sale], { ...DEFAULT_SETTLEMENT_RULES, pix: rule({ method: 'pix', feeBps: 99 }) });
    const e = receivableToEntry(rcv!);
    expect(e).toMatchObject({
      id: rcv!.id, direction: 'in', amountCents: '9901', dueDate: '2026-11-12', origin: 'sale',
      sourceKey: `sale-settlement:${sale.id}`, state: 'scheduled', linkedSaleId: sale.id,
    });
    expect(e.description).toContain('V-1');
  });
  it('venda ≠ recebimento: o caixa só sobe na data de repasse, pelo líquido', () => {
    const sale = salesOf(['V-1;12/11/2026;1.000,00;crédito;'])[0]!;
    const rules = { ...DEFAULT_SETTLEMENT_RULES, credit: rule({ method: 'credit', feeBps: 400, lagDays: 15 }) };
    const entries = deriveReceivables([sale], rules).map(receivableToEntry);
    const settings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };
    const p = project(settings, entries);
    const at = (d: string) => p.points.find((x) => x.date === d)!.closingCents;
    expect(at('2026-11-12')).toBe(300000n); // dia da venda: nada entra
    expect(at('2026-11-26')).toBe(300000n);
    expect(at('2026-11-27')).toBe(396000n); // 100000 − 4000 de taxa = 96000 líquido
    expect(p.summary.totalIncomingCents).toBe(96000n);
  });
});
