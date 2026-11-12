import { useState } from 'react';
import type { FormEvent } from 'react';
import { formatBR, isValidISODate } from '../domain/finance/dates';
import { formatBRL, parseBRL } from '../domain/finance/money';
import { FREQUENCIES, validateRule } from '../domain/finance/recurrence';
import type { CoveredOccurrence, Frequency, InvalidRule, RecurrenceRule } from '../domain/finance/recurrence';
import type { CashEntry, Direction } from '../domain/finance/types';
import { centsToInput } from './riskText';
import { CfAlert, CfBadge, CfButton, CfCard, CfField, CfSelect } from './ui/UiPrimitives';

export const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: 'Semanal', biweekly: 'Quinzenal', monthly: 'Mensal', yearly: 'Anual' };
const MAX_LISTED_OCCURRENCES = 10;

export interface RecurringPanelProps {
  rules: readonly RecurrenceRule[];
  /** Ocorrências ainda NÃO gravadas, calculadas pelas regras (depois da data-base). */
  occurrences: readonly CashEntry[];
  covered: readonly CoveredOccurrence[];
  invalidRules: readonly InvalidRule[];
  demoMode: boolean;
  busy: boolean;
  /** Devolve null se salvou ou a mensagem de erro. Para regra nova, `id` vem vazio e quem grava define. */
  onSave: (rule: RecurrenceRule) => Promise<string | null>;
  onRemove: (rule: RecurrenceRule) => void;
  onSkip: (rule: RecurrenceRule, date: string) => void;
  onLoadDemo: () => void;
}

const periodText = (r: RecurrenceRule) => (r.endDate ? `${formatBR(r.startDate)} a ${formatBR(r.endDate)}` : `desde ${formatBR(r.startDate)}`);

interface RuleFormProps {
  initial: RecurrenceRule | null;
  saving: boolean;
  onSave: (rule: RecurrenceRule) => Promise<string | null>;
  onCancel: () => void;
}

function RuleForm({ initial, saving, onSave, onCancel }: RuleFormProps) {
  const [direction, setDirection] = useState<Direction>(initial?.direction ?? 'out');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial ? centsToInput(BigInt(initial.amountCents)) : '');
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'monthly');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const startDay = isValidISODate(startDate) ? Number(startDate.slice(8, 10)) : 0;
  const shortMonthHint = startDay > 28 && (frequency === 'monthly' || frequency === 'yearly');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const money = parseBRL(amount);
    if (!money.ok) next.amount = money.reason;
    if (description.trim() === '') next.description = 'Informe a descrição.';
    if (!isValidISODate(startDate)) next.startDate = 'Informe uma data inicial válida.';
    if (endDate !== '' && !isValidISODate(endDate)) next.endDate = 'Informe uma data final válida ou deixe em branco.';
    else if (endDate !== '' && isValidISODate(startDate) && endDate < startDate) next.endDate = 'A data final não pode ser anterior à inicial.';
    setErrors(next);
    setServerError(null);
    if (Object.keys(next).length > 0 || !money.ok) return;
    const rule: RecurrenceRule = {
      id: initial?.id ?? '',
      direction,
      amountCents: money.cents.toString(),
      description: description.trim(),
      category: category.trim(),
      frequency,
      startDate,
      ...(endDate !== '' ? { endDate } : {}),
      ...(initial?.skippedDates && initial.skippedDates.length > 0 ? { skippedDates: initial.skippedDates } : {}),
    };
    const problems = validateRule({ ...rule, id: rule.id || 'novo' });
    if (problems.length > 0) {
      setServerError(problems[0] as string);
      return;
    }
    const failure = await onSave(rule);
    if (failure) setServerError(failure);
  }

  const title = initial ? 'Editar recorrência' : 'Nova recorrência';
  return (
    <CfCard title={title} headingLevel={3}>
      <form className="cf-stack" onSubmit={(e) => void submit(e)} noValidate aria-label={title}>
        {serverError && (
          <CfAlert tone="negative" title="Não foi possível salvar">
            {serverError}
          </CfAlert>
        )}
        <div className="cf-grid cf-grid--two">
          <CfSelect label="Tipo" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
            <option value="out">Despesa (pagar)</option>
            <option value="in">Receita (receber)</option>
          </CfSelect>
          <CfField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} required maxLength={200} />
          <CfField label="Valor (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} hint="Ex.: 1.800,00" inputMode="decimal" required />
          <CfSelect label="Periodicidade" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </CfSelect>
          <CfField
            label="Data inicial"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            error={errors.startDate}
            required
            hint={shortMonthHint ? `Dia ${startDay}: nos meses em que esse dia não existe (ex.: fevereiro), cai no último dia do mês e volta ao dia ${startDay} depois.` : undefined}
          />
          <CfField label="Data final" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} hint="Opcional. A própria data final ainda conta." />
          <CfField label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} hint="Opcional" maxLength={100} />
        </div>
        <div className="cf-row">
          <CfButton variant="primary" type="submit" loading={saving}>
            Salvar recorrência
          </CfButton>
          <CfButton variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </CfButton>
        </div>
      </form>
    </CfCard>
  );
}

export function RecurringPanel({ rules, occurrences, covered, invalidRules, demoMode, busy, onSave, onRemove, onSkip, onLoadDemo }: RecurringPanelProps) {
  const [editing, setEditing] = useState<RecurrenceRule | 'new' | null>(null);
  const ruleOf = (entry: CashEntry) => rules.find((r) => entry.sourceKey.startsWith(`rec:${r.id}:`));
  const upcoming = occurrences.slice(0, MAX_LISTED_OCCURRENCES);
  const nameOfRule = (id: string) => rules.find((r) => r.id === id)?.description ?? id;

  return (
    <CfCard
      title="Recorrências"
      description="Receitas e despesas que se repetem. As próximas ocorrências são calculadas pela regra; excluir uma regra não apaga o que já foi lançado."
      actions={
        <>
          <CfButton variant="primary" onClick={() => setEditing('new')} disabled={busy}>
            Nova recorrência
          </CfButton>
          {demoMode && rules.length === 0 && (
            <CfButton variant="secondary" onClick={onLoadDemo} disabled={busy}>
              Carregar recorrências fictícias
            </CfButton>
          )}
        </>
      }
    >
      <div className="cf-stack">
        {editing && (
          <RuleForm
            key={editing === 'new' ? 'new' : editing.id}
            initial={editing === 'new' ? null : editing}
            saving={busy}
            onSave={async (rule) => {
              const failure = await onSave(rule);
              if (!failure) setEditing(null);
              return failure;
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        {invalidRules.length > 0 && (
          <CfAlert tone="warning" title="Há regra(s) inválida(s), ignorada(s) no cálculo">
            <ul>
              {invalidRules.map((r) => (
                <li key={r.ruleId}>
                  {nameOfRule(r.ruleId)}: {r.errors[0]}
                </li>
              ))}
            </ul>
          </CfAlert>
        )}

        {rules.length === 0 ? (
          <p className="cf-muted">Nenhuma recorrência ainda. Cadastre aluguel, salários, assinaturas ou qualquer valor que se repete (semanal, quinzenal, mensal ou anual).</p>
        ) : (
          <div className="cf-table-wrap">
            <table className="cf-table cf-table--compact cf-table--stack" role="table" aria-label="Regras de recorrência">
              <thead>
                <tr>
                  <th scope="col">Regra</th>
                  <th scope="col" className="cf-num">Valor</th>
                  <th scope="col">Periodicidade</th>
                  <th scope="col">Período</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} data-rule-id={r.id} role="row">
                    <th scope="row" role="rowheader" className="cf-wrap">
                      {r.description} <CfBadge tone={r.direction === 'in' ? 'positive' : 'neutral'}>{r.direction === 'in' ? 'Receita' : 'Despesa'}</CfBadge>
                    </th>
                    <td className="cf-num" role="cell" data-label="Valor">{formatBRL(BigInt(r.amountCents))}</td>
                    <td role="cell" data-label="Periodicidade">{FREQUENCY_LABELS[r.frequency]}</td>
                    <td className="cf-wrap" role="cell" data-label="Período">{periodText(r)}</td>
                    <td role="cell" data-label="Ações">
                      <div className="cf-row">
                        <CfButton variant="ghost" onClick={() => setEditing(r)} disabled={busy} aria-label={`Editar recorrência ${r.description}`}>
                          Editar
                        </CfButton>
                        <CfButton variant="ghost" onClick={() => onRemove(r)} disabled={busy} aria-label={`Excluir recorrência ${r.description}`}>
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

        {rules.length > 0 && (
          <>
            <h3 className="cf-card__title">Próximas ocorrências calculadas</h3>
            {upcoming.length === 0 ? (
              <p className="cf-muted">Nenhuma ocorrência a calcular nas próximas 13 semanas.</p>
            ) : (
              <div className="cf-table-wrap">
                <table className="cf-table cf-table--compact cf-table--stack" role="table" aria-label="Próximas ocorrências calculadas">
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Descrição</th>
                      <th scope="col" className="cf-num">Valor</th>
                      <th scope="col">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map((o) => {
                      const rule = ruleOf(o);
                      return (
                        <tr key={o.id} data-entry-id={o.id} role="row">
                          <td role="cell" data-label="Data">{formatBR(o.dueDate)}</td>
                          <td className="cf-wrap" role="cell" data-label="Descrição">
                            {o.direction === 'in' ? 'Receber' : 'Pagar'} · {o.description}
                          </td>
                          <td className="cf-num" role="cell" data-label="Valor">{formatBRL(BigInt(o.amountCents))}</td>
                          <td role="cell" data-label="Ação">
                            {rule && (
                              <CfButton variant="ghost" onClick={() => onSkip(rule, o.dueDate)} disabled={busy} aria-label={`Pular ${o.description} em ${formatBR(o.dueDate)}`}>
                                Pular esta data
                              </CfButton>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {occurrences.length > upcoming.length && <p className="cf-subtle">Mostrando as {upcoming.length} primeiras de {occurrences.length} ocorrências calculadas; todas entram nos saldos.</p>}

            {covered.length > 0 && (
              <details className="cf-details">
                <summary>{`Ocorrências que já existem como lançamento (${covered.length})`}</summary>
                <div className="cf-details__body">
                  <p>A regra não altera nem duplica estes lançamentos; só eles contam no saldo.</p>
                  <ul className="cf-list">
                    {covered.map((c) => (
                      <li key={c.sourceKey} data-source-key={c.sourceKey}>
                        <strong>{formatBR(c.date)}</strong> · {nameOfRule(c.ruleId)} —{' '}
                        {c.reason === 'materialized' ? `já existe um lançamento gravado com esta chave (${c.entryId}).` : `equivalente ao lançamento existente ${c.entryId}; não duplicada.`}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </>
        )}

        <p className="cf-subtle">
          Limitações: datas em dias corridos, sem dias úteis nem feriados. Alterar a regra muda só as ocorrências ainda não lançadas; o que já foi lançado ou liquidado não muda.
        </p>
      </div>
    </CfCard>
  );
}
