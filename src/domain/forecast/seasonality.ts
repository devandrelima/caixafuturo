import { addDays, daysBetween, isValidISODate } from '../finance/dates';
import type { ISODate } from '../finance/types';
import type { Sale } from '../sales/types';
import { buildSalesSeries, divRound, weekdayOf } from './baseline';
import type { MissingDayPolicy, SalesPoint } from './baseline';

/**
 * Sazonalidade do FATURAMENTO BRUTO por dia da semana e por período do mês (ADR-0007, D1–D2).
 * Só afirma um padrão quando há amostra e suporte; caso contrário devolve o motivo, nunca um número "chutado".
 * Funções puras; dinheiro em BigInt (centavos); índices em pontos-base inteiros (10 000 = igual à média).
 * A "força" é um tamanho de efeito heurístico (η²), NÃO um teste de hipótese: não há probabilidade associada.
 */

/** Série mínima (dias) para falar em padrão semanal: 4 ciclos de 7 dias. */
export const MIN_WEEKLY_DAYS = 28;
/** Observações utilizáveis (não outlier) exigidas em CADA dia da semana. */
export const MIN_WEEKDAY_OBSERVATIONS = 4;
/** Meses distintos exigidos, em cada período do mês, para falar em sazonalidade mensal. */
export const MIN_PERIOD_MONTHS = 3;
/** Dias mínimos de um período dentro de um mês para esse mês contar como "ciclo". */
export const MIN_PERIOD_DAYS_PER_MONTH = 5;
/** Acima desta fração (bps) de dias preenchidos com zero a série tem lacunas demais. */
export const MAX_FILLED_SHARE_BPS = 3000;
/** Força mínima (bps) para anunciar padrão: 25% da variação explicada pelos grupos. Heurística. */
export const MIN_SEASONAL_STRENGTH_BPS = 2500;
/** Outlier: |x − mediana| > 3,5 × escala (ver `outlierScale`). */
const OUTLIER_FACTOR_X2 = 7n; // 3,5 × 2, para comparar em inteiros
/** Escala robusta: 1,4826 × MAD (em décimos de milésimo) com piso de 5% da mediana. */
const MAD_TO_SIGMA_X10000 = 14826n;
const SCALE_FLOOR_PCT = 5n;

export type SeasonalityStatus = 'seasonal' | 'not_seasonal' | 'insufficient_data';

export interface SeasonalGroup {
  /** Dia da semana (0 = domingo … 6 = sábado) ou período do mês (1, 2, 3). */
  key: number;
  label: string;
  /** Observações utilizáveis (depois de excluir outliers, se for o caso). */
  observations: number;
  /** Valores atípicos excluídos deste grupo. */
  excluded: number;
  /** Média dos valores utilizáveis; null quando a amostra é insuficiente. */
  meanCents: bigint | null;
  /** Média do grupo ÷ média geral, em pontos-base; null quando a amostra é insuficiente. */
  indexBps: number | null;
}

export interface SeasonalComponent {
  status: SeasonalityStatus;
  /** Por que não há padrão/amostra; null quando `seasonal`. */
  reason: string | null;
  /** Variação explicada pelos grupos (η²) em pontos-base; null quando insuficiente. */
  strengthBps: number | null;
  groups: SeasonalGroup[];
}

export interface SeasonalOutlier {
  date: ISODate;
  weekday: number;
  valueCents: bigint;
  /** Mediana do mesmo dia da semana, usada como referência. */
  medianCents: bigint;
  /** true = dia sem venda preenchido com zero (lacuna), não uma venda registrada. */
  filled: boolean;
}

export interface SeasonalityResult {
  cutoff: ISODate;
  trainFrom: ISODate | null;
  trainTo: ISODate | null;
  days: number;
  observedDays: number;
  filledDays: number;
  weekly: SeasonalComponent;
  monthly: SeasonalComponent;
  outliers: SeasonalOutlier[];
  warnings: string[];
}

export interface SeasonalityOptions {
  /** Data de corte (inclusiva): vendas posteriores nunca entram. */
  cutoff: ISODate;
  missingDays?: MissingDayPolicy;
  /** Padrão true. false existe para provar (em teste) o efeito da exclusão. */
  excludeOutliers?: boolean;
}

const WEEKDAY_LABELS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const PERIOD_LABELS = ['Dias 1 a 10', 'Dias 11 a 20', 'Dia 21 ao fim'];

function assertCutoff(cutoff: ISODate): void {
  if (!isValidISODate(cutoff)) throw new RangeError(`Data de corte inválida: ${JSON.stringify(cutoff)}`);
}

/**
 * Série de treino ao corte. Com a política `zero`, vai da 1ª venda ≤ corte ATÉ o corte (dias finais sem venda
 * são R$ 0 preenchidos); com `ignore`, só dias observados. Vendas posteriores ao corte são descartadas ANTES de
 * montar a série (alterar o futuro nunca muda o passado).
 */
export function buildTrainingSeries(
  sales: readonly Sale[],
  cutoff: ISODate,
  policy: MissingDayPolicy = 'zero',
): SalesPoint[] {
  assertCutoff(cutoff);
  const series = buildSalesSeries(
    sales.filter((s) => s.saleDate <= cutoff),
    policy,
  );
  const last = series[series.length - 1];
  if (policy === 'ignore' || last === undefined) return series;
  const trailing = daysBetween(last.date, cutoff);
  for (let i = 1; i <= trailing; i += 1) {
    series.push({ date: addDays(last.date, i), grossCents: 0n, saleIds: [], filled: true });
  }
  return series;
}

function median(values: readonly bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as bigint) : divRound((sorted[mid - 1] as bigint) + (sorted[mid] as bigint), 2n);
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

/** Outliers por dia da semana (só em grupos com observações suficientes para estimar dispersão). */
function detectOutliers(series: readonly SalesPoint[]): SeasonalOutlier[] {
  const byWeekday = new Map<number, SalesPoint[]>();
  for (const p of series) {
    const w = weekdayOf(p.date);
    byWeekday.set(w, [...(byWeekday.get(w) ?? []), p]);
  }
  const out: SeasonalOutlier[] = [];
  for (const [weekday, points] of byWeekday) {
    if (points.length < MIN_WEEKDAY_OBSERVATIONS) continue;
    const med = median(points.map((p) => p.grossCents));
    const mad = median(points.map((p) => abs(p.grossCents - med)));
    const sigma = divRound(mad * MAD_TO_SIGMA_X10000, 10_000n);
    const floor = divRound(abs(med) * SCALE_FLOOR_PCT, 100n);
    const scale = [sigma, floor, 1n].reduce((a, b) => (a > b ? a : b));
    for (const p of points) {
      if (abs(p.grossCents - med) * 2n > OUTLIER_FACTOR_X2 * scale) {
        out.push({ date: p.date, weekday, valueCents: p.grossCents, medianCents: med, filled: p.filled });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}

/**
 * Força = SQ entre grupos ÷ SQ total (η²). Tudo em inteiros: as somas de quadrados são multiplicadas por um
 * denominador comum D = mmc(N, n₁…n_g), então não há divisão inexata nem ponto flutuante.
 */
function strengthOf(groups: readonly (readonly bigint[])[]): { ssb: bigint; sst: bigint } {
  const n = groups.reduce((acc, g) => acc + BigInt(g.length), 0n);
  let d = n;
  for (const g of groups) if (g.length > 0) d = (d * BigInt(g.length)) / gcd(d, BigInt(g.length));
  const all = groups.flat();
  const sum = all.reduce((a, x) => a + x, 0n);
  const sumSq = all.reduce((a, x) => a + x * x, 0n);
  const common = (d / n) * sum * sum;
  const sst = d * sumSq - common;
  const ssb =
    groups.reduce((acc, g) => {
      if (g.length === 0) return acc;
      const s = g.reduce((a, x) => a + x, 0n);
      return acc + (d / BigInt(g.length)) * s * s;
    }, 0n) - common;
  return { ssb, sst };
}

interface RawGroup {
  key: number;
  label: string;
  values: bigint[];
  excluded: number;
}

function insufficient(groups: readonly RawGroup[], reason: string): SeasonalComponent {
  return {
    status: 'insufficient_data',
    reason,
    strengthBps: null,
    groups: groups.map((g) => ({
      key: g.key,
      label: g.label,
      observations: g.values.length,
      excluded: g.excluded,
      meanCents: null,
      indexBps: null,
    })),
  };
}

/** Passo final comum: com amostra aceita, calcula médias, índices, força e decide `seasonal`/`not_seasonal`. */
function evaluateGroups(groups: readonly RawGroup[], what: string): SeasonalComponent {
  const all = groups.flatMap((g) => g.values);
  const total = all.reduce((a, x) => a + x, 0n);
  if (total <= 0n) return insufficient(groups, 'A média do período é zero: não há índice sazonal a calcular.');
  const n = BigInt(all.length);
  const { ssb, sst } = strengthOf(groups.map((g) => g.values));
  const describe = groups.map<SeasonalGroup>((g) => {
    const s = g.values.reduce((a, x) => a + x, 0n);
    return {
      key: g.key,
      label: g.label,
      observations: g.values.length,
      excluded: g.excluded,
      meanCents: divRound(s, BigInt(g.values.length)),
      indexBps: Number(divRound(s * 10_000n * n, BigInt(g.values.length) * total)),
    };
  });
  if (sst === 0n) {
    return {
      status: 'not_seasonal',
      reason: `Série constante: todos os dias valem o mesmo, não há padrão ${what}.`,
      strengthBps: 0,
      groups: describe,
    };
  }
  const strengthBps = Number(divRound(ssb * 10_000n, sst));
  if (ssb * 10_000n >= BigInt(MIN_SEASONAL_STRENGTH_BPS) * sst) {
    return { status: 'seasonal', reason: null, strengthBps, groups: describe };
  }
  return {
    status: 'not_seasonal',
    reason: `Dados sem padrão ${what} claro: a diferença entre os grupos explica ${(strengthBps / 100).toFixed(1).replace('.', ',')}% da variação (mínimo ${MIN_SEASONAL_STRENGTH_BPS / 100}%). Heurística, não teste estatístico.`,
    strengthBps,
    groups: describe,
  };
}

const periodOf = (date: ISODate): number => {
  const day = Number(date.slice(8, 10));
  return day <= 10 ? 1 : day <= 20 ? 2 : 3;
};

/**
 * Sazonalidade ao corte. Nunca lança por falta de dados (devolve `insufficient_data` com motivo); só lança
 * RangeError para corte inválido.
 */
export function analyzeSeasonality(sales: readonly Sale[], options: SeasonalityOptions): SeasonalityResult {
  const { cutoff, missingDays = 'zero', excludeOutliers = true } = options;
  const series = buildTrainingSeries(sales, cutoff, missingDays);
  const filledDays = series.filter((p) => p.filled).length;
  const warnings: string[] = [];
  const outliers = detectOutliers(series);
  const excludedDates = new Set(excludeOutliers ? outliers.map((o) => o.date) : []);
  const usable = series.filter((p) => !excludedDates.has(p.date));

  const weeklyRaw: RawGroup[] = WEEKDAY_LABELS.map((label, key) => ({
    key,
    label,
    values: usable.filter((p) => weekdayOf(p.date) === key).map((p) => p.grossCents),
    excluded: series.filter((p) => weekdayOf(p.date) === key && excludedDates.has(p.date)).length,
  }));
  const monthlyRaw: RawGroup[] = PERIOD_LABELS.map((label, i) => ({
    key: i + 1,
    label,
    values: usable.filter((p) => periodOf(p.date) === i + 1).map((p) => p.grossCents),
    excluded: series.filter((p) => periodOf(p.date) === i + 1 && excludedDates.has(p.date)).length,
  }));

  /** Verificações comuns às duas análises; devolve o motivo da insuficiência ou null. */
  const commonReason = (): string | null => {
    if (series.length === 0) return 'Sem vendas até a data de corte.';
    if (filledDays * 10_000 > MAX_FILLED_SHARE_BPS * series.length) {
      return `Muitas lacunas: ${filledDays} de ${series.length} dias sem venda (limite ${MAX_FILLED_SHARE_BPS / 100}%).`;
    }
    return null;
  };

  let weekly: SeasonalComponent;
  const common = commonReason();
  if (common !== null) {
    weekly = insufficient(weeklyRaw, common);
  } else if (series.length < MIN_WEEKLY_DAYS) {
    weekly = insufficient(
      weeklyRaw,
      `Série de ${series.length} dias; são necessários ao menos ${MIN_WEEKLY_DAYS} dias (4 ciclos semanais) para falar em padrão semanal.`,
    );
  } else {
    const thin = weeklyRaw.find((g) => g.values.length < MIN_WEEKDAY_OBSERVATIONS);
    weekly = thin
      ? insufficient(
          weeklyRaw,
          `O dia «${thin.label}» tem só ${thin.values.length} observações utilizáveis (mínimo ${MIN_WEEKDAY_OBSERVATIONS}).`,
        )
      : evaluateGroups(weeklyRaw, 'semanal');
  }

  let monthly: SeasonalComponent;
  if (common !== null) {
    monthly = insufficient(monthlyRaw, common);
  } else {
    const cycles = PERIOD_LABELS.map((_, i) => {
      const perMonth = new Map<string, number>();
      for (const p of usable) {
        if (periodOf(p.date) === i + 1) perMonth.set(p.date.slice(0, 7), (perMonth.get(p.date.slice(0, 7)) ?? 0) + 1);
      }
      return [...perMonth.values()].filter((n) => n >= MIN_PERIOD_DAYS_PER_MONTH).length;
    });
    monthly = cycles.some((c) => c < MIN_PERIOD_MONTHS)
      ? insufficient(
          monthlyRaw,
          `Período do mês exige ao menos ${MIN_PERIOD_MONTHS} meses com ${MIN_PERIOD_DAYS_PER_MONTH}+ dias em cada período; a amostra tem ${cycles.join(', ')}.`,
        )
      : evaluateGroups(monthlyRaw, 'por período do mês');
  }

  if (filledDays > 0) {
    warnings.push(
      `${filledDays} dia${filledDays > 1 ? 's' : ''} sem venda tratado${filledDays > 1 ? 's' : ''} como R$ 0 (dia sem movimento); confira se eram dias fechados ou falta de dados.`,
    );
  }
  if (excludedDates.size > 0) {
    warnings.push(
      `${excludedDates.size} valor${excludedDates.size > 1 ? 'es' : ''} atípico${excludedDates.size > 1 ? 's' : ''} excluído${excludedDates.size > 1 ? 's' : ''} do cálculo do índice (listados em "outliers").`,
    );
  }

  const first = series[0];
  const last = series[series.length - 1];
  return {
    cutoff,
    trainFrom: first?.date ?? null,
    trainTo: last?.date ?? null,
    days: series.length,
    observedDays: series.length - filledDays,
    filledDays,
    weekly,
    monthly,
    outliers,
    warnings,
  };
}
