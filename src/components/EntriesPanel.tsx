import { useRef } from 'react';
import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { CashEntry } from '../domain/finance/types';
import { CfBadge, CfButton, CfCard } from './ui/UiPrimitives';

export interface EntriesPanelProps {
  entries: readonly CashEntry[];
  /** IDs agendados até a data-base (fora da projeção). */
  flaggedIds: ReadonlySet<string>;
  disabled?: boolean;
  onAdd: () => void;
  onPickCsv: (file: File) => void;
  onEdit: (entry: CashEntry) => void;
  onDelete: (entry: CashEntry) => void;
}

const ORIGIN_LABEL: Record<CashEntry['origin'], string> = { manual: 'Manual', csv: 'CSV', demo: 'Demonstração', sale: 'Venda', recurring: 'Recorrente' };

export function EntriesPanel({ entries, flaggedIds, disabled = false, onAdd, onPickCsv, onEdit, onDelete }: EntriesPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
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
              {entries.map((e) => (
                <tr key={e.id} data-entry-id={e.id}>
                  <td>{formatBR(e.dueDate)}</td>
                  <td>{e.direction === 'in' ? 'Receber' : 'Pagar'}</td>
                  <td style={{ whiteSpace: 'normal' }}>{e.description}</td>
                  <td>{e.category || '—'}</td>
                  <td className="cf-num">{formatBRL(BigInt(e.amountCents))}</td>
                  <td>{ORIGIN_LABEL[e.origin]}</td>
                  <td>
                    {e.state === 'settled' ? <CfBadge>Liquidado</CfBadge> : flaggedIds.has(e.id) ? <CfBadge tone="warning">Fora da projeção (até a data-base)</CfBadge> : <CfBadge tone="neutral">Agendado</CfBadge>}
                  </td>
                  <td>
                    <div className="cf-row">
                      <CfButton variant="ghost" onClick={() => onEdit(e)} disabled={disabled} aria-label={`Editar ${e.description}`}>
                        Editar
                      </CfButton>
                      <CfButton variant="ghost" onClick={() => onDelete(e)} disabled={disabled} aria-label={`Excluir ${e.description}`}>
                        Excluir
                      </CfButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CfCard>
  );
}
