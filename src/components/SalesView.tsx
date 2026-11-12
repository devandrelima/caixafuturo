import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { ProjectionResult } from '../domain/finance/projection';
import type { CashEntry, CashSettings } from '../domain/finance/types';
import type { ReconcileResult } from '../domain/sales/reconcile';
import type { ReconciliationDecision, Sale, SettlementRules } from '../domain/sales/types';
import { SalesPanel } from './SalesPanel';
import type { PendingSalesImport } from './SalesPanel';
import { SettlementPanel } from './SettlementPanel';
import { CfButton, CfCard } from './ui/UiPrimitives';

export interface SalesViewProps {
  settings: CashSettings;
  sales: readonly Sale[];
  rules: SettlementRules;
  decisions: readonly ReconciliationDecision[];
  reconciliation: ReconcileResult;
  projection: ProjectionResult;
  entriesById: ReadonlyMap<string, CashEntry>;
  pendingImport: PendingSalesImport | null;
  busy: boolean;
  demoMode: boolean;
  onPickCsv: (file: File) => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  onLoadDemoSales: () => void;
  onSaveRules: (rules: SettlementRules) => Promise<string | null>;
  onDecide: (decision: ReconciliationDecision) => void;
  onUndo: (decision: ReconciliationDecision) => void;
  onGoOverview: () => void;
}

/** Vista "Vendas e recebimentos": três áreas separadas — faturamento, recebimentos líquidos e saldo. */
export function SalesView(props: SalesViewProps) {
  const { settings, sales, projection, reconciliation } = props;
  const { summary, points } = projection;
  const last = points[points.length - 1];
  const salesByInternalId = new Map(sales.map((s) => [s.id, s.externalId] as const));
  const horizonEnd = last?.date ?? settings.baseDate;
  const inHorizon = reconciliation.receivables.filter((r) => r.counts && r.receivable.dueDate <= horizonEnd);
  const derivedInBalance = inHorizon.reduce((acc, r) => acc + r.receivable.netCents, 0n);

  return (
    <div className="cf-stack">
      <SalesPanel
        baseDate={settings.baseDate}
        sales={sales}
        pendingImport={props.pendingImport}
        busy={props.busy}
        demoMode={props.demoMode}
        onPickCsv={props.onPickCsv}
        onConfirmImport={props.onConfirmImport}
        onCancelImport={props.onCancelImport}
        onLoadDemoSales={props.onLoadDemoSales}
      />

      <SettlementPanel
        rules={props.rules}
        reconciliation={reconciliation}
        entriesById={props.entriesById}
        decisions={props.decisions}
        salesByInternalId={salesByInternalId}
        busy={props.busy}
        onSaveRules={props.onSaveRules}
        onDecide={props.onDecide}
        onUndo={props.onUndo}
      />

      <CfCard
        title="Saldo projetado"
        description="Caixa disponível ao longo de 30 dias. Soma contas agendadas, contas importadas e repasses estimados sem conta correspondente; vendas brutas e previsões de faturamento ficam de fora."
        actions={
          <CfButton variant="secondary" onClick={props.onGoOverview}>
            Ver visão geral
          </CfButton>
        }
      >
        <div className="cf-grid cf-grid--stats">
          <div className="cf-stat">
            <span className="cf-stat__label">{`Saldo informado em ${formatBR(settings.baseDate)}`}</span>
            <span className="cf-stat__value">{formatBRL(summary.openingCents)}</span>
          </div>
          <div className="cf-stat">
            <span className="cf-stat__label">{last ? `Saldo projetado em ${formatBR(last.date)}` : 'Saldo projetado'}</span>
            <span className="cf-stat__value">{formatBRL(summary.endingCents)}</span>
          </div>
          <div className="cf-stat">
            <span className="cf-stat__label">Repasses estimados no saldo</span>
            <span className="cf-stat__value">{formatBRL(derivedInBalance)}</span>
            <span className="cf-stat__note">{inHorizon.length} recebível(is) derivado(s) nos 30 dias</span>
          </div>
          <div className="cf-stat">
            <span className="cf-stat__label">Menor saldo projetado</span>
            <span className="cf-stat__value">{formatBRL(summary.lowest.closingCents)}</span>
            <span className="cf-stat__note">{`em ${formatBR(summary.lowest.date)}`}</span>
          </div>
        </div>
      </CfCard>
    </div>
  );
}
