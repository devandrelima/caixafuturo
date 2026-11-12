import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { addDays, formatBR, isValidISODate } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import { ORIGIN_LABELS } from '../domain/finance/filters';
import type { CashEntry } from '../domain/finance/types';
import { simulate } from '../domain/scenarios/engine';
import { describeAdjustment, parsePercentBps } from '../domain/scenarios/inputs';
import { MAX_DELAY_DAYS } from '../domain/scenarios/delay';
import { ScenarioError } from '../domain/scenarios/types';
import type { Adjustment, BaseSnapshot } from '../domain/scenarios/types';
import { ScenarioCompare } from './ScenarioCompare';
import { CfAlert, CfBadge, CfButton, CfCard, CfField, CfSelect } from './ui/UiPrimitives';

export interface ScenarioPanelProps {
  snapshot: BaseSnapshot;
  /** Hipóteses ativas. Vivem só na sessão (memória do app): nada é gravado no navegador. */
  adjustments: readonly Adjustment[];
  onChange: (next: Adjustment[]) => void;
}

const ALL = '__all__';
const categoryValue = (category: string) => `c:${category}`;

/** Simulador: controles de hipóteses + comparação Original × Alternativa. Não grava nem altera dado real. */
export function ScenarioPanel({ snapshot, adjustments, onChange }: ScenarioPanelProps) {
  const counter = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  const horizonEnd = addDays(snapshot.settings.baseDate, snapshot.horizonDays);
  const firstDay = addDays(snapshot.settings.baseDate, 1);

  const entriesById = useMemo(() => new Map(snapshot.entries.map((e) => [e.id, e] as const)), [snapshot]);
  const receivables = useMemo(
    () => snapshot.entries.filter((e) => e.direction === 'in' && e.state === 'scheduled' && e.dueDate >= firstDay && e.dueDate <= horizonEnd),
    [snapshot, firstDay, horizonEnd],
  );
  const categories = useMemo(() => [...new Set(snapshot.entries.filter((e) => e.direction === 'out' && e.state === 'scheduled').map((e) => e.category))].sort((a, b) => a.localeCompare(b)), [snapshot]);

  const outcome = useMemo(() => {
    try {
      return { result: simulate(snapshot, adjustments), error: null as string | null };
    } catch (error) {
      return { result: null, error: error instanceof ScenarioError ? error.message : 'Não foi possível simular esta hipótese.' };
    }
  }, [snapshot, adjustments]);

  const nextId = () => {
    counter.current += 1;
    return `h${counter.current}`;
  };
  const add = (adjustment: Adjustment, replaceEntryId?: string) => {
    const kept = adjustments.filter((a) => !(replaceEntryId !== undefined && a.kind === 'delay_receipt' && a.entryId === replaceEntryId));
    onChange([...kept, adjustment]);
    setNotice(null);
  };
  const reset = () => {
    onChange([]);
    setNotice('Hipóteses removidas. Você está vendo o Original, com todos os seus dados intactos.');
  };

  // ── atraso
  const [delayEntry, setDelayEntry] = useState('');
  const [delayDays, setDelayDays] = useState('');
  const [delayErrors, setDelayErrors] = useState<{ entry?: string; days?: string }>({});
  const submitDelay = (event: FormEvent) => {
    event.preventDefault();
    const errors: { entry?: string; days?: string } = {};
    const entry = entriesById.get(delayEntry);
    if (!entry) errors.entry = 'Escolha o recebimento que vai atrasar.';
    const days = /^\d{1,3}$/.test(delayDays.trim()) ? Number(delayDays.trim()) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > MAX_DELAY_DAYS) errors.days = `Informe de 1 a ${MAX_DELAY_DAYS} dias.`;
    setDelayErrors(errors);
    if (errors.entry || errors.days || !entry) return;
    const draft: Adjustment = { id: nextId(), kind: 'delay_receipt', entryId: entry.id, days };
    add({ ...draft, label: describeAdjustment(draft, entriesById) }, entry.id);
    setDelayDays('');
  };

  // ── choques
  const [salesFrom, setSalesFrom] = useState(firstDay);
  const [salesTo, setSalesTo] = useState(horizonEnd);
  const [salesPct, setSalesPct] = useState('');
  const [salesErrors, setSalesErrors] = useState<{ period?: string; pct?: string }>({});
  const [expFrom, setExpFrom] = useState(firstDay);
  const [expTo, setExpTo] = useState(horizonEnd);
  const [expPct, setExpPct] = useState('');
  const [expCategory, setExpCategory] = useState(ALL);
  const [expErrors, setExpErrors] = useState<{ period?: string; pct?: string }>({});

  const validateShock = (from: string, to: string, pct: string) => {
    const errors: { period?: string; pct?: string } = {};
    if (!isValidISODate(from) || !isValidISODate(to)) errors.period = 'Informe o início e o fim do período.';
    else if (from > to) errors.period = 'O início não pode ser depois do fim.';
    const parsed = parsePercentBps(pct);
    if (!parsed.ok) errors.pct = parsed.reason;
    return { errors, bps: parsed.ok ? parsed.bps : 0 };
  };
  const submitSales = (event: FormEvent) => {
    event.preventDefault();
    const { errors, bps } = validateShock(salesFrom, salesTo, salesPct);
    setSalesErrors(errors);
    if (errors.period || errors.pct) return;
    const draft: Adjustment = { id: nextId(), kind: 'scale_sales', from: salesFrom, to: salesTo, change: { mode: 'factor', factorBps: bps } };
    add({ ...draft, label: describeAdjustment(draft, entriesById) });
    setSalesPct('');
  };
  const submitExpense = (event: FormEvent) => {
    event.preventDefault();
    const { errors, bps } = validateShock(expFrom, expTo, expPct);
    setExpErrors(errors);
    if (errors.period || errors.pct) return;
    const category = expCategory === ALL ? undefined : expCategory.slice(2);
    const draft: Adjustment = { id: nextId(), kind: 'scale_expense', from: expFrom, to: expTo, ...(category !== undefined ? { category } : {}), change: { mode: 'factor', factorBps: bps } };
    add({ ...draft, label: describeAdjustment(draft, entriesById) });
    setExpPct('');
  };

  const optionText = (e: CashEntry) => `${formatBR(e.dueDate).slice(0, 5)} · ${e.description} · ${formatBRL(BigInt(e.amountCents))} (${ORIGIN_LABELS[e.origin]})`;

  return (
    <div className="cf-stack">
      <CfAlert tone="neutral" title="Tudo aqui é hipótese">
        O simulador testa “e se…” sem mexer nos seus dados: nada é gravado, nenhuma transferência, antecipação ou contratação é feita, e o saldo real não muda. Ao recarregar a página as hipóteses somem.
      </CfAlert>

      <CfCard
        title="Hipóteses"
        description={`Cada hipótese altera só a Alternativa. Horizonte: ${snapshot.horizonDays} dias, de ${formatBR(firstDay)} a ${formatBR(horizonEnd)}.`}
        actions={
          <CfButton variant="secondary" disabled={adjustments.length === 0} onClick={reset}>
            Voltar ao original
          </CfButton>
        }
      >
        <div className="cf-stack">
          <div className="cf-grid cf-scenario-forms">
            <form className="cf-fieldset cf-hypo" onSubmit={submitDelay} aria-label="Atrasar um recebimento" noValidate>
              <h3 className="cf-scenario-form__title">Atrasar um recebimento</h3>
              {receivables.length === 0 ? (
                <p className="cf-muted">Não há recebimentos agendados no horizonte.</p>
              ) : (
                <div className="cf-stack">
                  <CfSelect label="Recebimento" value={delayEntry} onChange={(e) => setDelayEntry(e.target.value)} error={delayErrors.entry}>
                    <option value="">Escolha…</option>
                    {receivables.map((e) => (
                      <option key={e.id} value={e.id}>
                        {optionText(e)}
                      </option>
                    ))}
                  </CfSelect>
                  <CfField label="Atraso (dias corridos)" value={delayDays} onChange={(e) => setDelayDays(e.target.value)} error={delayErrors.days} hint="Sem dias úteis nem feriados. Ex.: 3" inputMode="numeric" />
                  <CfButton type="submit" variant="primary">
                    Adicionar atraso
                  </CfButton>
                </div>
              )}
            </form>

            <form className="cf-fieldset cf-hypo" onSubmit={submitSales} aria-label="Variar repasses de vendas" noValidate>
              <h3 className="cf-scenario-form__title">Variar repasses de vendas</h3>
              <div className="cf-stack">
                <CfField label="Vendas: de" type="date" value={salesFrom} onChange={(e) => setSalesFrom(e.target.value)} error={salesErrors.period} />
                <CfField label="Vendas: até" type="date" value={salesTo} onChange={(e) => setSalesTo(e.target.value)} />
                <CfField label="Vendas ficam em (%)" value={salesPct} onChange={(e) => setSalesPct(e.target.value)} error={salesErrors.pct} hint="100 = sem mudança · 80 = 20% a menos. Vale para repasses estimados de vendas já registradas, no dia do repasse." inputMode="decimal" />
                <CfButton type="submit" variant="primary">
                  Adicionar variação de vendas
                </CfButton>
              </div>
            </form>

            <form className="cf-fieldset cf-hypo" onSubmit={submitExpense} aria-label="Variar despesas" noValidate>
              <h3 className="cf-scenario-form__title">Variar despesas</h3>
              <div className="cf-stack">
                <CfField label="Despesas: de" type="date" value={expFrom} onChange={(e) => setExpFrom(e.target.value)} error={expErrors.period} />
                <CfField label="Despesas: até" type="date" value={expTo} onChange={(e) => setExpTo(e.target.value)} />
                <CfSelect label="Categoria de despesa" value={expCategory} onChange={(e) => setExpCategory(e.target.value)}>
                  <option value={ALL}>Todas as categorias</option>
                  {categories.map((c) => (
                    <option key={c} value={categoryValue(c)}>
                      {c === '' ? 'Sem categoria' : c}
                    </option>
                  ))}
                </CfSelect>
                <CfField label="Despesas ficam em (%)" value={expPct} onChange={(e) => setExpPct(e.target.value)} error={expErrors.pct} hint="100 = sem mudança · 120 = 20% a mais." inputMode="decimal" />
                <CfButton type="submit" variant="primary">
                  Adicionar variação de despesas
                </CfButton>
              </div>
            </form>
          </div>

          {notice && (
            <p className="cf-muted" role="status">
              {notice}
            </p>
          )}

          {adjustments.length > 0 && (
            <ul className="cf-scenario-list" aria-label="Hipóteses ativas">
              {adjustments.map((a) => (
                <li key={a.id} className="cf-scenario-list__item cf-hypo">
                  <CfBadge tone="demo">Hipótese</CfBadge>
                  <span className="cf-scenario-list__text">{describeAdjustment(a, entriesById)}</span>
                  <CfButton variant="ghost" aria-label={`Remover hipótese: ${describeAdjustment(a, entriesById)}`} onClick={() => onChange(adjustments.filter((x) => x.id !== a.id))}>
                    Remover
                  </CfButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CfCard>

      {outcome.error && (
        <CfAlert tone="negative" title="Não foi possível simular">
          {outcome.error}
        </CfAlert>
      )}
      {outcome.result && <ScenarioCompare result={outcome.result} hasAdjustments={adjustments.length > 0} />}
    </div>
  );
}
