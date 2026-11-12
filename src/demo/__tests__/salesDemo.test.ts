import { describe, expect, it } from 'vitest';
import { project } from '../../domain/finance/projection';
import { baselineForecast } from '../../domain/forecast/baseline';
import { totalGrossCents } from '../../domain/sales/importSales';
import { reconcile } from '../../domain/sales/reconcile';
import { DEFAULT_SETTLEMENT_RULES } from '../../domain/sales/settlement';
import { createRestaurantDemo } from '../restaurant';
import { createSalesDemo, SALES_DEMO_FIRST_DAY, SALES_DEMO_LAST_DAY } from '../salesDemo';

/**
 * Contas à mão. Valores por dia da semana (R$): Pix seg 120, ter 100, qua 110, qui 130, sex 200, sáb 300, dom 250 = 1.210/sem;
 * débito 80, 70, 75, 90, 150, 220, 180 = 865/sem; crédito 150, 130, 140, 160, 260, 400, 330 = 1.570/sem. Semana = R$ 3.645.
 * 15/10/2026 (quinta) a 11/11/2026 (quarta) = 28 dias = 4 semanas completas → R$ 14.580,00 = 1.458.000 centavos.
 */
describe('vendas fictícias da demonstração', () => {
  const demo = createSalesDemo();

  it('28 dias × 3 meios = 84 vendas; faturamento bruto R$ 14.580,00', () => {
    expect([SALES_DEMO_FIRST_DAY, SALES_DEMO_LAST_DAY]).toEqual(['2026-10-15', '2026-11-11']);
    expect(demo.sales).toHaveLength(84);
    expect(totalGrossCents(demo.sales)).toBe(1_458_000n);
    expect(new Set(demo.sales.map((s) => s.saleKey)).size).toBe(84);
  });

  it('cada chamada devolve objetos novos e iguais (determinística, sem estado compartilhado)', () => {
    const again = createSalesDemo();
    expect(again).toEqual(demo);
    expect(again.sales[0]).not.toBe(demo.sales[0]);
  });

  it('o CSV gerado reimporta as mesmas vendas (o demo passa pelo mesmo caminho do usuário)', () => {
    expect(demo.csv.split('\n')[0]).toBe('identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria');
    expect(demo.csv.split('\n')).toHaveLength(85);
  });

  it('baseline: média diária R$ 14.580,00 / 28 = R$ 520,71; tendência estável; sem aviso de série curta', () => {
    const r = baselineForecast(demo.sales, { asOf: '2026-11-11' });
    expect(r.stats?.meanCents).toBe(52071n); // 1.458.000 / 28 = 52.071,43
    expect(r.stats?.trend).toMatchObject({ recentMeanCents: 52071n, previousMeanCents: 52071n, changeBps: 0, direction: 'flat' });
    expect(r.warnings).toEqual([]);
  });

  it('repasses (sem outras contas): só os 28 créditos (D+30) e o débito de quarta entram; Pix e demais débitos já estão no saldo', () => {
    // fee crédito (3,99%, meio centavo sobe): 599+519+559+638+1037+1596+1317 = 6.265 por semana → líquido 157.000 − 6.265 = 150.735; ×4 = 602.940
    // débito de 11/11 (quarta, R$ 75,00, 1,99%): 149,25 → 149; líquido 7.351; vence 12/11
    const r = reconcile({ baseDate: '2026-11-11', sales: demo.sales, rules: DEFAULT_SETTLEMENT_RULES, entries: [], decisions: [] });
    const counted = r.receivables.filter((x) => x.counts);
    expect(counted).toHaveLength(29);
    expect(counted.reduce((acc, x) => acc + x.receivable.netCents, 0n)).toBe(602_940n + 7_351n);
    expect(r.summary.before_base_date).toBe(84 - 29);
    // crédito de 11/11 (quarta, R$ 140,00): taxa 559, líquido 13.441, repasse 12/11 (+30 dias)
    const last = r.receivables.find((x) => x.receivable.externalId === 'D-20261111-credito')!;
    expect([last.receivable.netCents, last.receivable.dueDate]).toEqual([13441n, '2026-12-11']);
  });

  it('com a demo da S01: as 2 contas sem referência (13/11 e 15/11) deixam 6 repasses próximos PENDENTES e fora do saldo', () => {
    // pendentes: débito de 11/11 (vence 12/11) + créditos de 15 a 19/10 (vencem 14 a 18/11) = 6; contam os outros 23 créditos
    const base = createRestaurantDemo();
    const r = reconcile({ baseDate: base.settings.baseDate, sales: demo.sales, rules: DEFAULT_SETTLEMENT_RULES, entries: base.entries, decisions: [] });
    expect(r.summary.pending).toBe(6);
    const counted = r.receivables.filter((x) => x.counts);
    expect(counted).toHaveLength(23);
    // créditos 15–19/10 (qui 15.362, sex 24.963, sáb 38.404, dom 31.683, seg 14.401 = 124.813) saem do total de 602.940
    expect(counted.reduce((acc, x) => acc + x.receivable.netCents, 0n)).toBe(602_940n - 124_813n);
    // com os dois recebimentos importados e as vendas, a projeção da S01 NÃO muda enquanto houver pendência (só o importado entra)
    const sem = project(base.settings, base.entries);
    const com = project(base.settings, r.projectionEntries);
    expect(com.points.slice(0, 5).map((p) => p.closingCents)).toEqual(sem.points.slice(0, 5).map((p) => p.closingCents));
  });

  it('decidindo "conta independente de vendas" nas duas contas, os repasses voltam ao saldo: 12/11 = 500 + 73,51', () => {
    const base = createRestaurantDemo();
    const decisions = base.entries.filter((e) => e.direction === 'in').map((e) => ({ kind: 'standalone' as const, entryId: e.id }));
    const r = reconcile({ baseDate: base.settings.baseDate, sales: demo.sales, rules: DEFAULT_SETTLEMENT_RULES, entries: base.entries, decisions });
    expect(r.summary.pending).toBe(0);
    const sem = project(base.settings, base.entries);
    const com = project(base.settings, r.projectionEntries);
    expect(sem.points[0]?.closingCents).toBe(50_000n);
    expect(com.points[0]?.closingCents).toBe(50_000n + 7_351n);
    // 14/11: + débito de 12/11 (7.351) + crédito de 15/10 (quinta, R$ 160,00; taxa 638; líquido 15.362; vence 15/10 + 30 = 14/11)
    expect(com.points[2]?.closingCents).toBe(sem.points[2]!.closingCents + 7_351n + 15_362n);
  });
});
