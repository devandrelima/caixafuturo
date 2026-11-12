import { useEffect, useMemo, useState } from 'react';
import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { CashEntry, DailyPoint, ISODate } from '../domain/finance/types';
import { riskLabel, riskTone } from './riskText';
import { CfBadge, CfButton, CfCard } from './ui/UiPrimitives';

export interface RiskCalendarProps {
  /** Data-base (saldo informado ao fim do dia) e esse saldo, vindos das configurações/motor. */
  baseDate: ISODate;
  openingCents: bigint;
  points: readonly DailyPoint[];
  entriesById: ReadonlyMap<string, CashEntry>;
  selectedDate: ISODate | null;
  onSelectDate: (date: ISODate) => void;
  firstRiskDate: ISODate | null;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (n: number) => String(n).padStart(2, '0');
const monthKey = (iso: ISODate) => iso.slice(0, 7);

/** Calendário mensal que apenas apresenta os `DailyPoint[]` do motor (sem cálculo de saldo próprio). */
export function RiskCalendar({ baseDate, openingCents, points, entriesById, selectedDate, onSelectDate, firstRiskDate }: RiskCalendarProps) {
  const byDate = useMemo(() => new Map(points.map((p) => [p.date, p] as const)), [points]);
  const firstMonth = points[0] ? monthKey(baseDate) : null;
  const lastMonth = points.length > 0 ? monthKey((points[points.length - 1] as DailyPoint).date) : null;
  const [month, setMonth] = useState<string | null>(selectedDate ? monthKey(selectedDate) : firstMonth);

  useEffect(() => {
    if (selectedDate) setMonth(monthKey(selectedDate));
  }, [selectedDate]);

  if (!month || !firstMonth || !lastMonth) {
    return (
      <CfCard title="Calendário financeiro">
        <p className="cf-muted">Sem dados para exibir. Informe o saldo e cadastre lançamentos.</p>
      </CfCard>
    );
  }

  const [yearText, monthText] = month.split('-') as [string, string];
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const leading = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  const selected = selectedDate ? (byDate.get(selectedDate) ?? null) : null;
  const baseSelected = selectedDate === baseDate;

  return (
    <CfCard
      title="Calendário financeiro"
      description="Dias com lançamento ou risco nos próximos 30 dias."
      actions={
        firstRiskDate ? (
          <CfButton variant="secondary" onClick={() => onSelectDate(firstRiskDate)}>
            Ir para a próxima data crítica
          </CfButton>
        ) : undefined
      }
    >
      <div className="cf-cal__nav">
        <CfButton variant="ghost" aria-label="Mês anterior" disabled={month <= firstMonth} onClick={() => shift(-1)}>
          ‹
        </CfButton>
        <strong aria-live="polite">
          {MONTHS[monthNumber - 1]} de {year}
        </strong>
        <CfButton variant="ghost" aria-label="Próximo mês" disabled={month >= lastMonth} onClick={() => shift(1)}>
          ›
        </CfButton>
      </div>
      <div className="cf-cal__grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cf-cal__week" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const iso = `${month}-${pad(day)}`;
          const point = byDate.get(iso);
          if (iso === baseDate) {
            return (
              <button
                key={iso}
                type="button"
                className="cf-cal__day cf-cal__day--base"
                aria-pressed={baseSelected}
                aria-label={`${formatBR(iso)}, data-base, saldo informado ${formatBRL(openingCents)}`}
                onClick={() => onSelectDate(iso)}
              >
                <span>{day}</span>
                <span className="cf-cal__marks" aria-hidden="true">
                  base
                </span>
              </button>
            );
          }
          if (!point) {
            return (
              <span key={iso} className="cf-cal__day cf-cal__day--off" aria-hidden="true">
                {day}
              </span>
            );
          }
          const label = `${formatBR(iso)}, saldo ${formatBRL(point.closingCents)}, ${riskLabel(point.risk)}${point.incomingCents > 0n ? ', recebimento' : ''}${point.outgoingCents > 0n ? ', pagamento' : ''}`;
          return (
            <button
              key={iso}
              type="button"
              className={`cf-cal__day cf-cal__day--${point.risk}`}
              aria-pressed={iso === selectedDate}
              aria-label={label}
              onClick={() => onSelectDate(iso)}
            >
              <span>{day}</span>
              <span className="cf-cal__marks" aria-hidden="true">
                {point.risk === 'negative' ? '✕' : point.risk === 'below_minimum' ? '!' : ''}
                {point.incomingCents > 0n ? '↑' : ''}
                {point.outgoingCents > 0n ? '↓' : ''}
              </span>
            </button>
          );
        })}
      </div>
      <p className="cf-subtle">base data-base (saldo informado) · ✕ saldo negativo · ! abaixo do mínimo · ↑ recebimento · ↓ pagamento</p>

      {baseSelected && (
        <div className="cf-stack cf-cal__detail" aria-live="polite">
          <div className="cf-row">
            <h3 className="cf-card__title">{formatBR(baseDate)}</h3>
            <CfBadge tone="neutral">Data-base</CfBadge>
          </div>
          <p>
            Saldo informado ao fim do dia: <strong>{formatBRL(openingCents)}</strong> (conferido por você, não projetado)
          </p>
          <p className="cf-muted">A projeção começa no dia seguinte, com os lançamentos agendados a partir dele.</p>
        </div>
      )}

      {!baseSelected && selected && (
        <div className="cf-stack cf-cal__detail" aria-live="polite">
          <div className="cf-row">
            <h3 className="cf-card__title">{formatBR(selected.date)}</h3>
            <CfBadge tone={riskTone(selected.risk)}>{riskLabel(selected.risk)}</CfBadge>
          </div>
          <p>
            Saldo projetado ao fim do dia: <strong>{formatBRL(selected.closingCents)}</strong>
            {selected.shortfallCents > 0n && <> · faltam {formatBRL(selected.shortfallCents)} para o mínimo</>}
          </p>
          {selected.entryIds.length === 0 ? (
            <p className="cf-muted">Nenhum lançamento neste dia.</p>
          ) : (
            <ul className="cf-list">
              {selected.entryIds.map((id) => {
                const entry = entriesById.get(id);
                return (
                  <li key={id}>
                    {entry ? (
                      <>
                        {entry.direction === 'in' ? 'A receber' : 'A pagar'}: {entry.description} — {formatBRL(BigInt(entry.amountCents))}
                      </>
                    ) : (
                      id
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </CfCard>
  );
}
