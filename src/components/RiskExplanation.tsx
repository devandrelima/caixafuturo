import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { CashEntry, DailyPoint } from '../domain/finance/types';
import type { ReceivableView } from '../domain/sales/types';
import { riskLabel } from './riskText';
import { CfBadge } from './ui/UiPrimitives';

export interface RiskExplanationProps {
  points: readonly DailyPoint[];
  entriesById: ReadonlyMap<string, CashEntry>;
  /** Recebíveis derivados de vendas e sua situação (para listar o que NÃO entrou no saldo). */
  receivables: readonly ReceivableView[];
  /** Máximo de datas de risco detalhadas. */
  limit?: number;
}

const ORIGIN: Record<CashEntry['origin'], string> = {
  manual: 'Manual',
  csv: 'Importado (CSV)',
  demo: 'Demonstração fictícia',
  sale: 'Estimado (derivado de venda)',
  recurring: 'Recorrente',
};

const EXCLUDED_REASON: Partial<Record<ReceivableView['status'], string>> = {
  pending: 'conciliação pendente: só a conta importada entra no saldo até você decidir',
  covered_batch: 'lote não suportado: vale a conta importada',
  covered_installments: 'parcelas não suportadas: valem as contas importadas',
  reconciled: 'conciliado com conta importada: vale o valor importado',
};

/**
 * Explica cada data de risco com o que foi considerado (lançamentos, origem, valores) e o que ficou de fora.
 * Só apresenta números que já vêm do motor; não recalcula saldos.
 */
export function RiskExplanation({ points, entriesById, receivables, limit = 8 }: RiskExplanationProps) {
  const risky = points.filter((p) => p.risk !== 'ok');
  if (risky.length === 0) return null;
  const excluded = receivables.filter((r) => EXCLUDED_REASON[r.status] && r.status !== 'reconciled');
  return (
    <section className="cf-card" aria-labelledby="cf-risk-explanation-title">
      <div className="cf-card__head">
        <div>
          <h2 className="cf-card__title" id="cf-risk-explanation-title">
            Por que há risco nestas datas?
          </h2>
          <p className="cf-card__desc">Abra uma data para ver os lançamentos considerados, a origem de cada um e o que ficou de fora.</p>
        </div>
      </div>
      <div className="cf-stack">
        {risky.slice(0, limit).map((p) => (
          <details className="cf-details" key={p.date} data-date={p.date}>
            <summary>{`${formatBR(p.date)} · ${riskLabel(p.risk)}`}</summary>
            <div className="cf-details__body">
              <p>
                Saldo de abertura <strong>{formatBRL(p.openingCents)}</strong>
              </p>
              {p.entryIds.length === 0 ? (
                <p className="cf-muted">Nenhum lançamento nesta data: o saldo já vinha abaixo do esperado.</p>
              ) : (
                <ul className="cf-list">
                  {p.entryIds.map((id) => {
                    const e = entriesById.get(id);
                    return (
                      <li key={id}>
                        <div className="cf-row">
                          <span>{e?.direction === 'in' ? '+' : '−'}</span>
                          <strong>{e?.description ?? id}</strong>
                          <span>{e ? formatBRL(BigInt(e.amountCents)) : ''}</span>
                          {e && <CfBadge tone={e.origin === 'sale' ? 'warning' : 'neutral'}>{ORIGIN[e.origin]}</CfBadge>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p>
                Saldo de fechamento <strong>{formatBRL(p.closingCents)}</strong>
                {p.shortfallCents > 0n && <> · Déficit para o mínimo: <strong>{formatBRL(p.shortfallCents)}</strong></>}
              </p>
            </div>
          </details>
        ))}
        {risky.length > limit && <p className="cf-subtle">Mostrando {limit} de {risky.length} datas em risco.</p>}
        <div>
          <h3 className="cf-card__title">Hipóteses e exclusões</h3>
          <ul className="cf-list">
            <li>Nenhuma previsão manual ou hipótese entra neste saldo: só lançamentos agendados, contas importadas e repasses estimados de vendas importadas.</li>
            <li>Repasses marcados como “Estimado (derivado de venda)” dependem das taxas e prazos configurados; a data e o valor reais podem diferir.</li>
          </ul>
          {excluded.length > 0 && (
            <>
              <p>
                <strong>Não incluídos no saldo ({excluded.length}):</strong>
              </p>
              <ul className="cf-list">
                {excluded.slice(0, 8).map((r) => (
                  <li key={r.receivable.id}>
                    {`Venda ${r.receivable.externalId} (${formatBRL(r.receivable.netCents)} em ${formatBR(r.receivable.dueDate)}) — ${EXCLUDED_REASON[r.status]}`}
                  </li>
                ))}
              </ul>
              {excluded.length > 8 && <p className="cf-subtle">E mais {excluded.length - 8}. Veja todos em Vendas e recebimentos.</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
