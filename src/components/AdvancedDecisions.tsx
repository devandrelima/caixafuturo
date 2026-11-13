import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { addDays, daysBetween, formatBR, isValidISODate } from '../domain/finance/dates';
import { formatBRL, parseBRL } from '../domain/finance/money';
import type { CashEntry } from '../domain/finance/types';
import { advanceCost, MAX_ADVANCE_RATE_BPS } from '../domain/scenarios/advance';
import { buildPaymentPlan, MAX_DEFERRED_CHARGE_BPS, MAX_INSTALLMENTS, MAX_MONTHLY_RATE_BPS, MIN_INSTALLMENTS } from '../domain/scenarios/equipment';
import { hiringMonthlyCost, HIRING_PREMISE, MAX_CHARGES_BPS } from '../domain/scenarios/hiring';
import { parseIntegerText, parsePercentBpsUpTo } from '../domain/scenarios/inputs';
import { bpsText } from '../domain/scenarios/shocks';
import { ScenarioError } from '../domain/scenarios/types';
import type { Adjustment, BaseSnapshot, EquipmentPayment, HiringAdjustment } from '../domain/scenarios/types';
import { CfButton, CfField, CfSelect } from './ui/UiPrimitives';

export interface AdvancedDecisionsProps {
  snapshot: BaseSnapshot;
  /** Recebimentos agendados dentro do horizonte (candidatos à antecipação). */
  receivables: readonly CashEntry[];
  /** Saídas agendadas dentro do horizonte (candidatas à mudança de vencimento). */
  payables: readonly CashEntry[];
  optionText: (entry: CashEntry) => string;
  nextId: () => string;
  /** Acrescenta a hipótese à (única) Alternativa. Nada é gravado. */
  onAdd: (adjustment: Adjustment) => void;
}

type Errors = Record<string, string | undefined>;
type PayMode = 'cash' | 'deferred' | 'installments';

const money = (text: string): { ok: true; cents: bigint } | { ok: false; reason: string } => parseBRL(text);
const errorText = (error: unknown): string => (error instanceof ScenarioError ? error.message : 'Não foi possível calcular esta hipótese.');

/** Painel recolhível de uma decisão. A prévia em TEXTO (custos e datas) vem antes de qualquer gráfico ou tabela. */
function Panel({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <details className="cf-details cf-hypo cf-advanced__panel">
      <summary>
        <span>{title}</span>
        <span className="cf-advanced__sub">{summary}</span>
      </summary>
      <div className="cf-details__body cf-stack">{children}</div>
    </details>
  );
}

function Preview({ children }: { children: ReactNode }) {
  return (
    <p className="cf-advanced__preview" aria-live="polite">
      <strong>Prévia em texto (hipótese):</strong> {children}
    </p>
  );
}

// ───────────────────────── F23 — compra de equipamento ─────────────────────────

function EquipmentForm({ onAdd, nextId }: Pick<AdvancedDecisionsProps, 'onAdd' | 'nextId'>) {
  const [what, setWhat] = useState('');
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<PayMode>('cash');
  const [date, setDate] = useState('');
  const [count, setCount] = useState('');
  const [rate, setRate] = useState('');
  const [charge, setCharge] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const parsed = useMemo(() => {
    const out: { errors: Errors; payment?: EquipmentPayment; principal?: bigint } = { errors: {} };
    if (what.trim() === '') out.errors.what = 'Diga o que está sendo comprado.';
    const m = money(value);
    if (!m.ok) out.errors.value = m.reason;
    if (!isValidISODate(date)) out.errors.date = mode === 'installments' ? 'Informe a data da primeira parcela.' : 'Informe a data do pagamento.';
    let payment: EquipmentPayment | undefined;
    if (mode === 'cash' && isValidISODate(date)) payment = { mode: 'cash', date };
    if (mode === 'deferred') {
      const c = parsePercentBpsUpTo(charge === '' ? '0' : charge, MAX_DEFERRED_CHARGE_BPS);
      if (!c.ok) out.errors.charge = c.reason;
      else if (isValidISODate(date)) payment = { mode: 'deferred', date, chargeBps: c.bps };
    }
    if (mode === 'installments') {
      const n = parseIntegerText(count, MIN_INSTALLMENTS, MAX_INSTALLMENTS);
      if (!n.ok) out.errors.count = `Informe de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas.`;
      const r = parsePercentBpsUpTo(rate === '' ? '0' : rate, MAX_MONTHLY_RATE_BPS);
      if (!r.ok) out.errors.rate = r.reason;
      if (n.ok && r.ok && isValidISODate(date)) payment = { mode: 'installments', firstDate: date, count: n.value, monthlyRateBps: r.bps };
    }
    return { ...out, payment, principal: m.ok ? m.cents : undefined };
  }, [what, value, mode, date, count, rate, charge]);

  const preview = useMemo(() => {
    if (!parsed.payment || parsed.principal === undefined || parsed.errors.value) return null;
    try {
      const plan = buildPaymentPlan(parsed.principal, parsed.payment);
      const first = plan.installments[0];
      const last = plan.installments[plan.installments.length - 1];
      if (!first || !last) return null;
      const parts = plan.installments.length === 1 ? `1 pagamento de ${formatBRL(first.amountCents)} em ${formatBR(first.dueDate)}` : `${plan.installments.length} parcelas, de ${formatBR(first.dueDate)} a ${formatBR(last.dueDate)}, de ${formatBRL(first.amountCents)} (a última, ${formatBRL(last.amountCents)}, absorve o resíduo)`;
      return `principal ${formatBRL(plan.principalCents)} + encargos ${formatBRL(plan.chargesCents)} = total ${formatBRL(plan.totalCents)}; ${parts}. Nenhum pagamento é feito.`;
    } catch (error) {
      return errorText(error);
    }
  }, [parsed]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length > 0 || !parsed.payment || parsed.principal === undefined) return;
    onAdd({ id: nextId(), kind: 'equipment_purchase', description: what.trim(), principalCents: parsed.principal.toString(), payment: parsed.payment });
    setWhat('');
    setValue('');
  };

  return (
    <form onSubmit={submit} aria-label="Hipótese de compra de equipamento" noValidate className="cf-stack">
      <CfField label="O que será comprado" value={what} onChange={(e) => setWhat(e.target.value)} error={errors.what} hint="Ex.: forno, câmara fria" maxLength={100} />
      <CfField label="Valor da compra (R$)" value={value} onChange={(e) => setValue(e.target.value)} error={errors.value} hint="Ex.: 10.000,00" inputMode="decimal" />
      <CfSelect label="Forma de pagamento" value={mode} onChange={(e) => setMode(e.target.value as PayMode)}>
        <option value="cash">À vista</option>
        <option value="deferred">Adiada (um pagamento depois)</option>
        <option value="installments">Parcelada</option>
      </CfSelect>
      <CfField label={mode === 'installments' ? 'Data da primeira parcela' : 'Data do pagamento'} type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      {mode === 'installments' && (
        <>
          <CfField label="Número de parcelas" value={count} onChange={(e) => setCount(e.target.value)} error={errors.count} hint={`De ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS}. Parcelas mensais iguais.`} inputMode="numeric" />
          <CfField label="Juros ao mês (%)" value={rate} onChange={(e) => setRate(e.target.value)} error={errors.rate} hint={`Taxa que você informa, de 0 a ${bpsText(MAX_MONTHLY_RATE_BPS)}. Vazio = sem juros.`} inputMode="decimal" />
        </>
      )}
      {mode === 'deferred' && <CfField label="Encargo único (%)" value={charge} onChange={(e) => setCharge(e.target.value)} error={errors.charge} hint="Percentual sobre o valor, que você informa. Vazio = sem encargo." inputMode="decimal" />}
      {preview && <Preview>{preview}</Preview>}
      <CfButton type="submit" variant="primary">
        Adicionar hipótese de compra
      </CfButton>
    </form>
  );
}

// ───────────────────────── F24 — contratação ─────────────────────────

function HiringForm({ onAdd, nextId }: Pick<AdvancedDecisionsProps, 'onAdd' | 'nextId'>) {
  const [role, setRole] = useState('');
  const [cost, setCost] = useState('');
  const [charges, setCharges] = useState('');
  const [fixed, setFixed] = useState('');
  const [payDay, setPayDay] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const parsed = useMemo(() => {
    const e: Errors = {};
    if (role.trim() === '') e.role = 'Diga a função ou o cargo (hipotético).';
    const c = money(cost);
    if (!c.ok) e.cost = c.reason;
    const ch = charges.trim() === '' ? null : parsePercentBpsUpTo(charges, MAX_CHARGES_BPS);
    if (ch && !ch.ok) e.charges = ch.reason;
    const fx = fixed.trim() === '' ? null : parseBRL(fixed, { allowZero: true });
    if (fx && !fx.ok) e.fixed = fx.reason;
    const d = parseIntegerText(payDay, 1, 31);
    if (!d.ok) e.payDay = 'Informe o dia do pagamento, de 1 a 31.';
    if (!isValidISODate(start)) e.start = 'Informe a data inicial.';
    if (end !== '' && !isValidISODate(end)) e.end = 'Informe uma data final válida ou deixe em branco.';
    else if (end !== '' && isValidISODate(start) && end < start) e.end = 'A data final não pode ser antes da data inicial.';
    let adjustment: Omit<HiringAdjustment, 'id'> | undefined;
    if (Object.keys(e).length === 0 && c.ok && d.ok) {
      adjustment = {
        kind: 'hiring', role: role.trim(), monthlyCostCents: c.cents.toString(), payDay: d.value, startDate: start,
        ...(ch && ch.ok ? { chargesBps: ch.bps } : {}), ...(fx && fx.ok ? { fixedMonthlyCents: fx.cents.toString() } : {}), ...(end !== '' ? { endDate: end } : {}),
      };
    }
    return { errors: e, adjustment };
  }, [role, cost, charges, fixed, payDay, start, end]);

  const preview = useMemo(() => {
    if (!parsed.adjustment) return null;
    const m = hiringMonthlyCost({ ...parsed.adjustment, id: 'preview' });
    const missing = [parsed.adjustment.chargesBps === undefined ? 'encargos' : null, parsed.adjustment.fixedMonthlyCents === undefined ? 'outros custos fixos' : null].filter((x) => x !== null);
    return `${formatBRL(m.baseCents)} + encargos ${formatBRL(m.chargesCents)} + outros custos ${formatBRL(m.fixedCents)} = ${formatBRL(m.totalCents)} por mês, pago todo dia ${parsed.adjustment.payDay} a partir de ${formatBR(parsed.adjustment.startDate)}.${missing.length > 0 ? ` Hipótese incompleta: faltam ${missing.join(' e ')}.` : ''} Nada é contratado.`;
  }, [parsed]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrors(parsed.errors);
    if (!parsed.adjustment) return;
    onAdd({ ...parsed.adjustment, id: nextId() });
    setRole('');
    setCost('');
  };

  return (
    <form onSubmit={submit} aria-label="Hipótese de contratação" noValidate className="cf-stack">
      <p className="cf-advanced__premise">{HIRING_PREMISE}</p>
      <CfField label="Função (cargo)" value={role} onChange={(e) => setRole(e.target.value)} error={errors.role} hint="Ex.: auxiliar de cozinha" maxLength={100} />
      <CfField label="Custo mensal informado (R$)" value={cost} onChange={(e) => setCost(e.target.value)} error={errors.cost} hint="O valor que você espera pagar por mês. Ex.: 2.000,00" inputMode="decimal" />
      <CfField label="Encargos informados (%) — opcional" value={charges} onChange={(e) => setCharges(e.target.value)} error={errors.charges} hint="Percentual sobre o custo mensal, que você informa. Em branco = não informado (hipótese incompleta)." inputMode="decimal" />
      <CfField label="Outros custos mensais fixos (R$) — opcional" value={fixed} onChange={(e) => setFixed(e.target.value)} error={errors.fixed} hint="Benefícios, transporte etc., que você informa. Em branco = não informado." inputMode="decimal" />
      <CfField label="Dia do pagamento (1 a 31)" value={payDay} onChange={(e) => setPayDay(e.target.value)} error={errors.payDay} hint="Mês curto usa o último dia." inputMode="numeric" />
      <CfField label="Data inicial" type="date" value={start} onChange={(e) => setStart(e.target.value)} error={errors.start} hint="Nenhum custo aparece antes dela." />
      <CfField label="Data final — opcional" type="date" value={end} onChange={(e) => setEnd(e.target.value)} error={errors.end} />
      {preview && <Preview>{preview}</Preview>}
      <CfButton type="submit" variant="primary">
        Adicionar hipótese de contratação
      </CfButton>
    </form>
  );
}

// ───────────────────────── F25 — vencimento de fornecedor ─────────────────────────

function VendorForm({ payables, optionText, onAdd, nextId }: Pick<AdvancedDecisionsProps, 'payables' | 'optionText' | 'onAdd' | 'nextId'>) {
  const [entryId, setEntryId] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const entry = payables.find((p) => p.id === entryId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const e: Errors = {};
    if (!entry) e.entry = 'Escolha a conta a pagar.';
    if (!isValidISODate(date)) e.date = 'Informe a nova data de vencimento.';
    else if (entry && date === entry.dueDate) e.date = 'A nova data é igual à atual: escolha outra.';
    setErrors(e);
    if (e.entry || e.date || !entry) return;
    onAdd({ id: nextId(), kind: 'shift_vendor_due', entryId: entry.id, newDate: date });
    setDate('');
  };

  return (
    <form onSubmit={submit} aria-label="Hipótese de novo vencimento" noValidate className="cf-stack">
      {payables.length === 0 ? (
        <p className="cf-muted">Não há contas a pagar agendadas no horizonte.</p>
      ) : (
        <>
          <CfSelect label="Conta a pagar" value={entryId} onChange={(e) => setEntryId(e.target.value)} error={errors.entry}>
            <option value="">Escolha…</option>
            {payables.map((p) => (
              <option key={p.id} value={p.id}>
                {optionText(p)}
              </option>
            ))}
          </CfSelect>
          <CfField label="Nova data de vencimento" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} hint="Só a data muda; o valor continua o mesmo." />
          {entry && isValidISODate(date) && date !== entry.dueDate && (
            <Preview>
              de {formatBR(entry.dueDate)} para {formatBR(date)}; o valor {formatBRL(BigInt(entry.amountCents))} não muda. Nada é renegociado nem comunicado ao fornecedor.
            </Preview>
          )}
          <CfButton type="submit" variant="primary">
            Adicionar hipótese de novo vencimento
          </CfButton>
        </>
      )}
    </form>
  );
}

// ───────────────────────── F26 — antecipação de recebíveis ─────────────────────────

function AdvanceForm({ snapshot, receivables, optionText, onAdd, nextId }: Pick<AdvancedDecisionsProps, 'snapshot' | 'receivables' | 'optionText' | 'onAdd' | 'nextId'>) {
  const [entryId, setEntryId] = useState('');
  const [date, setDate] = useState('');
  const [rate, setRate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const entry = receivables.find((r) => r.id === entryId);
  const parsedRate = parsePercentBpsUpTo(rate, MAX_ADVANCE_RATE_BPS);
  const baseDate = snapshot.settings.baseDate;
  const inRange = entry !== undefined && isValidISODate(date) && date > baseDate && date < entry.dueDate;

  const preview = useMemo(() => {
    if (!entry || !inRange || !parsedRate.ok) return null;
    const gross = BigInt(entry.amountCents);
    const days = daysBetween(date, entry.dueDate);
    const cost = advanceCost(gross, parsedRate.bps, days);
    if (cost >= gross) return `o custo (${formatBRL(cost)}) seria igual ou maior que o valor: reduza a taxa.`;
    return `${formatBRL(gross)} previstos para ${formatBR(entry.dueDate)} viram ${formatBRL(gross - cost)} líquidos em ${formatBR(date)} (${days} dia${days === 1 ? '' : 's'} antes, taxa informada de ${bpsText(parsedRate.bps)} ao mês): custo ${formatBRL(cost)}. O original sai de ${formatBR(entry.dueDate)} (nunca os dois). Nada é solicitado.`;
  }, [entry, inRange, parsedRate, date]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const e: Errors = {};
    if (!entry) e.entry = 'Escolha o recebimento que seria antecipado.';
    if (!isValidISODate(date)) e.date = 'Informe a data da antecipação.';
    else if (entry && !(date > baseDate && date < entry.dueDate)) e.date = `A data precisa ser depois de ${formatBR(baseDate)} (data-base) e antes do vencimento${entry ? ` (${formatBR(entry.dueDate)})` : ''}.`;
    if (!parsedRate.ok) e.rate = parsedRate.reason;
    setErrors(e);
    if (e.entry || e.date || e.rate || !entry || !parsedRate.ok) return;
    onAdd({ id: nextId(), kind: 'advance_receivable', entryId: entry.id, advanceDate: date, rateBps: parsedRate.bps });
    setDate('');
    setRate('');
  };

  const first = addDays(baseDate, 1);
  return (
    <form onSubmit={submit} aria-label="Hipótese de antecipação de recebimento" noValidate className="cf-stack">
      {receivables.length === 0 ? (
        <p className="cf-muted">Não há recebimentos agendados no horizonte.</p>
      ) : (
        <>
          <CfSelect label="Recebimento a antecipar" value={entryId} onChange={(e) => setEntryId(e.target.value)} error={errors.entry} hint="O recebimento inteiro; antecipar só uma parte fica fora desta versão.">
            <option value="">Escolha…</option>
            {receivables.map((r) => (
              <option key={r.id} value={r.id}>
                {optionText(r)}
              </option>
            ))}
          </CfSelect>
          <CfField label="Data da antecipação" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} hint={`A partir de ${formatBR(first)} e antes do vencimento.`} />
          <CfField label="Taxa informada ao mês (%)" value={rate} onChange={(e) => setRate(e.target.value)} error={errors.rate} hint={`A taxa é sua: não existe valor padrão. Exemplo ilustrativo, que não é taxa de mercado: 2,5. Máximo ${bpsText(MAX_ADVANCE_RATE_BPS)}.`} inputMode="decimal" />
          {preview && <Preview>{preview}</Preview>}
          <CfButton type="submit" variant="primary">
            Simular antecipação
          </CfButton>
        </>
      )}
    </form>
  );
}

/** Decisões avançadas (S06): quatro painéis dentro do Simulador. Tudo é hipótese; nenhum botão executa nada. */
export function AdvancedDecisions({ snapshot, receivables, payables, optionText, nextId, onAdd }: AdvancedDecisionsProps) {
  return (
    <section className="cf-stack cf-advanced" aria-label="Decisões avançadas (hipóteses)">
      <h3 className="cf-scenario-form__title">Decisões avançadas</h3>
      <p className="cf-muted">Custos e datas aparecem em texto antes de qualquer gráfico ou tabela. Todas são hipóteses: nada é pago, contratado, renegociado ou solicitado.</p>
      <Panel title="Compra de equipamento" summary="à vista, adiada ou parcelada, com juros que você informa">
        <EquipmentForm onAdd={onAdd} nextId={nextId} />
      </Panel>
      <Panel title="Contratação" summary="custos mensais informados a partir de uma data">
        <HiringForm onAdd={onAdd} nextId={nextId} />
      </Panel>
      <Panel title="Vencimento de fornecedor" summary="muda só a data de uma conta a pagar">
        <VendorForm payables={payables} optionText={optionText} onAdd={onAdd} nextId={nextId} />
      </Panel>
      <Panel title="Antecipação de recebimento" summary="valor líquido e custo, sem duplicar o futuro">
        <AdvanceForm snapshot={snapshot} receivables={receivables} optionText={optionText} onAdd={onAdd} nextId={nextId} />
      </Panel>
    </section>
  );
}
