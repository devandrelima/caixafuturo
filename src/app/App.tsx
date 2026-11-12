import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import type { View } from '../components/AppShell';
import { CashDashboard } from '../components/CashDashboard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EntriesPanel } from '../components/EntriesPanel';
import { EntryForm, SettingsForm } from '../components/FinanceForm';
import { ImportPreview } from '../components/ImportPreview';
import { Onboarding } from '../components/Onboarding';
import { RiskCalendar } from '../components/RiskCalendar';
import { CfAlert, CfButton, CfCard } from '../components/ui/UiPrimitives';
import { createRestaurantDemo } from '../demo/restaurant';
import { todayISO, formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import { ProjectionError, project } from '../domain/finance/projection';
import type { ProjectionResult } from '../domain/finance/projection';
import type { CashEntry, CashSettings, ISODate } from '../domain/finance/types';
import { planImport, previewAccountsCsv } from '../domain/import/csv';
import type { CsvPreview, ImportPlan } from '../domain/import/csv';
import { getRepository, StorageError } from '../storage/repository';
import type { DatasetKind, EntryDraft, Repository } from '../storage/repository';

const VIEWS: readonly View[] = ['visao-geral', 'movimentacoes', 'calendario'];
const TITLES: Record<View, { title: string; subtitle: string }> = {
  'visao-geral': { title: 'Visão geral', subtitle: 'Fluxo projetado com base nos seus lançamentos.' },
  movimentacoes: { title: 'Movimentações', subtitle: 'Cadastre, importe e ajuste contas a pagar e a receber.' },
  calendario: { title: 'Calendário', subtitle: 'Veja o saldo e os lançamentos de cada data.' },
};

interface Data {
  settings: CashSettings | null;
  entries: CashEntry[];
  kind: DatasetKind | null;
}
type Phase = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };
type Notice = { tone: 'positive' | 'negative' | 'warning'; text: string } | null;
type Confirm =
  | { type: 'demo' }
  | { type: 'clear' }
  | { type: 'delete'; entry: CashEntry }
  | null;
interface PendingImport {
  fileName: string;
  preview: CsvPreview;
  plan: ImportPlan;
}

const viewFromHash = (): View => {
  const hash = window.location.hash.replace('#', '');
  return (VIEWS as readonly string[]).includes(hash) ? (hash as View) : 'visao-geral';
};

const messageOf = (error: unknown): string =>
  error instanceof StorageError ? error.message : error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';

/** Decodifica o CSV: UTF-8 estrito e, se inválido, Windows-1252 (comum em planilhas brasileiras). */
async function readCsvFile(file: File): Promise<string> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export interface AppProps {
  repository?: Repository;
}

export function App({ repository }: AppProps) {
  const repo = useMemo(() => repository ?? getRepository(), [repository]);
  const [phase, setPhase] = useState<Phase>({ status: 'loading' });
  const [data, setData] = useState<Data>({ settings: null, entries: [], kind: null });
  const [view, setView] = useState<View>(viewFromHash);
  const [started, setStarted] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [editing, setEditing] = useState<CashEntry | 'new' | null>(null);
  const [editingSettings, setEditingSettings] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [selectedDate, setSelectedDate] = useState<ISODate | null>(null);

  const reload = useCallback(async () => {
    const [settings, entries, kind] = await Promise.all([repo.getSettings(), repo.listEntries(), repo.getDatasetKind()]);
    setData({ settings, entries, kind });
  }, [repo]);

  useEffect(() => {
    let alive = true;
    reload()
      .then(() => alive && setPhase({ status: 'ready' }))
      .catch((error: unknown) => alive && setPhase({ status: 'error', message: messageOf(error) }));
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (next: View) => {
    window.location.hash = next;
    setView(next);
  };

  // Motor: única origem de saldos, riscos e datas exibidos.
  const projection = useMemo<{ result: ProjectionResult | null; error: string | null }>(() => {
    if (!data.settings) return { result: null, error: null };
    try {
      return { result: project(data.settings, data.entries), error: null };
    } catch (error) {
      return { result: null, error: error instanceof ProjectionError ? error.message : 'Não foi possível calcular a projeção.' };
    }
  }, [data.settings, data.entries]);

  const entriesById = useMemo(() => new Map(data.entries.map((e) => [e.id, e] as const)), [data.entries]);
  const flaggedIds = useMemo(() => new Set(projection.result?.flagged.map((f) => f.entryId) ?? []), [projection.result]);
  const effectiveSelected = selectedDate ?? projection.result?.summary.firstRisk?.date ?? projection.result?.points[0]?.date ?? null;
  const hasData = data.settings !== null || data.entries.length > 0;
  const demoMode = data.kind === 'demo';

  async function run(action: () => Promise<void>, success?: string): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await reload();
      if (success) setNotice({ tone: 'positive', text: success });
      return true;
    } catch (error) {
      setNotice({ tone: 'negative', text: messageOf(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    const demo = createRestaurantDemo();
    const ok = await run(() => repo.replaceAll({ settings: demo.settings, entries: demo.entries, kind: 'demo' }), 'Demonstração carregada com dados fictícios de um restaurante.');
    if (ok) {
      setStarted(true);
      setSelectedDate(null);
      setEditing(null);
      setPendingImport(null);
      navigate('visao-geral');
    }
  }

  async function saveSettings(settings: CashSettings) {
    setFormError(undefined);
    setBusy(true);
    try {
      await repo.saveSettings(settings);
      await reload();
      setEditingSettings(false);
      setNotice({ tone: 'positive', text: 'Saldos salvos.' });
    } catch (error) {
      setFormError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry(draft: EntryDraft) {
    setFormError(undefined);
    setBusy(true);
    try {
      if (editing && editing !== 'new') await repo.updateEntry({ ...editing, ...draft, category: draft.category ?? '' });
      else await repo.addEntry(draft);
      await reload();
      setNotice({ tone: 'positive', text: editing && editing !== 'new' ? 'Lançamento atualizado.' : 'Lançamento adicionado.' });
      setEditing(null);
    } catch (error) {
      setFormError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  async function pickCsv(file: File) {
    setNotice(null);
    try {
      const text = await readCsvFile(file);
      const preview = previewAccountsCsv(text);
      setPendingImport({ fileName: file.name, preview, plan: planImport(preview, data.entries.map((e) => e.sourceKey)) });
    } catch (error) {
      setNotice({ tone: 'negative', text: messageOf(error) });
    }
  }

  async function confirmImport() {
    if (!pendingImport) return;
    setBusy(true);
    setNotice(null);
    try {
      // Reconsulta as chaves atuais: a gravação é a fonte de verdade da idempotência.
      const result = await repo.importEntries(pendingImport.plan.toCreate);
      await reload();
      setNotice({
        tone: 'positive',
        text: `Importação concluída: ${result.created.length} criado(s), ${result.skipped.length + pendingImport.plan.summary.ignored} ignorado(s) por já existirem, ${pendingImport.plan.summary.errors} linha(s) com erro não importada(s).`,
      });
      setPendingImport(null);
    } catch (error) {
      setNotice({ tone: 'negative', text: `${messageOf(error)} Nenhum lançamento do arquivo foi gravado.` });
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    const current = confirm;
    if (!current) return;
    if (current.type === 'demo') {
      setConfirm(null);
      await loadDemo();
    } else if (current.type === 'delete') {
      await run(() => repo.deleteEntry(current.entry.id), 'Lançamento excluído.');
      setConfirm(null);
    } else {
      const ok = await run(() => repo.clearAll({ confirmed: true }), 'Todos os dados foram apagados deste navegador.');
      setConfirm(null);
      if (ok) {
        setStarted(false);
        setEditing(null);
        setPendingImport(null);
        setSelectedDate(null);
      }
    }
  }

  if (phase.status === 'loading') {
    return (
      <main className="cf-onboarding">
        <p role="status">Carregando seus dados…</p>
      </main>
    );
  }
  if (phase.status === 'error') {
    return (
      <main className="cf-onboarding">
        <div className="cf-onboarding__inner">
          <CfAlert tone="negative" title="Não foi possível abrir o armazenamento deste navegador">
            {phase.message}
          </CfAlert>
          <CfButton variant="primary" onClick={() => window.location.reload()}>
            Tentar novamente
          </CfButton>
        </div>
      </main>
    );
  }

  if (!hasData && !started) {
    return (
      <Onboarding
        onExploreDemo={() => void loadDemo()}
        onStartEmpty={() => {
          setStarted(true);
          navigate('visao-geral');
        }}
        isLoading={busy}
        errorMessage={notice?.tone === 'negative' ? notice.text : undefined}
      />
    );
  }

  const { title, subtitle } = TITLES[view];
  const noSettingsCard = (
    <SettingsForm
      defaultBaseDate={todayISO()}
      saving={busy}
      error={formError}
      onSubmit={(s) => void saveSettings(s)}
      title="Comece informando seus saldos"
    />
  );

  return (
    <AppShell activeView={view} onNavigate={navigate} demoMode={demoMode}>
      <div className="cf-page">
        <div className="cf-page__head">
          <h1 className="cf-page__title">{title}</h1>
          <p className="cf-page__subtitle">{subtitle}</p>
        </div>

        {notice && (
          <CfAlert tone={notice.tone} title={notice.tone === 'negative' ? 'Atenção' : 'Pronto'}>
            {notice.text}
          </CfAlert>
        )}
        {projection.error && (
          <CfAlert tone="negative" title="Não foi possível calcular a projeção">
            {projection.error}
          </CfAlert>
        )}

        {view === 'movimentacoes' ? (
          <>
            {editingSettings || !data.settings ? (
              <SettingsForm
                initial={data.settings}
                defaultBaseDate={todayISO()}
                saving={busy}
                error={formError}
                onSubmit={(s) => void saveSettings(s)}
                onCancel={data.settings ? () => setEditingSettings(false) : undefined}
              />
            ) : (
              <CfCard
                title="Saldos do caixa"
                actions={
                  <CfButton variant="secondary" onClick={() => { setFormError(undefined); setEditingSettings(true); }}>
                    Editar saldos
                  </CfButton>
                }
              >
                <p>
                  Data-base <strong>{formatBR(data.settings.baseDate)}</strong> · saldo inicial <strong>{formatBRL(BigInt(data.settings.openingBalanceCents))}</strong> · saldo mínimo{' '}
                  <strong>{formatBRL(BigInt(data.settings.minimumBalanceCents))}</strong>
                </p>
              </CfCard>
            )}

            {editing && (
              <EntryForm
                key={editing === 'new' ? 'new' : editing.id}
                initial={editing === 'new' ? null : editing}
                saving={busy}
                error={formError}
                onSubmit={(d) => void saveEntry(d)}
                onCancel={() => { setEditing(null); setFormError(undefined); }}
              />
            )}

            {pendingImport && (
              <ImportPreview
                fileName={pendingImport.fileName}
                preview={pendingImport.preview}
                plan={pendingImport.plan}
                importing={busy}
                onConfirm={() => void confirmImport()}
                onCancel={() => setPendingImport(null)}
              />
            )}

            <EntriesPanel
              entries={data.entries}
              flaggedIds={flaggedIds}
              disabled={busy}
              onAdd={() => { setFormError(undefined); setEditing('new'); }}
              onPickCsv={(f) => void pickCsv(f)}
              onEdit={(e) => { setFormError(undefined); setEditing(e); }}
              onDelete={(e) => setConfirm({ type: 'delete', entry: e })}
            />

            <CfCard title="Seus dados" description="Ficam neste navegador. Não há sincronização entre dispositivos nem backup automático.">
              <div className="cf-row">
                <CfButton variant="secondary" disabled={busy} onClick={() => (hasData ? setConfirm({ type: 'demo' }) : void loadDemo())}>
                  Carregar demonstração
                </CfButton>
                <CfButton variant="danger" disabled={busy || !hasData} onClick={() => setConfirm({ type: 'clear' })}>
                  Apagar todos os dados
                </CfButton>
              </div>
            </CfCard>
          </>
        ) : !data.settings ? (
          noSettingsCard
        ) : projection.result ? (
          view === 'visao-geral' ? (
            <CashDashboard settings={data.settings} result={projection.result} entriesById={entriesById} selectedDate={effectiveSelected} onSelectDate={setSelectedDate} />
          ) : (
            <CalendarOnly result={projection.result} entriesById={entriesById} selectedDate={effectiveSelected} onSelectDate={setSelectedDate} />
          )
        ) : null}
      </div>

      {confirm?.type === 'demo' && (
        <ConfirmDialog title="Substituir seus dados pela demonstração?" confirmLabel="Substituir e carregar" busy={busy} onConfirm={() => void onConfirm()} onCancel={() => setConfirm(null)}>
          <p>Os dados atuais deste navegador (saldos e lançamentos) serão substituídos por dados fictícios de um restaurante. Isso não pode ser desfeito.</p>
        </ConfirmDialog>
      )}
      {confirm?.type === 'clear' && (
        <ConfirmDialog title="Apagar todos os dados?" confirmLabel="Apagar tudo" busy={busy} onConfirm={() => void onConfirm()} onCancel={() => setConfirm(null)}>
          <p>Saldos e lançamentos salvos neste navegador serão apagados. Isso não pode ser desfeito.</p>
        </ConfirmDialog>
      )}
      {confirm?.type === 'delete' && (
        <ConfirmDialog title="Excluir este lançamento?" confirmLabel="Excluir" busy={busy} onConfirm={() => void onConfirm()} onCancel={() => setConfirm(null)}>
          <p>{confirm.entry.description} ({formatBR(confirm.entry.dueDate)}) será removido e o painel será recalculado.</p>
        </ConfirmDialog>
      )}
    </AppShell>
  );
}

function CalendarOnly({ result, entriesById, selectedDate, onSelectDate }: { result: ProjectionResult; entriesById: ReadonlyMap<string, CashEntry>; selectedDate: ISODate | null; onSelectDate: (d: ISODate) => void }) {
  return <RiskCalendar points={result.points} entriesById={entriesById} selectedDate={selectedDate} onSelectDate={onSelectDate} firstRiskDate={result.summary.firstRisk?.date ?? null} />;
}
