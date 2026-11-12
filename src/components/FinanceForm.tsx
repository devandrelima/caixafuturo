import { useState } from 'react';
import type { FormEvent } from 'react';
import { isValidISODate } from '../domain/finance/dates';
import { parseBRL } from '../domain/finance/money';
import type { CashEntry, CashSettings, Direction } from '../domain/finance/types';
import type { EntryDraft } from '../storage/repository';
import { centsToInput } from './riskText';
import { CfAlert, CfButton, CfCard, CfField, CfSelect } from './ui/UiPrimitives';

export interface EntryFormProps {
  initial?: CashEntry | null;
  saving?: boolean;
  error?: string;
  onSubmit: (draft: EntryDraft) => void;
  onCancel: () => void;
}

/** Cadastro/edição de lançamento. Valida localmente; o repositório valida de novo antes de gravar. */
export function EntryForm({ initial, saving = false, error, onSubmit, onCancel }: EntryFormProps) {
  const [direction, setDirection] = useState<Direction>(initial?.direction ?? 'out');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial ? centsToInput(BigInt(initial.amountCents)) : '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (description.trim() === '') next.description = 'Informe a descrição.';
    const money = parseBRL(amount);
    if (!money.ok) next.amount = money.reason;
    if (!isValidISODate(dueDate)) next.dueDate = 'Informe um vencimento válido.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !money.ok) return;
    onSubmit({ direction, amountCents: money.cents.toString(), dueDate, description: description.trim(), category: category.trim() });
  }

  return (
    <CfCard title={initial ? 'Editar lançamento' : 'Adicionar lançamento'} headingLevel={2}>
      <form className="cf-stack" onSubmit={submit} noValidate aria-label={initial ? 'Editar lançamento' : 'Adicionar lançamento'}>
        {error && <CfAlert tone="negative" title="Não foi possível salvar">{error}</CfAlert>}
        <div className="cf-grid cf-grid--two">
          <CfSelect label="Tipo" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
            <option value="out">Pagar</option>
            <option value="in">Receber</option>
          </CfSelect>
          <CfField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} required maxLength={200} />
          <CfField label="Valor (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} hint="Ex.: 1.234,56" inputMode="decimal" required />
          <CfField label="Vencimento" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} required />
          <CfField label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} hint="Opcional" maxLength={100} />
        </div>
        <div className="cf-row">
          <CfButton variant="primary" type="submit" loading={saving}>
            Salvar lançamento
          </CfButton>
          <CfButton variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </CfButton>
        </div>
      </form>
    </CfCard>
  );
}

export interface SettingsFormProps {
  initial?: CashSettings | null;
  defaultBaseDate: string;
  saving?: boolean;
  error?: string;
  onSubmit: (settings: CashSettings) => void;
  onCancel?: () => void;
  title?: string;
}

/** Data-base, saldo inicial (fotografia conciliada ao fim do dia) e saldo mínimo de segurança. */
export function SettingsForm({ initial, defaultBaseDate, saving = false, error, onSubmit, onCancel, title = 'Saldos do caixa' }: SettingsFormProps) {
  const [baseDate, setBaseDate] = useState(initial?.baseDate ?? defaultBaseDate);
  const [opening, setOpening] = useState(initial ? centsToInput(BigInt(initial.openingBalanceCents)) : '');
  const [minimum, setMinimum] = useState(initial ? centsToInput(BigInt(initial.minimumBalanceCents)) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!isValidISODate(baseDate)) next.baseDate = 'Informe uma data válida.';
    const o = parseBRL(opening, { allowNegative: true, allowZero: true });
    if (!o.ok) next.opening = o.reason;
    const m = parseBRL(minimum, { allowZero: true });
    if (!m.ok) next.minimum = m.reason;
    setErrors(next);
    if (Object.keys(next).length > 0 || !o.ok || !m.ok) return;
    onSubmit({ baseDate, openingBalanceCents: o.cents.toString(), minimumBalanceCents: m.cents.toString() });
  }

  return (
    <CfCard title={title} description="O saldo inicial é o valor conferido ao FIM da data-base; contas já pagas até esse dia não entram de novo.">
      <form className="cf-stack" onSubmit={submit} noValidate aria-label={title}>
        {error && <CfAlert tone="negative" title="Não foi possível salvar">{error}</CfAlert>}
        <div className="cf-grid cf-grid--two">
          <CfField label="Data-base" type="date" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} error={errors.baseDate} required />
          <CfField label="Saldo inicial (R$)" value={opening} onChange={(e) => setOpening(e.target.value)} error={errors.opening} hint="Pode ser negativo. Ex.: 3.000,00" inputMode="decimal" required />
          <CfField label="Saldo mínimo de segurança (R$)" value={minimum} onChange={(e) => setMinimum(e.target.value)} error={errors.minimum} hint="Abaixo deste valor o painel avisa. Ex.: 1.000,00" inputMode="decimal" required />
        </div>
        <div className="cf-row">
          <CfButton variant="primary" type="submit" loading={saving}>
            Salvar saldos
          </CfButton>
          {onCancel && (
            <CfButton variant="ghost" onClick={onCancel} disabled={saving}>
              Cancelar
            </CfButton>
          )}
        </div>
      </form>
    </CfCard>
  );
}
