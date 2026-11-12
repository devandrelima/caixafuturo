import { useState } from 'react';
import type { FormEvent } from 'react';
import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { CashEntry } from '../domain/finance/types';
import type { ReconcileResult } from '../domain/sales/reconcile';
import { MAX_LAG_DAYS, validateRules } from '../domain/sales/settlement';
import { PAYMENT_METHODS } from '../domain/sales/types';
import type { EntryLinkKind, PaymentMethod, ReceivableStatus, ReconciliationDecision, SettlementRules } from '../domain/sales/types';
import type { Tone } from './ui/UiPrimitives';
import { CfAlert, CfBadge, CfButton, CfCard, CfField } from './ui/UiPrimitives';

export const METHOD_LABEL: Record<PaymentMethod, string> = { pix: 'Pix', debit: 'Débito', credit: 'Crédito', voucher: 'Voucher', cash: 'Dinheiro' };

const STATUS_LABEL: Record<ReceivableStatus, { text: string; tone: Tone }> = {
  derived: { text: 'Derivado (estimativa)', tone: 'neutral' },
  reconciled: { text: 'Conciliado', tone: 'positive' },
  pending: { text: 'Conciliação pendente', tone: 'warning' },
  covered_batch: { text: 'Lote — não suportado', tone: 'warning' },
  covered_installments: { text: 'Parcelas — não suportado', tone: 'warning' },
  before_base_date: { text: 'Já no saldo inicial', tone: 'neutral' },
  zero_net: { text: 'Líquido zero', tone: 'neutral' },
};

const LINK_LABEL: Record<EntryLinkKind, { text: string; tone: Tone }> = {
  imported: { text: 'Importada (sem vínculo)', tone: 'neutral' },
  reconciled: { text: 'Conciliada', tone: 'positive' },
  orphan_reference: { text: 'Referência sem venda', tone: 'warning' },
  batch: { text: 'Lote — não suportado', tone: 'warning' },
  installments: { text: 'Parcelas — não suportado', tone: 'warning' },
  standalone: { text: 'Independente de vendas', tone: 'neutral' },
};

const MAX_ROWS = 60;

/** 199 → "1,99". */
export const formatBps = (bps: number): string => `${Math.floor(bps / 100)},${String(bps % 100).padStart(2, '0')}`;

/** "1,99" ou "2" → 199 | 200; null se inválido (0 a 100 com até 2 casas, vírgula). */
export function parsePercentBps(text: string): number | null {
  const m = /^(\d{1,3})(?:,(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return bps <= 10_000 ? bps : null;
}

type Draft = Record<PaymentMethod, { fee: string; commission: string; lag: string }>;
const toDraft = (rules: SettlementRules): Draft =>
  Object.fromEntries(PAYMENT_METHODS.map((m) => [m, { fee: formatBps(rules[m].feeBps), commission: formatBps(rules[m].commissionBps), lag: String(rules[m].lagDays) }])) as Draft;

function RulesForm({ rules, busy, onSave }: { rules: SettlementRules; busy: boolean; onSave: (rules: SettlementRules) => Promise<string | null> }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(rules));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = (m: PaymentMethod, field: 'fee' | 'commission' | 'lag', value: string) => setDraft((d) => ({ ...d, [m]: { ...d[m], [field]: value } }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const parsed = {} as SettlementRules;
    for (const m of PAYMENT_METHODS) {
      const label = METHOD_LABEL[m];
      const fee = parsePercentBps(draft[m].fee);
      const commission = parsePercentBps(draft[m].commission);
      const lag = /^\d{1,3}$/.test(draft[m].lag.trim()) ? Number(draft[m].lag) : null;
      if (fee === null) next[`${m}.fee`] = `Taxa de ${label} inválida: use 0 a 100, ex.: 1,99.`;
      if (commission === null) next[`${m}.commission`] = `Comissão de ${label} inválida: use 0 a 100, ex.: 1,99.`;
      if (lag === null || lag > MAX_LAG_DAYS) next[`${m}.lag`] = `Prazo de ${label} inválido: use 0 a ${MAX_LAG_DAYS} dias.`;
      if (fee !== null && commission !== null && lag !== null) parsed[m] = { method: m, feeBps: fee, commissionBps: commission, lagDays: lag };
    }
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;
    const problem = validateRules(parsed);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(await onSave(parsed));
  }

  return (
    <CfCard
      title="Regras de repasse"
      description="Taxa e comissão descontadas de cada venda e prazo (em dias corridos) até o dinheiro cair. Valores iniciais são ilustrativos: ajuste aos seus contratos. Feriados e dias úteis não são considerados."
      headingLevel={3}
    >
      <form className="cf-stack" onSubmit={(e) => void submit(e)} noValidate aria-label="Regras de repasse">
        {formError && <CfAlert tone="negative" title="Não foi possível salvar as regras">{formError}</CfAlert>}
        {PAYMENT_METHODS.map((m) => (
          <fieldset className="cf-fieldset" key={m}>
            <legend>{METHOD_LABEL[m]}</legend>
            <div className="cf-grid cf-grid--three">
              <CfField label={`Taxa de ${METHOD_LABEL[m]} (%)`} value={draft[m].fee} onChange={(e) => set(m, 'fee', e.target.value)} error={errors[`${m}.fee`]} inputMode="decimal" />
              <CfField label={`Comissão de ${METHOD_LABEL[m]} (%)`} value={draft[m].commission} onChange={(e) => set(m, 'commission', e.target.value)} error={errors[`${m}.commission`]} inputMode="decimal" />
              <CfField label={`Prazo de ${METHOD_LABEL[m]} (dias)`} value={draft[m].lag} onChange={(e) => set(m, 'lag', e.target.value)} error={errors[`${m}.lag`]} inputMode="numeric" />
            </div>
          </fieldset>
        ))}
        <div className="cf-row">
          <CfButton variant="primary" type="submit" loading={busy}>
            Salvar regras
          </CfButton>
        </div>
      </form>
    </CfCard>
  );
}

export interface SettlementPanelProps {
  rules: SettlementRules;
  reconciliation: ReconcileResult;
  entriesById: ReadonlyMap<string, CashEntry>;
  decisions: readonly ReconciliationDecision[];
  salesByInternalId: ReadonlyMap<string, string>;
  busy: boolean;
  onSaveRules: (rules: SettlementRules) => Promise<string | null>;
  onDecide: (decision: ReconciliationDecision) => void;
  onUndo: (decision: ReconciliationDecision) => void;
}

/** Área "Recebimentos previstos líquidos": regras, recebíveis com situação, pendências e decisões. */
export function SettlementPanel({ rules, reconciliation, entriesById, decisions, salesByInternalId, busy, onSaveRules, onDecide, onUndo }: SettlementPanelProps) {
  const { receivables, entryViews, summary, staleDecisions } = reconciliation;
  const [showPast, setShowPast] = useState(false);
  const pastCount = receivables.filter((r) => r.status === 'before_base_date').length;
  const visible = showPast ? receivables : receivables.filter((r) => r.status !== 'before_base_date');
  const pendingEntries = entryViews.filter((v) => v.pendingSaleIds.length > 0);
  const incoming = entryViews.filter((v) => entriesById.get(v.entryId)?.direction === 'in');
  const stale = new Set(staleDecisions.map((d) => JSON.stringify(d)));
  const activeDecisions = decisions.filter((d) => !stale.has(JSON.stringify(d)));
  const shown = visible.slice(0, MAX_ROWS);
  const describe = (d: ReconciliationDecision) => {
    const e = entriesById.get(d.entryId);
    const entry = e ? `${e.description} (${formatBR(e.dueDate)})` : d.entryId;
    return d.kind === 'same' ? `Conta “${entry}” conciliada com a venda ${salesByInternalId.get(d.saleId) ?? d.saleId}` : `Conta “${entry}” marcada como independente de vendas`;
  };

  return (
    <div className="cf-stack">
      <CfCard
        title="Recebimentos previstos líquidos"
        description="O que cada venda deve render depois de taxas, na data de repasse. Só entra no saldo projetado o que está como “Derivado”; contas importadas valem mais que estimativas."
      >
        <div className="cf-stack">
          <CfAlert tone="neutral" title="Limites desta versão">
            Parcelas e lotes não são suportados: conta com referência a várias vendas (A|B), ou várias contas para a mesma venda, ficam sinalizadas e valem pelo valor importado; a estimativa dessas vendas fica fora do saldo. Estornos e pagamentos parciais também não são tratados.
          </CfAlert>
          {summary.pending > 0 && (
            <CfAlert tone="warning" title={`${summary.pending} recebível(is) com conciliação pendente`}>
              Há conta a receber importada, sem referência de venda, perto da data do repasse. Para não contar o mesmo dinheiro duas vezes, só a conta importada entra no saldo até você decidir abaixo.
            </CfAlert>
          )}
          {receivables.length === 0 ? (
            <p className="cf-muted">Sem vendas, não há recebíveis estimados. Importe as vendas para ver os repasses.</p>
          ) : (
            <div className="cf-table-wrap">
              <table className="cf-table" aria-label="Recebimentos previstos líquidos">
                <thead>
                  <tr>
                    <th scope="col">Venda</th>
                    <th scope="col">Meio</th>
                    <th scope="col">Venda em</th>
                    <th scope="col">Repasse em</th>
                    <th scope="col" className="cf-num">Bruto</th>
                    <th scope="col" className="cf-num">Taxa</th>
                    <th scope="col" className="cf-num">Líquido</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Entra no saldo?</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const label = STATUS_LABEL[r.status];
                    return (
                      <tr key={r.receivable.id} data-sale={r.receivable.externalId} data-status={r.status}>
                        <th scope="row">{r.receivable.externalId}</th>
                        <td>{METHOD_LABEL[r.receivable.method]}</td>
                        <td>{formatBR(r.receivable.saleDate)}</td>
                        <td>{formatBR(r.receivable.dueDate)}</td>
                        <td className="cf-num">{formatBRL(r.receivable.grossCents)}</td>
                        <td className="cf-num">{formatBRL(r.receivable.feeCents)}</td>
                        <td className="cf-num">{formatBRL(r.receivable.netCents)}</td>
                        <td>
                          <CfBadge tone={label.tone}>{label.text}</CfBadge>
                          {r.differenceCents !== null && r.differenceCents !== 0n && (
                            <div className="cf-subtle">Conta importada difere da estimativa em {formatBRL(r.differenceCents)}</div>
                          )}
                        </td>
                        <td data-col="counts">{r.counts ? 'Sim' : 'Não'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {visible.length > MAX_ROWS && <p className="cf-subtle">Mostrando {MAX_ROWS} de {visible.length} recebíveis, por data de repasse.</p>}
          {pastCount > 0 && (
            <div className="cf-row">
              <CfButton variant="ghost" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
                {showPast ? 'Ocultar repasses já no saldo inicial' : `Mostrar ${pastCount} repasse(s) já no saldo inicial`}
              </CfButton>
              <span className="cf-subtle">Repasses até a data-base já estão no saldo informado e não entram na projeção.</span>
            </div>
          )}
        </div>
      </CfCard>

      {pendingEntries.length > 0 && (
        <CfCard title="Resolver conciliação pendente" description="Decida o que cada conta importada representa. Nada é vinculado sozinho só por valor e data." headingLevel={3}>
          <div className="cf-stack">
            {pendingEntries.map((v) => {
              const e = entriesById.get(v.entryId) as CashEntry;
              return (
                <div className="cf-subcard" key={v.entryId}>
                  <p>
                    <strong>{e.description}</strong> · {formatBRL(BigInt(e.amountCents))} em {formatBR(e.dueDate)}
                  </p>
                  <p className="cf-muted">Pode ser o repasse de uma destas vendas ou ser independente delas:</p>
                  <div className="cf-row">
                    {v.pendingSaleIds.map((saleId) => {
                      const ext = salesByInternalId.get(saleId) ?? saleId;
                      return (
                        <CfButton key={saleId} variant="secondary" disabled={busy} onClick={() => onDecide({ kind: 'same', saleId, entryId: v.entryId })}>
                          {`Vincular a ${ext}`}
                        </CfButton>
                      );
                    })}
                    <CfButton variant="ghost" disabled={busy} onClick={() => onDecide({ kind: 'standalone', entryId: v.entryId })}>
                      Conta independente de vendas
                    </CfButton>
                  </div>
                </div>
              );
            })}
          </div>
        </CfCard>
      )}

      {(activeDecisions.length > 0 || staleDecisions.length > 0) && (
        <CfCard title="Decisões de conciliação" headingLevel={3}>
          <ul className="cf-list">
            {activeDecisions.map((d) => (
              <li key={JSON.stringify(d)}>
                <div className="cf-row">
                  <span>{describe(d)}</span>
                  <CfButton variant="ghost" disabled={busy} onClick={() => onUndo(d)}>
                    Desfazer decisão
                  </CfButton>
                </div>
              </li>
            ))}
            {staleDecisions.map((d) => (
              <li key={`stale-${JSON.stringify(d)}`}>
                <div className="cf-row">
                  <span className="cf-muted">Decisão obsoleta (conta ou venda mudou): ignorada no saldo.</span>
                  <CfButton variant="ghost" disabled={busy} onClick={() => onUndo(d)}>
                    Remover decisão obsoleta
                  </CfButton>
                </div>
              </li>
            ))}
          </ul>
        </CfCard>
      )}

      {incoming.length > 0 && (
        <CfCard title="Contas a receber e vínculo com vendas" description="Importadas ou manuais. A referência de venda liga a conta ao repasse; sem ela, nada é vinculado automaticamente." headingLevel={3}>
          <div className="cf-table-wrap">
            <table className="cf-table" aria-label="Contas a receber e vínculo">
              <thead>
                <tr>
                  <th scope="col">Vencimento</th>
                  <th scope="col">Descrição</th>
                  <th scope="col" className="cf-num">Valor</th>
                  <th scope="col">Vínculo</th>
                </tr>
              </thead>
              <tbody>
                {incoming.map((v) => {
                  const e = entriesById.get(v.entryId) as CashEntry;
                  const label = v.pendingSaleIds.length > 0 ? { text: 'Importada — conciliação pendente', tone: 'warning' as Tone } : LINK_LABEL[v.link];
                  return (
                    <tr key={v.entryId}>
                      <td>{formatBR(e.dueDate)}</td>
                      <td style={{ whiteSpace: 'normal' }}>{e.description}</td>
                      <td className="cf-num">{formatBRL(BigInt(e.amountCents))}</td>
                      <td>
                        <CfBadge tone={label.tone}>{label.text}</CfBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CfCard>
      )}

      <RulesForm rules={rules} busy={busy} onSave={onSaveRules} />
    </div>
  );
}
