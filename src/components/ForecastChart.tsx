import { useEffect, useRef, useState } from 'react';
import { formatBRL } from '../domain/finance/money';
import type { ISODate } from '../domain/finance/types';
import { formatAxisBRL, shortDate } from './riskText';

export interface ForecastChartPoint {
  date: ISODate;
  centralCents: bigint;
  lowerCents: bigint | null;
  upperCents: bigint | null;
}
export interface ForecastChartHistory {
  date: ISODate;
  cents: bigint;
}

export interface ForecastChartProps {
  /** Faturamento bruto realizado (últimos dias até a data-base). */
  history: readonly ForecastChartHistory[];
  /** Previsão do modelo escolhido, a partir do dia seguinte à data-base. */
  points: readonly ForecastChartPoint[];
}

const HEIGHT = 280;
const M = { left: 72, right: 16, top: 16, bottom: 34 };

function useWidth(ref: React.RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setWidth(Math.max(280, Math.floor(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function niceStep(range: number): number {
  const rough = range / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const base = rough / pow;
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Gráfico simples: faturamento realizado (linha cinza contínua), previsão central (linha dourada com marcadores) e,
 * só quando existe erro medido, a faixa dos erros passados (área clara entre linhas pontilhadas). Apenas DESENHA os
 * valores do domínio; os `number` servem só para posição em pixels. Nada é distinguido apenas por cor: estilos de
 * linha, marcadores e legenda textual. Os mesmos valores estão na tabela da tela. Método sofisticado não ganha
 * decoração: o desenho é o mesmo para todos os modelos.
 */
export function ForecastChart({ history, points }: ForecastChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef, 720);
  const all = [...history.map((h) => h.date), ...points.map((p) => p.date)];
  const n = all.length;
  const hasBand = points.some((p) => p.lowerCents !== null && p.upperCents !== null);

  const values: number[] = [
    ...history.map((h) => Number(h.cents)),
    ...points.flatMap((p) => [Number(p.centralCents), p.lowerCents === null ? 0 : Number(p.lowerCents), p.upperCents === null ? 0 : Number(p.upperCents)]),
  ];
  const hi = Math.max(1, ...values);
  const step = niceStep(hi);
  const yMax = Math.ceil(hi / step) * step;
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;
  const ticks: number[] = [];
  for (let t = 0; t <= yMax + step / 2; t += step) ticks.push(t);

  const line = (pairs: readonly (readonly [number, number])[]) => pairs.map(([i, v], k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const historyPath = line(history.map((h, i) => [i, Number(h.cents)] as const));
  const offset = history.length;
  const centralPath = line(points.map((p, i) => [offset + i, Number(p.centralCents)] as const));
  const banded = points.map((p, i) => ({ i: offset + i, lo: p.lowerCents, up: p.upperCents })).filter((b) => b.lo !== null && b.up !== null) as { i: number; lo: bigint; up: bigint }[];
  const upperPath = line(banded.map((b) => [b.i, Number(b.up)] as const));
  const lowerPath = line(banded.map((b) => [b.i, Number(b.lo)] as const));
  const area = banded.length > 1 ? `${upperPath} ${[...banded].reverse().map((b) => `L${x(b.i).toFixed(1)},${y(Number(b.lo)).toFixed(1)}`).join(' ')} Z` : '';
  // rótulos de data: início, data-base e fim; o da data-base some quando ficaria colado ao último (< 60 px)
  const stepPx = n > 1 ? plotW / (n - 1) : plotW;
  const baseIdx = Math.max(0, offset - 1);
  const xLabels = [0, baseIdx, n - 1].filter((v, i, a) => n > 0 && a.indexOf(v) === i && (v !== baseIdx || v === 0 || v === n - 1 || ((n - 1 - v) * stepPx >= 60 && v * stepPx >= 60)));
  const firstForecast = points[0];
  const lastForecast = points[points.length - 1];

  const summary =
    `Gráfico de faturamento bruto: linha cinza com o realizado dos últimos ${history.length} dias e linha dourada com a previsão central de ${points.length} dias` +
    (hasBand ? ', com área clara entre linhas pontilhadas mostrando a faixa dos erros passados.' : '; sem faixa, porque não há erro medido suficiente.') +
    (firstForecast && lastForecast
      ? ` Primeiro dia previsto ${formatBRL(firstForecast.centralCents)}, último ${formatBRL(lastForecast.centralCents)}.`
      : '');

  return (
    <div ref={wrapRef} className="cf-chart">
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={summary}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="cf-chart__grid" />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="cf-chart__tick">
              {formatAxisBRL(t)}
            </text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text key={i} x={x(i)} y={HEIGHT - 10} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="cf-chart__tick">
            {shortDate(all[i] as ISODate)}
          </text>
        ))}
        {offset > 0 && points.length > 0 && (
          <g>
            <line x1={x(offset - 0.5)} x2={x(offset - 0.5)} y1={M.top} y2={M.top + plotH} className="cf-fc__divider" />
            <text x={x(offset - 0.5) + 6} y={M.top + 12} className="cf-chart__tick">
              Previsão →
            </text>
          </g>
        )}
        {area && <path d={area} className="cf-fc__band" />}
        {banded.length > 1 && <path d={upperPath} className="cf-fc__bound" />}
        {banded.length > 1 && <path d={lowerPath} className="cf-fc__bound" />}
        {history.length > 0 && <path d={historyPath} className="cf-fc__history" />}
        {points.length > 0 && <path d={centralPath} className="cf-fc__central" />}
        {points.map((p, i) => (
          <rect key={p.date} x={x(offset + i) - 3.5} y={y(Number(p.centralCents)) - 3.5} width={7} height={7} className="cf-fc__mark" transform={`rotate(45 ${x(offset + i)} ${y(Number(p.centralCents))})`} />
        ))}
      </svg>
      <ul className="cf-fc__legend" aria-label="Legenda do gráfico">
        <li>
          <span className="cf-fc__key cf-fc__key--history" aria-hidden="true" /> Linha cinza contínua: faturamento realizado
        </li>
        <li>
          <span className="cf-fc__key cf-fc__key--central" aria-hidden="true" /> Linha dourada com losangos: previsão central do modelo
        </li>
        <li>
          <span className="cf-fc__key cf-fc__key--band" aria-hidden="true" /> Área clara entre linhas pontilhadas: faixa dos erros passados (conservadora a otimista)
          {hasBand ? '' : ' — indisponível: sem erro medido suficiente'}
        </li>
      </ul>
    </div>
  );
}
