import { useState } from 'react';
import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { ProjectionResult } from '../domain/finance/projection';
import type { CashEntry, CashSettings, DailyPoint, ISODate } from '../domain/finance/types';
import { CashChart } from './CashChart';
import { RiskCalendar } from './RiskCalendar';
import { riskLabel, riskSentence, riskTone } from './riskText';
import { CfAlert, CfBadge, CfButton, CfCard } from './ui/UiPrimitives';

export interface CashDashboardProps {
  settings: CashSettings;
  result: ProjectionResult;
  entriesById: ReadonlyMap<string, CashEntry>;
  selectedDate: ISODate | null;
  onSelectDate: (date: ISODate) => void;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <CfCard>
      <div className="cf-stat">
        <span className="cf-stat__label">{label}</span>
        <span className="cf-stat__value">{value}</span>
        {note && <span className="cf-stat__note">{note}</span>}
      </div>
    </CfCard>
  );
}

function causes(point: DailyPoint, entriesById: ReadonlyMap<string, CashEntry>): string {
  const names = point.entryIds.map((id) => entriesById.get(id)?.description ?? id);
  return names.length > 0 ? names.join('; ') : 'saldo já abaixo do mínimo antes de novos lançamentos';
}

/** Painel de 30 dias. Todos os números vêm do motor (`ProjectionResult`); nada é recalculado aqui. */
export function CashDashboard({ settings, result, entriesById, selectedDate, onSelectDate }: CashDashboardProps) {
  const [showTable, setShowTable] = useState(false);
  const { points, summary, flagged, duplicates } = result;
  const last = points[points.length - 1];
  const minimum = BigInt(settings.minimumBalanceCents);
  const riskPoints = points.filter((p) => p.risk !== 'ok');
  const upcoming = points.filter((p) => p.entryIds.length > 0).slice(0, 5);
  const critical = summary.firstNegative ?? summary.firstRisk;

  return (
    <div className="cf-stack">
      {summary.firstRisk === null ? (
        <CfAlert tone="positive" title="Nenhum risco detectado nos próximos 30 dias com os dados informados">
          O cálculo usa apenas os lançamentos agendados e não é uma garantia.
        </CfAlert>
      ) : (
        <CfAlert tone={summary.firstNegative ? 'negative' : 'warning'} title={riskSentence(summary.firstNegative ?? summary.firstRisk)}>
          <p>
            {summary.firstRisk.risk === 'below_minimum' && summary.firstNegative && <>{riskSentence(summary.firstRisk)}. </>}
            Déficit para o mínimo: <strong>{formatBRL((summary.firstNegative ?? summary.firstRisk).shortfallCents)}</strong>. Origem: {causes(summary.firstNegative ?? summary.firstRisk, entriesById)}.
          </p>
        </CfAlert>
      )}

      {flagged.length > 0 && (
        <CfAlert tone="warning" title={`${flagged.length} lançamento(s) agendado(s) até a data-base não entram na projeção`}>
          Eles já deveriam estar refletidos no saldo informado. Revise-os em Movimentações: ajuste o vencimento ou exclua.
        </CfAlert>
      )}
      {duplicates.length > 0 && (
        <CfAlert tone="warning" title={`${duplicates.length} lançamento(s) duplicado(s) ignorado(s) no cálculo`}>
          Lançamentos com a mesma identificação são contados uma única vez.
        </CfAlert>
      )}

      <div className="cf-grid cf-grid--stats">
        <Stat label={`Saldo informado em ${formatBR(settings.baseDate)}`} value={formatBRL(summary.openingCents)} note="Saldo conciliado ao fim do dia" />
        <Stat
          label={last ? `Saldo projetado em ${formatBR(last.date)}` : 'Saldo projetado'}
          value={formatBRL(summary.endingCents)}
          note="Calculado sobre lançamentos agendados"
        />
        <Stat label="Menor saldo projetado" value={formatBRL(summary.lowest.closingCents)} note={`em ${formatBR(summary.lowest.date)}`} />
        <Stat
          label="Próxima data crítica"
          value={critical ? formatBR(critical.date) : 'Nenhuma'}
          note={critical ? `${riskLabel(critical.risk)} · déficit ${formatBRL(critical.shortfallCents)}` : `Mínimo: ${formatBRL(minimum)}`}
        />
      </div>

      <CfCard
        title="Projeção de caixa — próximos 30 dias"
        description={`De ${formatBR((points[0] as DailyPoint).date)} a ${formatBR((last as DailyPoint).date)}. Saldo mínimo de segurança: ${formatBRL(minimum)}.`}
        actions={
          <CfButton variant="secondary" aria-expanded={showTable} aria-controls="cf-tabela-projecao" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Ocultar tabela de valores' : 'Mostrar tabela de valores'}
          </CfButton>
        }
      >
        <CashChart points={points} minimumCents={minimum} />
        {showTable && (
          <div id="cf-tabela-projecao" className="cf-table-wrap" style={{ marginTop: 12 }}>
            <table className="cf-table" aria-label="Saldo projetado por dia">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col" className="cf-num">Abertura</th>
                  <th scope="col" className="cf-num">Entradas</th>
                  <th scope="col" className="cf-num">Saídas</th>
                  <th scope="col" className="cf-num">Saldo</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.date} data-date={p.date}>
                    <th scope="row">{formatBR(p.date)}</th>
                    <td className="cf-num">{formatBRL(p.openingCents)}</td>
                    <td className="cf-num">{formatBRL(p.incomingCents)}</td>
                    <td className="cf-num">{formatBRL(p.outgoingCents)}</td>
                    <td className="cf-num">{formatBRL(p.closingCents)}</td>
                    <td>{riskLabel(p.risk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CfCard>

      <div className="cf-grid cf-grid--two">
        <RiskCalendar baseDate={settings.baseDate} openingCents={summary.openingCents} points={points} entriesById={entriesById} selectedDate={selectedDate} onSelectDate={onSelectDate} firstRiskDate={summary.firstRisk?.date ?? null} />
        <CfCard title={riskPoints.length > 0 ? 'Alertas por data' : 'Próximos lançamentos'} description={riskPoints.length > 0 ? 'Dias abaixo do mínimo ou negativos, com a origem.' : 'Os próximos lançamentos agendados.'}>
          {(riskPoints.length > 0 ? riskPoints.slice(0, 8) : upcoming).length === 0 ? (
            <p className="cf-muted">Nenhum lançamento agendado nos próximos 30 dias.</p>
          ) : (
            <ul className="cf-list">
              {(riskPoints.length > 0 ? riskPoints.slice(0, 8) : upcoming).map((p) => (
                <li key={p.date}>
                  <div className="cf-row">
                    <strong>{formatBR(p.date)}</strong>
                    <CfBadge tone={riskTone(p.risk)}>{riskLabel(p.risk)}</CfBadge>
                  </div>
                  <div className="cf-muted">
                    Saldo {formatBRL(p.closingCents)}
                    {p.shortfallCents > 0n && <> · déficit {formatBRL(p.shortfallCents)}</>}
                  </div>
                  <div className="cf-subtle">{causes(p, entriesById)}</div>
                </li>
              ))}
            </ul>
          )}
        </CfCard>
      </div>
    </div>
  );
}
