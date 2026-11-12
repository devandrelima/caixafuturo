import { weeklyToCsv } from '../domain/export/csv';
import { formatBR } from '../domain/finance/dates';
import { ORIGIN_LABELS } from '../domain/finance/filters';
import { formatBRL } from '../domain/finance/money';
import type { CashEntry, ISODate } from '../domain/finance/types';
import type { WeekSummary, WeeklyView as WeeklyData } from '../domain/finance/weekly';
import { ExportMenu } from './ExportMenu';
import { riskLabel, riskTone, shortDate } from './riskText';
import { CfAlert, CfBadge, CfCard } from './ui/UiPrimitives';

export interface WeeklyViewProps {
  weekly: WeeklyData;
  /** Para nomear os lançamentos de cada semana (rastreio até a origem). */
  entriesById: ReadonlyMap<string, CashEntry>;
  /** Data-base, só para nomear o arquivo exportado. Sem ela não há botão de exportação. */
  baseDate?: ISODate;
  onDownload?: (filename: string, csv: string) => void;
}

const range = (w: WeekSummary) => `${shortDate(w.startDate)} a ${shortDate(w.endDate)}`;

/** Texto do alerta da semana: sempre com a data do pior dia e o valor (nunca só cor). */
function riskText(w: WeekSummary): string {
  if (w.risk === 'ok') return 'Sem alerta';
  return `${riskLabel(w.risk)} em ${shortDate(w.lowestDate)}: ${formatBRL(w.lowestClosingCents)}`;
}

/** Visão semanal (segunda a domingo) que apenas apresenta a agregação do mesmo cálculo diário do motor. */
export function WeeklyView({ weekly, entriesById, baseDate, onDownload }: WeeklyViewProps) {
  const { weeks } = weekly;
  const negative = weeks.find((w) => w.risk === 'negative');
  const below = weeks.find((w) => w.risk === 'below_minimum');

  return (
    <CfCard title="Próximas 13 semanas" description="Saldo ao fim de cada semana (segunda a domingo), somado a partir do mesmo cálculo diário do painel."
      actions={
        baseDate && weekly.weeks.length > 0 ? (
          <ExportMenu
            onDownload={onDownload}
            items={[
              {
                id: 'weekly',
                label: 'Fluxo das semanas',
                description: 'Uma semana por linha: abertura, entradas, saídas, saldo final, pior dia, risco e ids. Para análise; não é reimportável.',
                filename: `caixafuturo-13-semanas-${baseDate}.csv`,
                build: () => ({ csv: weeklyToCsv(weekly.weeks), rows: weekly.weeks.length }),
              },
            ]}
          />
        ) : undefined
      }
    >
      {weeks.length === 0 ? (
        <p className="cf-muted">Sem dados para exibir. Informe o saldo e cadastre lançamentos.</p>
      ) : (
        <div className="cf-stack">
          <CfAlert tone="warning" title="Quanto mais longe, maior a incerteza">
            <p>{weekly.uncertaintyNote}</p>
            <p>Premissas desta visão:</p>
            <ul>
              {weekly.premises.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </CfAlert>

          {negative ? (
            <CfAlert tone="negative" title="Alerta: saldo negativo no período">
              O saldo fica negativo na semana {negative.index} ({range(negative)}); o pior dia é {formatBR(negative.lowestDate)}, com {formatBRL(negative.lowestClosingCents)}. O alerta vale mesmo que a semana feche positiva.
            </CfAlert>
          ) : below ? (
            <CfAlert tone="warning" title="Alerta: saldo abaixo do mínimo no período">
              O saldo fica abaixo do mínimo na semana {below.index} ({range(below)}); o pior dia é {formatBR(below.lowestDate)}, com {formatBRL(below.lowestClosingCents)}.
            </CfAlert>
          ) : (
            <CfAlert tone="positive" title="Sem alerta nas 13 semanas">
              Nenhum dia fica abaixo do mínimo neste horizonte, com as premissas acima.
            </CfAlert>
          )}

          <div className="cf-table-wrap">
            <table className="cf-table cf-table--compact cf-table--stack" role="table" aria-label="Fluxo de caixa por semana">
              <thead>
                <tr>
                  <th scope="col">Semana</th>
                  <th scope="col" className="cf-num">Entradas</th>
                  <th scope="col" className="cf-num">Saídas</th>
                  <th scope="col" className="cf-num">Saldo final</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.index} data-week={w.index} role="row">
                    <th scope="row" role="rowheader" className="cf-wrap">
                      {w.index}ª · {range(w)}
                      {w.partial && <span className="cf-subtle"> (parcial: {w.days} dia{w.days === 1 ? '' : 's'})</span>}
                    </th>
                    <td className="cf-num" role="cell" data-label="Entradas">{formatBRL(w.incomingCents)}</td>
                    <td className="cf-num" role="cell" data-label="Saídas">{formatBRL(w.outgoingCents)}</td>
                    <td className="cf-num" role="cell" data-label="Saldo final">{formatBRL(w.closingCents)}</td>
                    <td className="cf-wrap" role="cell" data-label="Situação">
                      <CfBadge tone={riskTone(w.risk)}>{riskText(w)}</CfBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {weekly.beyondHorizon > 0 && (
            <p className="cf-muted">
              {weekly.beyondHorizon} lançamento(s) agendado(s) vence(m) depois da 13ª semana e ainda não entra(m) em nenhum saldo acima.
            </p>
          )}

          <div className="cf-stack" aria-label="Lançamentos de cada semana">
            {weeks.map((w) => (
              <details className="cf-details" key={w.index} data-week-detail={w.index}>
                <summary>{`${w.index}ª semana · ${range(w)} · ${w.entryIds.length} lançamento${w.entryIds.length === 1 ? '' : 's'}`}</summary>
                <div className="cf-details__body">
                  <p>
                    Abertura <strong>{formatBRL(w.openingCents)}</strong> + entradas <strong>{formatBRL(w.incomingCents)}</strong> − saídas <strong>{formatBRL(w.outgoingCents)}</strong> = saldo final{' '}
                    <strong>{formatBRL(w.closingCents)}</strong>.
                  </p>
                  {w.entryIds.length === 0 ? (
                    <p className="cf-muted">Nenhum lançamento nesta semana: o saldo se mantém.</p>
                  ) : (
                    <ul className="cf-list">
                      {w.entryIds.map((id) => {
                        const e = entriesById.get(id);
                        return (
                          <li key={id} data-entry-id={id}>
                            {e ? (
                              <>
                                <strong>{formatBR(e.dueDate)}</strong> · {e.direction === 'in' ? 'Receber' : 'Pagar'} {formatBRL(BigInt(e.amountCents))} · {e.description} <span className="cf-subtle">({ORIGIN_LABELS[e.origin]}, {e.sourceKey})</span>
                              </>
                            ) : (
                              <>Lançamento {id}</>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </CfCard>
  );
}
