import { describe, expect, it } from 'vitest';
import { addDays } from '../../finance/dates';
import type { Sale } from '../../sales/types';
import {
  analyzeSeasonality,
  buildTrainingSeries,
  MAX_FILLED_SHARE_BPS,
  MIN_PERIOD_MONTHS,
  MIN_SEASONAL_STRENGTH_BPS,
  MIN_WEEKDAY_OBSERVATIONS,
  MIN_WEEKLY_DAYS,
} from '../seasonality';

let seq = 0;
const sale = (saleDate: string, cents: number): Sale => {
  seq += 1;
  return {
    id: `sale_${seq}`,
    saleKey: `sale:S${seq}`,
    externalId: `S${seq}`,
    saleDate,
    grossCents: String(cents),
    method: 'pix',
    category: '',
  };
};

/** 2026-09-07 é segunda-feira (2026-10-26, segunda, menos 49 dias). */
const MONDAY = '2026-09-07';

/** `weeks` semanas começando na segunda; `pattern` = centavos de segunda a domingo. */
function weekly(pattern: readonly number[], weeks: number, start = MONDAY): Sale[] {
  const out: Sale[] = [];
  for (let i = 0; i < weeks * 7; i += 1) out.push(sale(addDays(start, i), pattern[i % 7] as number));
  return out;
}

/** Segunda a domingo: R$ 100 ×4, sexta R$ 200, sábado e domingo R$ 300. */
const PATTERN = [10000, 10000, 10000, 10000, 20000, 30000, 30000];
const SUNDAY = 0;
const MON = 1;
const SAT = 6;

const weekdayGroup = (r: ReturnType<typeof analyzeSeasonality>, weekday: number) =>
  r.weekly.groups.find((g) => g.key === weekday)!;

describe('buildTrainingSeries — janela de treino e data de corte', () => {
  const sales = [sale('2026-11-02', 1000), sale('2026-11-04', 2000), sale('2026-11-09', 9999)];

  it('ignora vendas depois do corte e preenche com zero até o corte (política zero)', () => {
    const s = buildTrainingSeries(sales, '2026-11-06');
    expect(s.map((p) => [p.date, p.grossCents, p.filled])).toEqual([
      ['2026-11-02', 1000n, false],
      ['2026-11-03', 0n, true],
      ['2026-11-04', 2000n, false],
      ['2026-11-05', 0n, true],
      ['2026-11-06', 0n, true],
    ]);
  });

  it('política "ignore": só dias observados até o corte, sem preencher', () => {
    const s = buildTrainingSeries(sales, '2026-11-06', 'ignore');
    expect(s.map((p) => p.date)).toEqual(['2026-11-02', '2026-11-04']);
  });

  it('corte antes da 1ª venda ⇒ série vazia; corte inválido ⇒ erro', () => {
    expect(buildTrainingSeries(sales, '2026-10-01')).toEqual([]);
    expect(() => buildTrainingSeries(sales, '2026-02-30')).toThrow(RangeError);
  });

  it('a data de corte é inclusiva', () => {
    expect(buildTrainingSeries(sales, '2026-11-04').at(-1)?.grossCents).toBe(2000n);
  });
});

describe('analyzeSeasonality — amostra insuficiente não vira hipótese', () => {
  it('sem vendas: tudo insuficiente, sem exceção', () => {
    const r = analyzeSeasonality([], { cutoff: '2026-11-11' });
    expect(r.weekly.status).toBe('insufficient_data');
    expect(r.monthly.status).toBe('insufficient_data');
    expect(r.weekly.groups.every((g) => g.indexBps === null)).toBe(true);
    expect(r.days).toBe(0);
  });

  it('3 semanas (21 dias): insuficiente, índice nulo, motivo cita o mínimo de 28 dias', () => {
    const r = analyzeSeasonality(weekly(PATTERN, 3), { cutoff: '2026-09-27' });
    expect(r.days).toBe(21);
    expect(r.weekly.status).toBe('insufficient_data');
    expect(r.weekly.reason).toContain('21 dias');
    expect(r.weekly.reason).toContain(String(MIN_WEEKLY_DAYS));
    expect(r.weekly.strengthBps).toBeNull();
    expect(r.weekly.groups.every((g) => g.indexBps === null && g.meanCents === null)).toBe(true);
  });

  it('lacunas acima de 30% da série tornam a amostra insuficiente', () => {
    // 28 dias de série: vendas só em 17 dias ⇒ 11 dias preenchidos (39%)
    const sales = weekly(PATTERN, 4).filter((_, i) => i < 17 || i === 27);
    const r = analyzeSeasonality(sales, { cutoff: '2026-10-04' });
    expect(r.filledDays).toBeGreaterThan((r.days * MAX_FILLED_SHARE_BPS) / 10_000);
    expect(r.weekly.status).toBe('insufficient_data');
    expect(r.weekly.reason).toContain('lacunas');
    expect(r.monthly.status).toBe('insufficient_data');
  });

  it('um dia da semana que perde observação por outlier fica abaixo do mínimo ⇒ insuficiente (cita o dia)', () => {
    // 4 semanas; a 4ª segunda-feira vende 10× o normal ⇒ outlier ⇒ só 3 segundas utilizáveis
    const sales = weekly(PATTERN, 4);
    sales[21] = sale(addDays(MONDAY, 21), 100000);
    const r = analyzeSeasonality(sales, { cutoff: '2026-10-04' });
    expect(r.outliers.map((o) => o.date)).toEqual([addDays(MONDAY, 21)]);
    expect(weekdayGroup(r, MON).observations).toBe(3);
    expect(MIN_WEEKDAY_OBSERVATIONS).toBe(4);
    expect(r.weekly.status).toBe('insufficient_data');
    expect(r.weekly.reason).toContain('segunda-feira');
    expect(r.weekly.reason).toContain('3');
  });

  it('média zero não permite índice (divisão por zero evitada)', () => {
    const r = analyzeSeasonality(weekly([0, 0, 0, 0, 0, 0, 0], 8), { cutoff: '2026-11-01' });
    expect(r.weekly.status).toBe('insufficient_data');
    expect(r.weekly.reason).toContain('zero');
  });

  it('período do mês exige 3 meses: 8 semanas (56 dias) ⇒ insuficiente, semanal segue possível', () => {
    const r = analyzeSeasonality(weekly(PATTERN, 8), { cutoff: '2026-11-01' });
    expect(r.weekly.status).toBe('seasonal');
    expect(r.monthly.status).toBe('insufficient_data');
    expect(r.monthly.reason).toContain(String(MIN_PERIOD_MONTHS));
    expect(r.monthly.groups.every((g) => g.indexBps === null)).toBe(true);
  });
});

describe('analyzeSeasonality — dia da semana (contas à mão)', () => {
  const sales = weekly(PATTERN, 8); // 56 dias, 7 ciclos... 8 por dia da semana
  const r = analyzeSeasonality(sales, { cutoff: '2026-11-01' });

  it('padrão semanal claro: 8 semanas ⇒ seasonal, força 100%, índices exatos', () => {
    /*
     * Total = 8 × (4×100 + 200 + 300 + 300) = R$ 9.600,00 em 56 dias (média R$ 171,43).
     * Índice (bps) = média do dia ÷ média geral: seg-qui 100/171,43 = 5.833; sex 11.667; sáb e dom 17.500.
     * Sem variação dentro de cada dia da semana ⇒ toda a variação é "entre dias" ⇒ força 10.000 bps.
     */
    expect(r.weekly.status).toBe('seasonal');
    expect(r.weekly.reason).toBeNull();
    expect(r.weekly.strengthBps).toBe(10_000);
    expect(r.weekly.groups.map((g) => g.indexBps)).toEqual([17500, 5833, 5833, 5833, 5833, 11667, 17500]);
    expect(r.weekly.groups.map((g) => g.meanCents)).toEqual([30000n, 10000n, 10000n, 10000n, 10000n, 20000n, 30000n]);
    expect(r.weekly.groups.every((g) => g.observations === 8 && g.excluded === 0)).toBe(true);
    expect(r.outliers).toEqual([]);
    expect(r.trainFrom).toBe('2026-09-07');
    expect(r.trainTo).toBe('2026-11-01');
    expect(r.days).toBe(56);
    expect(r.observedDays).toBe(56);
  });

  it('a média dos índices ponderada pelos dias é 10.000 (conferência de consistência)', () => {
    const avg = r.weekly.groups.reduce((acc, g) => acc + (g.indexBps as number), 0) / 7;
    expect(Math.abs(avg - 10_000)).toBeLessThan(2);
  });

  it('série sem padrão (valor constante) ⇒ not_seasonal, força 0, nenhum índice anunciado como padrão', () => {
    const flat = analyzeSeasonality(weekly([10000, 10000, 10000, 10000, 10000, 10000, 10000], 8), { cutoff: '2026-11-01' });
    expect(flat.weekly.status).toBe('not_seasonal');
    expect(flat.weekly.strengthBps).toBe(0);
    expect(flat.weekly.reason).toContain('constante');
  });

  it('série irregular sem ciclo semanal (ciclo de 11 dias) ⇒ not_seasonal, força 321 bps < limiar', () => {
    const irregular: Sale[] = [];
    for (let i = 0; i < 56; i += 1) irregular.push(sale(addDays(MONDAY, i), ((i * 37) % 11 + 10) * 1000));
    const res = analyzeSeasonality(irregular, { cutoff: '2026-11-01' });
    expect(res.weekly.strengthBps).toBe(321);
    expect(res.weekly.strengthBps as number).toBeLessThan(MIN_SEASONAL_STRENGTH_BPS);
    expect(res.weekly.status).toBe('not_seasonal');
    expect(res.weekly.reason).toContain('sem padrão semanal');
  });
});

describe('analyzeSeasonality — outliers e lacunas', () => {
  /** 8 semanas; o 4º sábado (índice 26) vende R$ 3.000 em vez de R$ 300. */
  const withOutlier = weekly(PATTERN, 8);
  withOutlier[26] = sale(addDays(MONDAY, 26), 300000);

  it('outlier é listado e excluído do índice; o padrão continua detectado', () => {
    const r = analyzeSeasonality(withOutlier, { cutoff: '2026-11-01' });
    expect(r.outliers).toEqual([
      { date: addDays(MONDAY, 26), weekday: SAT, valueCents: 300000n, medianCents: 30000n, filled: false },
    ]);
    const sat = weekdayGroup(r, SAT);
    expect(sat.observations).toBe(7);
    expect(sat.excluded).toBe(1);
    // total utilizável R$ 9.300,00 em 55 dias: índices 5.914 (seg-qui), 11.828 (sex), 17.742 (sáb/dom)
    expect(r.weekly.groups.map((g) => g.indexBps)).toEqual([17742, 5914, 5914, 5914, 5914, 11828, 17742]);
    expect(r.weekly.status).toBe('seasonal');
    expect(r.weekly.strengthBps).toBe(10_000);
  });

  it('prova de que a exclusão importa: com o outlier incluído a força cai a 2.304 bps (< 2.500) e o padrão some', () => {
    // conta de referência independente (fora do código): índices 4.553 / 9.106 / 29.024 / 13.659; η² = 2.304
    const r = analyzeSeasonality(withOutlier, { cutoff: '2026-11-01', excludeOutliers: false });
    expect(r.weekly.strengthBps).toBe(2304);
    expect(r.weekly.strengthBps as number).toBeLessThan(MIN_SEASONAL_STRENGTH_BPS);
    expect(r.weekly.status).toBe('not_seasonal');
    expect(weekdayGroup(r, SAT).observations).toBe(8);
    expect(r.weekly.groups.map((g) => g.indexBps)).toEqual([13659, 4553, 4553, 4553, 4553, 9106, 29024]);
  });

  it('lacuna (dia sem venda) com política zero: marcada como outlier preenchido e excluída do índice', () => {
    const sales = weekly(PATTERN, 8).filter((_, i) => i !== 23); // 4ª quarta-feira sem venda
    const r = analyzeSeasonality(sales, { cutoff: '2026-11-01' });
    expect(r.filledDays).toBe(1);
    expect(r.outliers).toEqual([
      { date: addDays(MONDAY, 23), weekday: 3, valueCents: 0n, medianCents: 10000n, filled: true },
    ]);
    expect(weekdayGroup(r, 3).observations).toBe(7);
    expect(weekdayGroup(r, 3).meanCents).toBe(10000n);
    expect(r.warnings.some((w) => w.includes('1 dia'))).toBe(true);
  });

  it('lacuna com política "ignore": o dia simplesmente não existe (sem outlier, sem preenchimento)', () => {
    const sales = weekly(PATTERN, 8).filter((_, i) => i !== 23);
    const r = analyzeSeasonality(sales, { cutoff: '2026-11-01', missingDays: 'ignore' });
    expect(r.filledDays).toBe(0);
    expect(r.outliers).toEqual([]);
    expect(weekdayGroup(r, 3).observations).toBe(7);
    expect(r.weekly.status).toBe('seasonal');
  });

  it('variação trivial não é outlier (piso de 5% da mediana evita falso alarme com MAD zero)', () => {
    const sales = weekly(PATTERN, 8);
    sales[0] = sale(MONDAY, 10100); // +1% numa segunda
    const r = analyzeSeasonality(sales, { cutoff: '2026-11-01' });
    expect(r.outliers).toEqual([]);
  });
});

describe('analyzeSeasonality — período do mês', () => {
  /** 1º/ago a 31/out: dias 1–10 = R$ 100; 11–20 = R$ 150; 21–fim = R$ 300 (92 dias). */
  const monthly: Sale[] = [];
  for (let i = 0; i < 92; i += 1) {
    const date = addDays('2026-08-01', i);
    const day = Number(date.slice(8, 10));
    monthly.push(sale(date, day <= 10 ? 10000 : day <= 20 ? 15000 : 30000));
  }
  const r = analyzeSeasonality(monthly, { cutoff: '2026-10-31' });

  it('3 meses com padrão por período ⇒ seasonal; índices exatos', () => {
    /*
     * Dias por período: P1 = 30 dias × R$ 100 = 3.000; P2 = 30 × 150 = 4.500; P3 = 11+10+11 = 32 dias × 300 = 9.600.
     * Total 17.100 em 92 dias. Índice = média do período ÷ média geral: 5.380 / 8.070 / 16.140. Força 10.000.
     */
    expect(r.monthly.status).toBe('seasonal');
    expect(r.monthly.strengthBps).toBe(10_000);
    expect(r.monthly.groups.map((g) => [g.key, g.observations, g.indexBps])).toEqual([
      [1, 30, 5380],
      [2, 30, 8070],
      [3, 32, 16140],
    ]);
    expect(r.monthly.groups.map((g) => g.label)).toEqual(['Dias 1 a 10', 'Dias 11 a 20', 'Dia 21 ao fim']);
  });

  it('o mesmo conjunto não tem padrão semanal (força 49 bps) — os dois componentes são independentes', () => {
    expect(r.weekly.strengthBps).toBe(49);
    expect(r.weekly.status).toBe('not_seasonal');
  });

  it('meses com poucos dias não contam como ciclo: 3 meses, mas o 3º tem só 4 dias ⇒ insuficiente', () => {
    const shortThird = monthly.filter((s) => s.saleDate <= '2026-10-04');
    const res = analyzeSeasonality(shortThird, { cutoff: '2026-10-04' });
    expect(res.monthly.status).toBe('insufficient_data');
  });
});

describe('analyzeSeasonality — data de corte e pureza', () => {
  const base = weekly(PATTERN, 8);

  it('vendas depois do corte não mudam nada: resultado idêntico a usar só os dados até o corte', () => {
    const cutoff = addDays(MONDAY, 41); // 42 dias de treino
    const onlyPast = analyzeSeasonality(base.filter((s) => s.saleDate <= cutoff), { cutoff });
    const withFuture = analyzeSeasonality(base, { cutoff });
    expect(withFuture).toEqual(onlyPast);
    expect(withFuture.days).toBe(42);
  });

  it('alterar o futuro (valores depois do corte) não altera o resultado', () => {
    const cutoff = addDays(MONDAY, 41);
    const tampered = base.map((s) => (s.saleDate > cutoff ? { ...s, grossCents: '99999999' } : s));
    expect(analyzeSeasonality(tampered, { cutoff })).toEqual(analyzeSeasonality(base, { cutoff }));
  });

  it('independe da ordem das vendas e não altera a entrada', () => {
    const copy = [...base];
    const reversed = [...base].reverse();
    expect(analyzeSeasonality(reversed, { cutoff: '2026-11-01' })).toEqual(analyzeSeasonality(copy, { cutoff: '2026-11-01' }));
    expect(copy).toEqual(base);
  });

  it('vendas no mesmo dia somam antes da análise', () => {
    const split = weekly(PATTERN, 8).flatMap((s) => [
      { ...s, id: `${s.id}a`, grossCents: String(Number(s.grossCents) - 100) },
      { ...s, id: `${s.id}b`, grossCents: '100' },
    ]);
    expect(analyzeSeasonality(split, { cutoff: '2026-11-01' }).weekly.groups).toEqual(
      analyzeSeasonality(base, { cutoff: '2026-11-01' }).weekly.groups,
    );
  });

  it('corte inválido lança RangeError', () => {
    expect(() => analyzeSeasonality(base, { cutoff: 'ontem' })).toThrow(RangeError);
  });

  it('domingo é o dia 0 (convenção de Date) e fica no índice 0 do grupo', () => {
    const r = analyzeSeasonality(base, { cutoff: '2026-11-01' });
    expect(r.weekly.groups[SUNDAY]?.key).toBe(0);
    expect(r.weekly.groups[SUNDAY]?.label).toBe('domingo');
  });
});
