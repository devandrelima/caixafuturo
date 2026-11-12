import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { DailyPoint } from '../domain/finance/types';
import { formatAxisBRL, riskLabel, shortDate } from './riskText';

export interface CashChartProps {
  points: readonly DailyPoint[];
  minimumCents: bigint;
}

const HEIGHT = 300;
const M = { left: 76, right: 16, top: 16, bottom: 34 };

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

/** Passo "bonito" (1, 2, 2.5, 5 × 10^n) para o eixo, em centavos. */
function niceStep(range: number): number {
  const rough = range / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const base = rough / pow;
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Gráfico de saldo diário (SVG). Apenas DESENHA os `closingCents` do motor: nenhum saldo é recalculado aqui.
 * Os números em `number` servem só para posição em pixels. Série única: sem legenda; a linha de mínimo é rotulada.
 * Risco é codificado por FORMA (quadrado = negativo, círculo = abaixo do mínimo) além da cor.
 */
export function CashChart({ points, minimumCents }: CashChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef, 720);
  const [active, setActive] = useState<number | null>(null);
  const descId = useId();

  const n = points.length;
  const values = points.map((p) => Number(p.closingCents));
  const minimum = Number(minimumCents);
  const lo = Math.min(0, minimum, ...values);
  const hi = Math.max(0, minimum, ...values);
  const step = niceStep(hi - lo || 100000);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step || step;
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const ticks: number[] = [];
  for (let t = yMin; t <= yMax + step / 2; t += step) ticks.push(t);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(p.closingCents)).toFixed(1)}`).join(' ');
  const xLabels = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => n > 0 && a.indexOf(v) === i);
  const current = active === null ? null : (points[active] ?? null);

  function indexFromPointer(event: PointerEvent<SVGSVGElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = ((event.clientX - rect.left) / rect.width) * width - M.left;
    return Math.min(n - 1, Math.max(0, Math.round((relative / plotW) * (n - 1))));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (n === 0) return;
    const move = (to: number) => {
      event.preventDefault();
      setActive(Math.min(n - 1, Math.max(0, to)));
    };
    if (event.key === 'ArrowRight') move((active ?? -1) + 1);
    else if (event.key === 'ArrowLeft') move((active ?? n) - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(n - 1);
    else if (event.key === 'Escape') setActive(null);
  }

  const tooltipLeft = current ? Math.min(Math.max(x(active ?? 0) - 90, 4), Math.max(4, width - 184)) : 0;

  return (
    <div ref={wrapRef} className="cf-chart">
      <div
        className="cf-chart__focus"
        tabIndex={0}
        role="group"
        aria-label="Gráfico do saldo projetado dos próximos 30 dias. Use as setas para percorrer os dias."
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label="Linha com o saldo de fechamento de cada dia, linha tracejada do saldo mínimo e marcadores nos dias de risco."
          onPointerMove={(e) => setActive(indexFromPointer(e))}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="cf-chart__grid" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="cf-chart__tick">
                {formatAxisBRL(t)}
              </text>
            </g>
          ))}
          {lo < 0 && <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} className="cf-chart__zero" />}
          <line x1={M.left} x2={width - M.right} y1={y(minimum)} y2={y(minimum)} className="cf-chart__min" />
          <text x={width - M.right} y={y(minimum) - 6} textAnchor="end" className="cf-chart__minlabel">
            Mínimo {formatBRL(minimumCents)}
          </text>
          {xLabels.map((i) => (
            <text key={i} x={x(i)} y={HEIGHT - 10} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="cf-chart__tick">
              {shortDate((points[i] as DailyPoint).date)}
            </text>
          ))}
          {n > 0 && <path d={path} className="cf-chart__line" />}
          {points.map((p, i) =>
            p.risk === 'negative' ? (
              <rect key={p.date} x={x(i) - 5} y={y(Number(p.closingCents)) - 5} width={10} height={10} className="cf-chart__mark cf-chart__mark--neg" />
            ) : p.risk === 'below_minimum' ? (
              <circle key={p.date} cx={x(i)} cy={y(Number(p.closingCents))} r={5} className="cf-chart__mark cf-chart__mark--warn" />
            ) : null,
          )}
          {current && active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} className="cf-chart__cross" />
              <circle cx={x(active)} cy={y(Number(current.closingCents))} r={5} className="cf-chart__hover" />
            </g>
          )}
        </svg>
        {current && (
          <div className="cf-chart__tip" style={{ left: tooltipLeft }} role="status">
            <strong>{formatBR(current.date)}</strong>
            <span>Saldo projetado: {formatBRL(current.closingCents)}</span>
            <span>{riskLabel(current.risk)}</span>
          </div>
        )}
      </div>
      <p id={descId} className="cf-subtle">
        ■ saldo negativo · ● abaixo do mínimo · linha tracejada: saldo mínimo. Os mesmos valores estão na tabela abaixo.
      </p>
    </div>
  );
}
