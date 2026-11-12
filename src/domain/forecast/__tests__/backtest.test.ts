import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../../finance/dates';
import type { Sale } from '../../sales/types';
import {
  BACKTEST_MIN_TRAIN_DAYS,
  BACKTEST_STEP_DAYS,
  MIN_COMPARABLE_FOLDS,
  runBacktest,
  toForecastPoints,
  type BacktestReport,
} from '../backtest';
import { MODEL_IDS, type ModelId } from '../models';

let seq = 0;
const sale = (saleDate: string, cents: number): Sale => {
  seq += 1;
  return {
    id: `sale_${seq}`,
    saleKey: `sale:B${seq}`,
    externalId: `B${seq}`,
    saleDate,
    grossCents: String(cents),
    method: 'pix',
    category: '',
  };
};

/** 2026-09-07 é segunda-feira; o índice 6, 13, 20, 27, … é sempre domingo. */
const MONDAY = '2026-09-07';
const PERIODIC = [5000, 5000, 5000, 5000, 10000, 20000, 20000]; // seg…dom, soma 70.000
const at = (i: number): string => addDays(MONDAY, i);
const weeks = (n: number): number[] => Array.from({ length: n }, () => PERIODIC).flat();
const fromValues = (values: readonly number[]): Sale[] => values.map((v, i) => sale(at(i), v));
const model = (r: BacktestReport, id: ModelId) => r.models.find((m) => m.id === id)!;

describe('constantes documentadas', () => {
  it('28 dias de treino mínimo, origens semanais, 4 dobras comparáveis', () => {
    expect([BACKTEST_MIN_TRAIN_DAYS, BACKTEST_STEP_DAYS, MIN_COMPARABLE_FOLDS]).toEqual([28, 7, 4]);
  });
});

describe('rolling-origin — 12 semanas (84 dias), horizonte 7', () => {
  const sales = fromValues(weeks(12));
  const asOf = at(83); // domingo
  const r = runBacktest(sales, { asOf, horizonDays: 7 });

  it('origens semanais a partir de 28 dias: índices 27, 34, …, 76 (a avaliação cabe até a data-base)', () => {
    expect(r.folds.map((f) => f.origin)).toEqual([27, 34, 41, 48, 55, 62, 69, 76].map(at));
    expect(r.folds.at(-1)?.evalTo).toBe(asOf);
  });

  it('em CADA dobra o treino termina antes da avaliação e usa só dados ≤ origem', () => {
    for (const f of r.folds) {
      expect(f.trainTo).toBe(f.origin);
      expect(f.trainTo < f.evalFrom).toBe(true);
      expect(daysBetween(f.trainTo, f.evalFrom)).toBe(1);
      expect(daysBetween(f.evalFrom, f.evalTo)).toBe(6);
      expect(daysBetween(f.trainFrom, f.trainTo) + 1).toBeGreaterThanOrEqual(BACKTEST_MIN_TRAIN_DAYS);
    }
    for (const m of r.models) {
      for (const fold of m.folds) {
        expect(fold.points.every((p) => p.date > fold.origin)).toBe(true);
      }
    }
  });

  it('comparação justa: Holt-Winters só entra a partir de 42 dias; todos os modelos usam as MESMAS 6 dobras e 42 pontos', () => {
    expect(r.comparison.status).toBe('ok');
    expect(r.comparison.reason).toBeNull();
    expect(r.comparison.comparedModels).toEqual([...MODEL_IDS]);
    expect(r.comparison.comparableFolds).toBe(6);
    expect(r.comparison.points).toBe(42);
    expect(r.folds.filter((f) => f.comparable).map((f) => f.origin)).toEqual([41, 48, 55, 62, 69, 76].map(at));
    for (const id of MODEL_IDS) {
      expect(model(r, id).metrics?.folds).toBe(6);
      expect(model(r, id).metrics?.points).toBe(42);
      expect(model(r, id).folds.map((f) => f.origin)).toEqual([41, 48, 55, 62, 69, 76].map(at));
    }
  });

  it('ingênuo (contas à mão): erro absoluto 70.000 por dobra ⇒ 420.000 / 42 = MAE R$ 100,00; WAPE 100%', () => {
    // previsão = domingo (20.000); real = 5.000×4, 10.000, 20.000, 20.000 ⇒ |e| = 15.000×4 + 10.000 + 0 + 0 = 70.000; real/dobra = 70.000
    const m = model(r, 'naive_last').metrics!;
    expect(m.absErrorSumCents).toBe(420000n);
    expect(m.actualSumCents).toBe(420000n);
    expect(m.maeCents).toBe(10000n);
    expect(m.wapeBps).toBe(10000);
    expect(m.wapeNote).toBeNull();
    expect(m.biasCents).toBe(-10000n); // erro médio com sinal: −420.000 / 42 = −R$ 100,00 (sempre superestima)
  });

  it('média móvel (contas à mão): |e| = 5.000×4 + 0 + 10.000×2 = 40.000 por dobra ⇒ 240.000 / 42 = 5.714 (MAE); WAPE 5.714 bps', () => {
    const m = model(r, 'moving_average_7').metrics!;
    expect(m.absErrorSumCents).toBe(240000n);
    expect(m.maeCents).toBe(5714n);
    expect(m.wapeBps).toBe(5714);
  });

  it('sazonal e Holt-Winters reproduzem o padrão semanal exato: erro zero; empate ⇒ o mais simples (sazonal)', () => {
    for (const id of ['seasonal_weekday_mean', 'holt_winters_additive'] as const) {
      const m = model(r, id).metrics!;
      expect([m.absErrorSumCents, m.maeCents, m.wapeBps]).toEqual([0n, 0n, 0]);
    }
    expect(r.comparison.lowestErrorModel).toBe('seasonal_weekday_mean');
  });

  it('cada ponto traz previsto, realizado e erro auditáveis; erro = realizado − previsto', () => {
    const fold = model(r, 'naive_last').folds[0]!;
    expect(fold.origin).toBe(at(41));
    expect(fold.evalFrom).toBe(at(42));
    expect(fold.points.map((p) => [p.date, p.predictedCents, p.actualCents, p.errorCents])).toEqual([
      [at(42), 20000n, 5000n, -15000n],
      [at(43), 20000n, 5000n, -15000n],
      [at(44), 20000n, 5000n, -15000n],
      [at(45), 20000n, 5000n, -15000n],
      [at(46), 20000n, 10000n, -10000n],
      [at(47), 20000n, 20000n, 0n],
      [at(48), 20000n, 20000n, 0n],
    ]);
    expect(fold.predictedCents).toBe(140000n);
    expect(fold.actualCents).toBe(70000n);
    expect(fold.absErrorCents).toBe(70000n);
    expect(fold.wapeBps).toBe(10000);
    expect(fold.points.every((p) => p.filled === false)).toBe(true);
  });

  it('faixas: resíduos suficientes (42 ≥ 28; 6 dobras ≥ 4) ⇒ média móvel −R$ 50,00 / +R$ 100,00 (percentis 10 e 90 à mão)', () => {
    // resíduos da média móvel: −5.000 ×24, 0 ×6, +10.000 ×12 ⇒ posto 5 → −5.000; posto 38 → +10.000
    const band = model(r, 'moving_average_7').band!;
    expect(band.status).toBe('available');
    if (band.status !== 'available') return;
    expect([band.lowerOffsetCents, band.upperOffsetCents, band.residuals, band.folds]).toEqual([-5000n, 10000n, 42, 6]);
    // ingênuo: −15.000 ×24, −10.000 ×6, 0 ×12 ⇒ posto 5 → −15.000; posto 38 → 0
    const naive = model(r, 'naive_last').band!;
    if (naive.status === 'available') expect([naive.lowerOffsetCents, naive.upperOffsetCents]).toEqual([-15000n, 0n]);
  });

  it('previsão final na data-base: dias seguintes, método, treino e faixa (piso 0)', () => {
    const points = toForecastPoints(r, 'moving_average_7');
    expect(points).toHaveLength(7);
    expect(points[0]).toEqual({
      date: at(84),
      centralCents: 10000n,
      lowerCents: 5000n,
      upperCents: 20000n,
      method: 'moving_average_7',
      trainEnd: asOf,
      sampleDays: 84,
      isHypothesis: false,
      validated: true,
      unit: 'gross_sales',
      label: 'Média móvel de 7 dias',
    });
    expect(toForecastPoints(r, 'naive_last')[0]).toMatchObject({ centralCents: 20000n, lowerCents: 5000n, upperCents: 20000n });
  });

  it('a janela de treino final e a avaliação ficam registradas', () => {
    expect(r.window).toEqual({ from: at(0), to: asOf, days: 84, observedDays: 84, filledDays: 0 });
    expect(r.evaluation).toMatchObject({ horizonDays: 7, firstOrigin: at(41), lastOrigin: at(76), evalFrom: at(42), evalTo: asOf });
    expect(r.asOf).toBe(asOf);
  });
});

describe('sem vazamento e sem reescrever o passado', () => {
  const base = fromValues(weeks(12));
  const asOf = at(83);
  const a = runBacktest(base, { asOf, horizonDays: 7 });

  it('vendas DEPOIS da data-base não mudam nada (relatório idêntico)', () => {
    const future = [...base, sale(at(84), 99999999), sale(at(90), 1)];
    expect(runBacktest(future, { asOf, horizonDays: 7 })).toEqual(a);
  });

  it('alterar o futuro de uma dobra não muda o que o modelo previu nela (só o realizado e o erro)', () => {
    // dia 58 está dentro da avaliação da dobra de origem 55 (dias 56…62) e depois das origens ≤ 57
    const tampered = base.map((s) => (s.saleDate === at(58) ? { ...s, grossCents: '777777' } : s));
    const b = runBacktest(tampered, { asOf, horizonDays: 7 });
    for (const id of ['naive_last', 'moving_average_7'] as const) {
      const fa = model(a, id).folds;
      const fb = model(b, id).folds;
      for (const origin of [41, 48, 55].map(at)) {
        const pa = fa.find((f) => f.origin === origin)!;
        const pb = fb.find((f) => f.origin === origin)!;
        expect(pb.points.map((p) => p.predictedCents)).toEqual(pa.points.map((p) => p.predictedCents));
      }
      // o realizado do dia 58 mudou, e só ele (na dobra 55)
      const actualA = fa.find((f) => f.origin === at(55))!.points.find((p) => p.date === at(58))!;
      const actualB = fb.find((f) => f.origin === at(55))!.points.find((p) => p.date === at(58))!;
      expect(actualA.actualCents).toBe(5000n); // dia 58 = 58 % 7 = 2 (quarta) = 5.000
      expect(actualB.actualCents).toBe(777777n);
    }
  });

  it('dobras posteriores ao dado alterado passam a treinar com ele (é o esperado: treino ≤ origem)', () => {
    const tampered = base.map((s) => (s.saleDate === at(58) ? { ...s, grossCents: '777777' } : s));
    const b = runBacktest(tampered, { asOf, horizonDays: 7 });
    const pa = model(a, 'naive_last').folds.find((f) => f.origin === at(76))!;
    const pb = model(b, 'naive_last').folds.find((f) => f.origin === at(76))!;
    expect(pb.points.map((p) => p.predictedCents)).toEqual(pa.points.map((p) => p.predictedCents)); // naive usa só o último dia (dia 76)
    const ma_a = model(a, 'moving_average_7').folds.find((f) => f.origin === at(62))!;
    const ma_b = model(b, 'moving_average_7').folds.find((f) => f.origin === at(62))!;
    expect(ma_b.points[0]?.predictedCents).not.toBe(ma_a.points[0]?.predictedCents); // janela 56…62 contém o dia 58
  });
});

describe('denominador zero e dias sem venda', () => {
  /** Só 28 dias de venda; a data-base é 28 dias depois: todo o período avaliado é R$ 0 (dias sem movimento). */
  const sales = fromValues(weeks(4));
  const asOf = at(55);
  const r = runBacktest(sales, { asOf, horizonDays: 7 });

  it('realizado total R$ 0 ⇒ WAPE indefinido (null) com nota; MAE continua definido', () => {
    expect(r.folds.map((f) => f.origin)).toEqual([27, 34, 41, 48].map(at));
    expect(r.comparison.status).toBe('ok');
    expect(r.comparison.comparedModels).toEqual(['naive_last', 'moving_average_7']);
    const naive = model(r, 'naive_last').metrics!;
    // origem 27 (domingo R$ 200,00): 7 × 20.000 = 140.000 de erro; nas demais origens o último dia é R$ 0 ⇒ erro 0
    expect(naive.absErrorSumCents).toBe(140000n);
    expect(naive.points).toBe(28);
    expect(naive.maeCents).toBe(5000n);
    expect(naive.actualSumCents).toBe(0n);
    expect(naive.wapeBps).toBeNull();
    expect(naive.wapeNote).toContain('R$ 0');
    const ma = model(r, 'moving_average_7').metrics!;
    expect([ma.absErrorSumCents, ma.maeCents, ma.wapeBps]).toEqual([70000n, 2500n, null]);
    expect(r.comparison.lowestErrorModel).toBe('moving_average_7');
  });

  it('dobra com realizado zero tem WAPE da dobra indefinido; os dias preenchidos são marcados', () => {
    const fold = model(r, 'naive_last').folds[1]!;
    expect(fold.actualCents).toBe(0n);
    expect(fold.wapeBps).toBeNull();
    expect(fold.points.every((p) => p.filled)).toBe(true);
    expect(r.warnings.some((w) => w.includes('WAPE indefinido'))).toBe(true);
  });

  it('Holt-Winters e sazonal ficam de fora com motivo (lacunas 50% na janela final)', () => {
    expect(model(r, 'holt_winters_additive').eligible).toBe(false);
    expect(model(r, 'holt_winters_additive').metrics).toBeNull();
    expect(model(r, 'holt_winters_additive').reason).toContain('lacunas');
    expect(model(r, 'seasonal_weekday_mean').eligible).toBe(false);
  });

  it('política "ignore": dias sem venda não são avaliados (sem preencher com zero)', () => {
    const ir = runBacktest(fromValues(weeks(8)).filter((s) => s.saleDate !== at(45)), {
      asOf: at(55),
      horizonDays: 7,
      missingDays: 'ignore',
    });
    const dates = model(ir, 'moving_average_7').folds.flatMap((f) => f.points.map((p) => p.date));
    expect(dates).not.toContain(at(45));
    expect(model(ir, 'moving_average_7').folds.every((f) => f.points.every((p) => !p.filled))).toBe(true);
  });
});

describe('amostra insuficiente: nenhuma métrica, nenhuma faixa, nenhum "menor erro"', () => {
  it('35 dias, horizonte 7: sobra 1 dobra (< 4) ⇒ comparação insuficiente, sem métricas nem faixa; previsão sem faixa e sem erro medido', () => {
    const r = runBacktest(fromValues(weeks(5)), { asOf: at(34), horizonDays: 7 });
    expect(r.folds).toHaveLength(1);
    expect(r.comparison.status).toBe('insufficient');
    expect(r.comparison.reason).toContain('1 dobra');
    expect(r.comparison.reason).toContain(String(MIN_COMPARABLE_FOLDS));
    expect(r.comparison.lowestErrorModel).toBeNull();
    for (const m of r.models) {
      expect(m.metrics).toBeNull();
      expect(m.band).toBeNull();
    }
    const points = toForecastPoints(r, 'moving_average_7');
    expect(points).toHaveLength(7);
    expect(points.every((p) => p.lowerCents === null && p.upperCents === null && p.validated === false)).toBe(true);
  });

  it('menos de 28 dias de histórico ⇒ nenhuma dobra', () => {
    const r = runBacktest(fromValues(weeks(3)), { asOf: at(20), horizonDays: 7 });
    expect(r.folds).toEqual([]);
    expect(r.comparison.status).toBe('insufficient');
    expect(r.comparison.reason).toContain('21 dias');
  });

  it('sem vendas: tudo insuficiente, sem exceção; previsão vazia', () => {
    const r = runBacktest([], { asOf: '2026-11-11', horizonDays: 7 });
    expect(r.folds).toEqual([]);
    expect(r.comparison.status).toBe('insufficient');
    expect(r.models.every((m) => !m.eligible && m.forecast.length === 0)).toBe(true);
    expect(toForecastPoints(r, 'naive_last')).toEqual([]);
  });

  it('horizonte 28 com 84 dias: Holt-Winters tem só 3 dobras próprias e SAI da comparação (com motivo); os demais seguem com 5 dobras', () => {
    const r = runBacktest(fromValues(weeks(12)), { asOf: at(83), horizonDays: 28 });
    expect(r.folds.map((f) => f.origin)).toEqual([27, 34, 41, 48, 55].map(at));
    expect(r.comparison.status).toBe('ok');
    expect(r.comparison.comparedModels).toEqual(['naive_last', 'moving_average_7', 'seasonal_weekday_mean']);
    expect(r.comparison.comparableFolds).toBe(5);
    const hw = model(r, 'holt_winters_additive');
    expect(hw.eligible).toBe(true);
    expect(hw.forecast).toHaveLength(28);
    expect(hw.metrics).toBeNull();
    expect(hw.band).toBeNull();
    expect(hw.backtestNote).toContain('3 dobras');
    expect(toForecastPoints(r, 'holt_winters_additive').every((p) => p.validated === false && p.lowerCents === null)).toBe(true);
  });

  it('com horizonte 28 e 5 dobras × 28 dias = 140 resíduos, faixa disponível para os modelos comparados', () => {
    const r = runBacktest(fromValues(weeks(12)), { asOf: at(83), horizonDays: 28 });
    expect(model(r, 'moving_average_7').band?.status).toBe('available');
    expect(model(r, 'moving_average_7').metrics?.points).toBe(140);
  });
});

describe('validação de entrada e pureza', () => {
  const sales = fromValues(weeks(12));

  it('data-base ou horizonte inválidos lançam RangeError', () => {
    expect(() => runBacktest(sales, { asOf: '2026-02-30', horizonDays: 7 })).toThrow(RangeError);
    for (const h of [0, 91, 2.5]) expect(() => runBacktest(sales, { asOf: at(83), horizonDays: h })).toThrow(RangeError);
  });

  it('não altera a entrada e independe da ordem das vendas', () => {
    const copy = JSON.stringify(sales);
    const a = runBacktest(sales, { asOf: at(83), horizonDays: 7 });
    expect(JSON.stringify(sales)).toBe(copy);
    expect(runBacktest([...sales].reverse(), { asOf: at(83), horizonDays: 7 })).toEqual(a);
  });
});
