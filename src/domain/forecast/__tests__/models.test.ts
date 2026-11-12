import { describe, expect, it } from 'vitest';
import { addDays } from '../../finance/dates';
import type { Sale } from '../../sales/types';
import { buildTrainingSeries } from '../seasonality';
import {
  forecastModels,
  HW_ALPHA_BPS,
  HW_BETA_BPS,
  HW_GAMMA_BPS,
  HW_MIN_DAYS,
  MODEL_IDS,
  type ModelId,
  type ModelsResult,
} from '../models';

let seq = 0;
const sale = (saleDate: string, cents: number): Sale => {
  seq += 1;
  return {
    id: `sale_${seq}`,
    saleKey: `sale:M${seq}`,
    externalId: `M${seq}`,
    saleDate,
    grossCents: String(cents),
    method: 'pix',
    category: '',
  };
};

/** 2026-09-07 é segunda-feira. */
const MONDAY = '2026-09-07';
/** Segunda a domingo; soma 70.000 ⇒ média 10.000 por dia (sem arredondamento na inicialização). */
const PERIODIC = [5000, 5000, 5000, 5000, 10000, 20000, 20000];

const fromValues = (values: readonly number[], start = MONDAY): Sale[] => values.map((v, i) => sale(addDays(start, i), v));
const lastDay = (n: number, start = MONDAY): string => addDays(start, n - 1);
const model = (r: ModelsResult, id: ModelId) => r.models.find((m) => m.id === id)!;
const central = (r: ModelsResult, id: ModelId): bigint[] => model(r, id).points.map((p) => p.centralCents);

describe('forecastModels — contrato geral', () => {
  const sales = fromValues(Array.from({ length: 8 }, () => PERIODIC).flat()); // 56 dias
  const cutoff = lastDay(56); // domingo 01/11
  const r = forecastModels(sales, { cutoff, horizonDays: 7 });

  it('lista os quatro modelos na ordem de simplicidade, com parâmetros fixos documentados', () => {
    expect(MODEL_IDS).toEqual(['naive_last', 'moving_average_7', 'seasonal_weekday_mean', 'holt_winters_additive']);
    expect(r.models.map((m) => m.id)).toEqual([...MODEL_IDS]);
    expect(model(r, 'holt_winters_additive').params).toEqual({
      alphaBps: HW_ALPHA_BPS,
      betaBps: HW_BETA_BPS,
      gammaBps: HW_GAMMA_BPS,
      period: 7,
    });
    expect([HW_ALPHA_BPS, HW_BETA_BPS, HW_GAMMA_BPS]).toEqual([2000, 500, 3000]);
    expect(model(r, 'moving_average_7').params).toEqual({ window: 7 });
    expect(model(r, 'seasonal_weekday_mean').params).toEqual({ occurrences: 4 });
  });

  it('todos usam a MESMA janela de treino, igual à série de treino ao corte', () => {
    const series = buildTrainingSeries(sales, cutoff);
    expect(r.window).toEqual({ from: MONDAY, to: cutoff, days: series.length, observedDays: 56, filledDays: 0 });
    expect(r.cutoff).toBe(cutoff);
    expect(r.horizonDays).toBe(7);
  });

  it('datas previstas começam no dia seguinte ao corte', () => {
    const dates = model(r, 'naive_last').points.map((p) => p.date);
    expect(dates[0]).toBe('2026-11-02');
    expect(dates).toHaveLength(7);
    for (const m of r.models) expect(m.points.map((p) => p.date)).toEqual(dates);
  });

  it('modelo elegível: motivo nulo e 7 pontos; sem pontos negativos', () => {
    for (const m of r.models) {
      expect(m.eligible).toBe(true);
      expect(m.reason).toBeNull();
      expect(m.points.every((p) => p.centralCents >= 0n)).toBe(true);
    }
  });

  it('horizonte inválido lança RangeError; corte inválido também', () => {
    for (const h of [0, 91, 1.5, -3]) expect(() => forecastModels(sales, { cutoff, horizonDays: h })).toThrow(RangeError);
    expect(() => forecastModels(sales, { cutoff: '2026-13-01', horizonDays: 7 })).toThrow(RangeError);
  });

  it('não altera a entrada', () => {
    const copy = JSON.stringify(sales);
    forecastModels(sales, { cutoff, horizonDays: 14 });
    expect(JSON.stringify(sales)).toBe(copy);
  });
});

describe('forecastModels — valores calculados à mão', () => {
  const sales = fromValues(Array.from({ length: 8 }, () => PERIODIC).flat());
  const r = forecastModels(sales, { cutoff: lastDay(56), horizonDays: 7 });

  it('ingênuo: repete o último dia (domingo R$ 200,00)', () => {
    expect(central(r, 'naive_last')).toEqual(Array(7).fill(20000n));
  });

  it('média móvel de 7 dias: (4×50 + 100 + 200 + 200) / 7 = R$ 100,00 por dia', () => {
    expect(central(r, 'moving_average_7')).toEqual(Array(7).fill(10000n));
  });

  it('sazonal por dia da semana: média das últimas 4 ocorrências de cada dia (padrão exato)', () => {
    expect(central(r, 'seasonal_weekday_mean')).toEqual([5000n, 5000n, 5000n, 5000n, 10000n, 20000n, 20000n]);
  });

  it('Holt-Winters em série perfeitamente semanal reproduz o padrão (erro zero ⇒ nível 10.000, tendência 0)', () => {
    expect(central(r, 'holt_winters_additive')).toEqual([5000n, 5000n, 5000n, 5000n, 10000n, 20000n, 20000n]);
  });

  it('média móvel e ingênuo em tendência linear (x = 10.000 + 100·t, 49 dias): 14.500 e 14.800', () => {
    const linear = fromValues(Array.from({ length: 49 }, (_, t) => 10000 + 100 * t));
    const lr = forecastModels(linear, { cutoff: lastDay(49), horizonDays: 3 });
    // últimos 7 (t = 42…48): média em t = 45 ⇒ 14.500; último dia t = 48 ⇒ 14.800
    expect(central(lr, 'moving_average_7')).toEqual([14500n, 14500n, 14500n]);
    expect(central(lr, 'naive_last')).toEqual([14800n, 14800n, 14800n]);
  });

  it('sazonal usa só as últimas 4 ocorrências: segundas 5.000…12.000 ⇒ média das 4 últimas = 10.500', () => {
    const values = Array.from({ length: 56 }, (_, i) => (i % 7 === 0 ? 5000 + 1000 * (i / 7) : (PERIODIC[i % 7] as number)));
    const dr = forecastModels(fromValues(values), { cutoff: lastDay(56), horizonDays: 7 });
    // segundas das semanas 4–7: 9.000 + 10.000 + 11.000 + 12.000 = 42.000 / 4
    expect(central(dr, 'seasonal_weekday_mean')[0]).toBe(10500n);
    expect(central(dr, 'seasonal_weekday_mean').slice(1)).toEqual([5000n, 5000n, 5000n, 10000n, 20000n, 20000n]);
  });

  it('sazonal ignora o outlier do último sábado (R$ 2.000 em vez de R$ 200)', () => {
    const values = Array.from({ length: 56 }, (_, i) => PERIODIC[i % 7] as number);
    values[54] = 200000; // sábado da 8ª semana
    const or = forecastModels(fromValues(values), { cutoff: lastDay(56), horizonDays: 7 });
    expect(model(or, 'seasonal_weekday_mean').eligible).toBe(true);
    expect(central(or, 'seasonal_weekday_mean')[5]).toBe(20000n); // sáb: média de 20.000 ×4 (semanas 4–7)
  });
});

describe('Holt-Winters — parâmetros fixos (referência independente em Python, mesma aritmética inteira)', () => {
  const PAT = [0, 0, 0, 0, 2000, 5000, 5000];

  it('série com tendência de alta e padrão semanal (49 dias): 7 dias à frente', () => {
    const up = fromValues(Array.from({ length: 49 }, (_, t) => 10000 + 100 * t + (PAT[t % 7] as number)));
    const hr = forecastModels(up, { cutoff: lastDay(49), horizonDays: 7 });
    expect(central(hr, 'holt_winters_additive')).toEqual([14874n, 14969n, 15070n, 15180n, 17297n, 20421n, 20554n]);
  });

  it('série em queda: previsão tem piso em zero (valores brutos negativos viram R$ 0)', () => {
    const dn = fromValues(Array.from({ length: 49 }, (_, t) => 3600 - 70 * t + (PAT[t % 7] as number)));
    const hr = forecastModels(dn, { cutoff: lastDay(49), horizonDays: 30 });
    const expected = [
      192, 126, 56, 0, 1899, 4812, 4720, 0, 0, 0, 0, 1409, 4322, 4230, 0, 0, 0, 0, 919, 3832, 3740, 0, 0, 0, 0, 429, 3342,
      3250, 0, 0,
    ].map(BigInt);
    expect(central(hr, 'holt_winters_additive')).toEqual(expected);
  });

  it('série constante: previsão constante (sem inventar sazonalidade nem tendência)', () => {
    const flat = fromValues(Array(56).fill(10000));
    const fr = forecastModels(flat, { cutoff: lastDay(56), horizonDays: 7 });
    expect(central(fr, 'holt_winters_additive')).toEqual(Array(7).fill(10000n));
  });
});

describe('elegibilidade — sem amostra suficiente não há número', () => {
  it(`Holt-Winters não roda com menos de ${HW_MIN_DAYS} dias (28 dias): inelegível com motivo; os outros seguem`, () => {
    const short = fromValues(Array.from({ length: 4 }, () => PERIODIC).flat()); // 28 dias
    const sr = forecastModels(short, { cutoff: lastDay(28), horizonDays: 7 });
    const hw = model(sr, 'holt_winters_additive');
    expect(hw.eligible).toBe(false);
    expect(hw.points).toEqual([]);
    expect(hw.reason).toContain(String(HW_MIN_DAYS));
    expect(hw.reason).toContain('28 dias');
    expect(model(sr, 'naive_last').eligible).toBe(true);
    expect(model(sr, 'moving_average_7').eligible).toBe(true);
    expect(model(sr, 'seasonal_weekday_mean').eligible).toBe(true);
  });

  it('41 dias: ainda inelegível; 42 dias: elegível (fronteira exata)', () => {
    const v = Array.from({ length: 42 }, (_, i) => PERIODIC[i % 7] as number);
    expect(model(forecastModels(fromValues(v.slice(0, 41)), { cutoff: lastDay(41), horizonDays: 7 }), 'holt_winters_additive').eligible).toBe(false);
    expect(model(forecastModels(fromValues(v), { cutoff: lastDay(42), horizonDays: 7 }), 'holt_winters_additive').eligible).toBe(true);
  });

  it('menos de 7 dias com venda: nenhum modelo gera previsão', () => {
    const tiny = fromValues([10000, 12000, 9000, 11000, 10500]);
    const tr = forecastModels(tiny, { cutoff: lastDay(5), horizonDays: 7 });
    expect(tr.models.every((m) => !m.eligible && m.points.length === 0)).toBe(true);
    expect(model(tr, 'naive_last').reason).toContain('5 dias com venda');
    expect(tr.window.observedDays).toBe(5);
  });

  it('sem vendas: tudo inelegível, sem exceção', () => {
    const er = forecastModels([], { cutoff: '2026-11-11', horizonDays: 7 });
    expect(er.models.every((m) => !m.eligible)).toBe(true);
    expect(er.window).toEqual({ from: null, to: null, days: 0, observedDays: 0, filledDays: 0 });
  });

  it('sazonal só quando há sazonalidade semanal: série constante ⇒ inelegível com o motivo da análise', () => {
    const flat = fromValues(Array(56).fill(10000));
    const fr = forecastModels(flat, { cutoff: lastDay(56), horizonDays: 7 });
    const seasonal = model(fr, 'seasonal_weekday_mean');
    expect(seasonal.eligible).toBe(false);
    expect(seasonal.reason).toContain('Série constante');
    expect(model(fr, 'naive_last').eligible).toBe(true);
  });

  it('sazonal inelegível com 21 dias (amostra) e Holt-Winters com lacunas na política "ignore" (dias não consecutivos)', () => {
    const three = fromValues(Array.from({ length: 3 }, () => PERIODIC).flat());
    expect(model(forecastModels(three, { cutoff: lastDay(21), horizonDays: 7 }), 'seasonal_weekday_mean').reason).toContain('21 dias');

    const full = fromValues(Array.from({ length: 8 }, () => PERIODIC).flat()).filter((_, i) => i !== 30);
    const ir = forecastModels(full, { cutoff: lastDay(56), horizonDays: 7, missingDays: 'ignore' });
    const hw = model(ir, 'holt_winters_additive');
    expect(hw.eligible).toBe(false);
    expect(hw.reason).toContain('consecutivos');
    expect(model(ir, 'moving_average_7').eligible).toBe(true);
  });

  it('lacunas acima de 30% tornam o Holt-Winters inelegível mesmo com 42+ dias', () => {
    // 42 dias de série; só 28 com venda ⇒ 14 preenchidos (33%)
    const all = fromValues(Array.from({ length: 42 }, (_, i) => PERIODIC[i % 7] as number));
    const gappy = all.filter((_, i) => i < 28 || i === 41);
    const gr = forecastModels(gappy, { cutoff: lastDay(42), horizonDays: 7 });
    expect(gr.window.filledDays).toBe(13);
    expect(model(gr, 'holt_winters_additive').eligible).toBe(false);
    expect(model(gr, 'holt_winters_additive').reason).toContain('lacunas');
  });
});

describe('janela, corte e avisos', () => {
  const base = fromValues(Array.from({ length: 8 }, () => PERIODIC).flat());

  it('vendas depois do corte não influenciam: resultado idêntico ao dos dados até o corte', () => {
    const cutoff = lastDay(49);
    const past = base.filter((s) => s.saleDate <= cutoff);
    expect(forecastModels(base, { cutoff, horizonDays: 14 })).toEqual(forecastModels(past, { cutoff, horizonDays: 14 }));
  });

  it('alterar valores futuros não muda a previsão passada', () => {
    const cutoff = lastDay(49);
    const tampered = base.map((s) => (s.saleDate > cutoff ? { ...s, grossCents: '99999999' } : s));
    expect(forecastModels(tampered, { cutoff, horizonDays: 14 })).toEqual(forecastModels(base, { cutoff, horizonDays: 14 }));
  });

  it('corte bem depois da última venda: dias finais entram como R$ 0 (política zero) e há aviso de histórico desatualizado', () => {
    const cutoff = addDays(lastDay(56), 10);
    const sr = forecastModels(base, { cutoff, horizonDays: 7 });
    expect(sr.window.filledDays).toBe(10);
    expect(central(sr, 'naive_last')).toEqual(Array(7).fill(0n));
    expect(sr.warnings.some((w) => w.includes('desatualizado'))).toBe(true);
  });

  it('sem avisos quando o histórico termina no corte', () => {
    expect(forecastModels(base, { cutoff: lastDay(56), horizonDays: 7 }).warnings).toEqual([]);
  });
});
