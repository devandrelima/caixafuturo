import { Fragment, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatBR } from '../domain/finance/dates';
import { EMPTY_FILTER, ORIGIN_LABELS, applyFilter, categoriesOf, isFilterActive, originsOf, summarizeEntries } from '../domain/finance/filters';
import type { EntryFilter, EntryTrace } from '../domain/finance/filters';
import { formatBRL } from '../domain/finance/money';
import type { CashEntry } from '../domain/finance/types';
import { DetailFilters } from './DetailFilters';
import { riskLabel } from './riskText';
import { CfBadge, CfButton, CfCard } from './ui/UiPrimitives';

export interface EntriesPanelProps {
  /** Lançamentos gravados + ocorrências calculadas de recorrências, já ordenados. */
  entries: readonly CashEntry[];
  /** IDs de ocorrências calculadas pela regra (somente leitura aqui; a regra é gerida no Calendário). */
  calculatedIds?: ReadonlySet<string>;
  /** IDs agendados até a data-base (fora da projeção). */
  flaggedIds: ReadonlySet<string>;
  /** De onde vem cada lançamento no saldo (resposta do motor). */
  trace?: (entry: CashEntry) => EntryTrace;
  /** Alerta global de risco, mostrado sempre, fora do filtro. */
  globalAlert?: ReactNode;
  disabled?: boolean;
  onAdd: () => void;
  onPickCsv: (file: File) => void;
  onEdit: (entry: CashEntry) => void;
  onDelete: (entry: CashEntry) => void;
}

function traceText(t: EntryTrace): string {
  switch (t.kind) {
    case 'in_projection':
      return `Entra no saldo de ${formatBR(t.date)} (fechamento do dia: ${formatBRL(t.closingCents)} — ${riskLabel(t.risk)}).`;
    case 'settled':
      return 'Liquidado: já está refletido no saldo inicial e não entra de novo.';
    case 'before_base_date':
      return 'Vence até a data-base: fora da projeção; confira se já está no saldo informado.';
    case 'beyond_horizon':
      return 'Vence depois das 13 semanas: ainda não entra em nenhum saldo.';
    case 'duplicate':
      return `Duplicado do lançamento ${t.duplicateOf} (mesma chave de origem): não soma de novo.`;
    case 'not_counted':
      return 'Não está sendo contado na projeção.';
  }
}

export function EntriesPanel({ entries, calculatedIds, flaggedIds, trace, globalAlert, disabled = false, onAdd, onPickCsv, onEdit, onDelete }: EntriesPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<EntryFilter>(EMPTY_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = useMemo(() => applyFilter(entries, filter), [entries, filter]);
  const summary = useMemo(() => summarizeEntries(shown), [shown]);
  const categories = useMemo(() => categoriesOf(entries), [entries]);
  const origins = useMemo(() => originsOf(entries), [entries]);
  const isCalculated = (e: CashEntry) => calculatedIds?.has(e.id) ?? false;

  return (
    <CfCard
      title="Lançamentos"
      description="Contas a pagar e a receber. Editar ou excluir recalcula o painel."
      actions={
        <>
          <CfButton variant="primary" onClick={onAdd} disabled={disabled}>
            Adicionar lançamento
          </CfButton>
          <CfButton variant="secondary" onClick={() => fileRef.current?.click()} disabled={disabled}>
            Importar CSV
          </CfButton>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="cf-visually-hidden"
            aria-label="Arquivo CSV de contas"
            data-testid="csv-input"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onPickCsv(file);
            }}
          />
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="cf-muted">Nenhum lançamento ainda. Adicione um manualmente ou importe um CSV (colunas: tipo, descricao, valor, vencimento, categoria, identificador_externo).</p>
      ) : (
        <div className="cf-stack">
          <DetailFilters filter={filter} onChange={setFilter} categories={categories} origins={origins} shown={shown.length} total={entries.length} globalAlert={globalAlert} />

          <p data-testid="entries-summary" aria-live="polite">
            <strong>{summary.count}</strong> lançamento{summary.count === 1 ? '' : 's'} listado{summary.count === 1 ? '' : 's'} · entradas <strong>{formatBRL(summary.incomingCents)}</strong> · saídas{' '}
            <strong>{formatBRL(summary.outgoingCents)}</strong> · líquido <strong>{formatBRL(summary.netCents)}</strong>
            {summary.settledCount > 0 && <span className="cf-subtle"> (inclui {summary.settledCount} liquidado{summary.settledCount === 1 ? '' : 's'}, que não entra{summary.settledCount === 1 ? '' : 'm'} no saldo)</span>}
          </p>

          {shown.length === 0 ? (
            <p className="cf-muted">{isFilterActive(filter) ? 'Nenhum lançamento atende aos filtros. Use "Limpar filtros" para ver todos.' : 'Nenhum lançamento.'}</p>
          ) : (
            <div className="cf-table-wrap">
              <table className="cf-table" aria-label="Lançamentos">
                <thead>
                  <tr>
                    <th scope="col">Vencimento</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Descrição</th>
                    <th scope="col">Categoria</th>
                    <th scope="col" className="cf-num">Valor</th>
                    <th scope="col">Origem</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => {
                    const calculated = isCalculated(e);
                    const open = openId === e.id;
                    return (
                      <Fragment key={e.id}>
                        <tr data-entry-id={e.id}>
                          <td>{formatBR(e.dueDate)}</td>
                          <td>{e.direction === 'in' ? 'Receber' : 'Pagar'}</td>
                          <td style={{ whiteSpace: 'normal' }}>{e.description}</td>
                          <td>{e.category || '—'}</td>
                          <td className="cf-num">{formatBRL(BigInt(e.amountCents))}</td>
                          <td>{ORIGIN_LABELS[e.origin]}</td>
                          <td>
                            {calculated ? (
                              <CfBadge tone="neutral">Calculada pela regra</CfBadge>
                            ) : e.state === 'settled' ? (
                              <CfBadge>Liquidado</CfBadge>
                            ) : flaggedIds.has(e.id) ? (
                              <CfBadge tone="warning">Fora da projeção (até a data-base)</CfBadge>
                            ) : (
                              <CfBadge tone="neutral">Agendado</CfBadge>
                            )}
                          </td>
                          <td>
                            <div className="cf-row">
                              {trace && (
                                <CfButton variant="ghost" onClick={() => setOpenId(open ? null : e.id)} aria-expanded={open} aria-controls={`detail-${e.id}`} aria-label={`Detalhes de ${e.description} em ${formatBR(e.dueDate)}`}>
                                  {open ? 'Ocultar' : 'Detalhes'}
                                </CfButton>
                              )}
                              {!calculated && (
                                <>
                                  <CfButton variant="ghost" onClick={() => onEdit(e)} disabled={disabled} aria-label={`Editar ${e.description}`}>
                                    Editar
                                  </CfButton>
                                  <CfButton variant="ghost" onClick={() => onDelete(e)} disabled={disabled} aria-label={`Excluir ${e.description}`}>
                                    Excluir
                                  </CfButton>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {open && trace && (
                          <tr>
                            <td colSpan={8} id={`detail-${e.id}`} style={{ whiteSpace: 'normal' }}>
                              <div className="cf-subcard" data-testid="entry-detail">
                                <p>{traceText(trace(e))}</p>
                                {calculated && <p>Ocorrência calculada pela regra recorrente; não está gravada. Para alterá-la, edite a regra ou pule esta data em Calendário.</p>}
                                <p className="cf-subtle">
                                  Identificador {e.id} · chave de origem {e.sourceKey}
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </CfCard>
  );
}
