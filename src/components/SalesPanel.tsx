import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { baselineForecast, manualProjection, MAX_FORECAST_DAYS } from '../domain/forecast/baseline';
import type { ForecastPoint } from '../domain/forecast/baseline';
import { addDays, formatBR } from '../domain/finance/dates';
import type { ISODate } from '../domain/finance/types';
import { formatBRL, parseBRL } from '../domain/finance/money';
import { grossByDay, totalGrossCents } from '../domain/sales/importSales';
import type { Sale, SalesImportPlan, SalesPreview } from '../domain/sales/types';
import { CfAlert, CfBadge, CfButton, CfCard, CfField } from './ui/UiPrimitives';

export interface PendingSalesImport {
  fileName: string;
  preview: SalesPreview;
  plan: SalesImportPlan;
}

export interface SalesPanelProps {
  baseDate: ISODate;
  sales: readonly Sale[];
  pendingImport: PendingSalesImport | null;
  busy: boolean;
  demoMode: boolean;
  onPickCsv: (file: File) => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  onLoadDemoSales: () => void;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <CfCard>
      <div className="cf-stat">
        <span className="cf-stat__label">{label}</span>
        <span className="cf-stat__value">{value}</span>
        {note && <span className="cf-stat__note">{note}</span>}
      </div>
    </CfCard>
  );
}

const TREND_TEXT = { up: 'Subindo', down: 'Caindo', flat: 'Estável', unknown: 'Sem dados suficientes' } as const;

/** Prévia da importação de vendas: nada é gravado antes de confirmar; erro por linha. */
function SalesImportPreview({ pending, busy, onConfirm, onCancel }: { pending: PendingSalesImport; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { preview, plan } = pending;
  const { created, ignored, errors } = plan.summary;
  return (
    <section className="cf-card" aria-label="Prévia da importação de vendas">
      <div className="cf-card__head">
        <div>
          <h3 className="cf-card__title">Prévia da importação de vendas</h3>
          <p className="cf-card__desc">Arquivo: {pending.fileName}</p>
        </div>
      </div>
      <div className="cf-stack">
        {preview.fatalError ? (
          <CfAlert tone="negative" title="Não foi possível ler o arquivo">
            {preview.fatalError}
          </CfAlert>
        ) : (
          <>
            <div className="cf-row" aria-label="Resumo da prévia">
              <CfBadge tone="positive">{created} a importar</CfBadge>
              <CfBadge tone="neutral">{ignored} já importada(s) ou duplicada(s)</CfBadge>
              <CfBadge tone={errors > 0 ? 'negative' : 'neutral'}>{errors} com erro</CfBadge>
              <span className="cf-subtle">{preview.totalRows} linha(s) de dados</span>
            </div>
            {created > 0 && <p className="cf-muted">Faturamento bruto a importar: {formatBRL(BigInt(plan.summary.grossCreatedCents))}. Vendas não são dinheiro disponível.</p>}
            {errors > 0 && (
              <div className="cf-table-wrap">
                <table className="cf-table" aria-label="Linhas com erro">
                  <thead>
                    <tr>
                      <th scope="col">Linha</th>
                      <th scope="col">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.errors.map((e) => (
                      <tr key={`${e.line}-${e.message}`}>
                        <th scope="row">{e.line}</th>
                        <td style={{ whiteSpace: 'normal' }}>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {errors > 0 && <p className="cf-subtle">As linhas com erro não serão importadas. Corrija o arquivo e envie de novo, se desejar.</p>}
            {created === 0 && errors === 0 && <p className="cf-muted">Nada novo para importar: todas as vendas já existem.</p>}
          </>
        )}
        <div className="cf-row">
          <CfButton variant="primary" loading={busy} disabled={created === 0 || preview.fatalError !== null} onClick={onConfirm}>
            {created > 0 ? `Importar ${created} venda(s)` : 'Importar'}
          </CfButton>
          <CfButton variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </CfButton>
        </div>
      </div>
    </section>
  );
}

function ManualHypothesis({ baseDate }: { baseDate: ISODate }) {
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('7');
  const [error, setError] = useState<string | undefined>();
  const [points, setPoints] = useState<ForecastPoint[]>([]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const money = parseBRL(amount, { allowZero: true });
    if (!money.ok) {
      setError(money.reason);
      setPoints([]);
      return;
    }
    const result = manualProjection({ startDate: addDays(baseDate, 1), days: Number(days), dailyGrossCents: money.cents });
    if (!result.ok) {
      setError(result.reason);
      setPoints([]);
      return;
    }
    setError(undefined);
    setPoints(result.points);
  }

  return (
    <CfCard
      title="Projeção manual (hipótese)"
      description="Informe quanto você espera faturar por dia. É uma suposição sua, sem dados de treino, e nunca é tratada como previsão validada."
      headingLevel={3}
    >
      <form className="cf-stack" onSubmit={submit} noValidate aria-label="Projeção manual de faturamento">
        <div className="cf-grid cf-grid--two">
          <CfField label="Faturamento diário esperado (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} error={error} hint="Ex.: 1.500,00" inputMode="decimal" />
          <CfField label="Dias" value={days} onChange={(e) => setDays(e.target.value)} hint={`1 a ${MAX_FORECAST_DAYS}`} inputMode="numeric" />
        </div>
        <div className="cf-row">
          <CfButton variant="secondary" type="submit">
            Projetar hipótese
          </CfButton>
        </div>
      </form>
      {points.length > 0 && (
        <div className="cf-stack" style={{ marginTop: 12 }}>
          <CfAlert tone="warning" title="Isto é uma hipótese, não uma previsão">
            A projeção manual de faturamento não entra no saldo projetado e não gera recebíveis.
          </CfAlert>
          <div className="cf-table-wrap">
            <table className="cf-table" aria-label="Hipótese manual de faturamento">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col" className="cf-num">Faturamento bruto</th>
                  <th scope="col">Natureza</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.date}>
                    <th scope="row">{formatBR(p.date)}</th>
                    <td className="cf-num">{formatBRL(p.centralCents)}</td>
                    <td>{p.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </CfCard>
  );
}

/** Área "Faturamento bruto": histórico importado, média/tendência, baseline com avisos e hipótese manual. */
export function SalesPanel({ baseDate, sales, pendingImport, busy, demoMode, onPickCsv, onConfirmImport, onCancelImport, onLoadDemoSales }: SalesPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const forecast = useMemo(() => baselineForecast(sales, { asOf: baseDate }), [sales, baseDate]);
  const total = useMemo(() => totalGrossCents(sales), [sales]);
  const days = useMemo(() => grossByDay(sales).slice(-14).reverse(), [sales]);
  const stats = forecast.stats;
  const trend = stats?.trend;

  return (
    <div className="cf-stack">
      <CfCard
        title="Faturamento bruto"
        description="Vendas importadas, no valor cobrado do cliente. Faturamento bruto não é dinheiro disponível: o caixa só aumenta quando o repasse é recebido."
        actions={
          <>
            <CfButton variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
              Importar vendas (CSV)
            </CfButton>
            {demoMode && (
              <CfButton variant="secondary" disabled={busy} onClick={onLoadDemoSales}>
                Carregar vendas fictícias
              </CfButton>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="cf-visually-hidden"
              aria-label="Arquivo CSV de vendas"
              data-testid="sales-csv-input"
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
        {sales.length === 0 ? (
          <p className="cf-muted">
            Nenhuma venda importada. Envie um CSV com as colunas identificador_venda, data_venda, valor_bruto, meio_pagamento e categoria (opcional). O identificador é obrigatório e evita contar a mesma venda duas vezes.
          </p>
        ) : (
          <div className="cf-grid cf-grid--stats">
            <Stat label="Faturamento bruto importado" value={formatBRL(total)} note={`${sales.length} venda(s)`} />
            <Stat label="Média diária de vendas" value={stats ? formatBRL(stats.meanCents) : '—'} note={stats ? `${stats.days} dia(s) · ${formatBR(stats.fromDate)} a ${formatBR(stats.toDate)}` : undefined} />
            <Stat
              label="Tendência (7 dias vs 7 anteriores)"
              value={trend ? TREND_TEXT[trend.direction] : '—'}
              note={trend?.changeBps != null ? `${trend.changeBps > 0 ? '+' : ''}${(trend.changeBps / 100).toFixed(2).replace('.', ',')}%` : undefined}
            />
          </div>
        )}
      </CfCard>

      {pendingImport && <SalesImportPreview pending={pendingImport} busy={busy} onConfirm={onConfirmImport} onCancel={onCancelImport} />}

      {sales.length > 0 && (
        <>
          <CfCard title="Faturamento por dia" description="Últimos dias com venda. Cada linha soma todas as vendas do dia." headingLevel={3}>
            <div className="cf-table-wrap">
              <table className="cf-table" aria-label="Faturamento bruto por dia">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col" className="cf-num">Faturamento bruto</th>
                    <th scope="col" className="cf-num">Vendas</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <th scope="row">{formatBR(d.date)}</th>
                      <td className="cf-num">{formatBRL(d.grossCents)}</td>
                      <td className="cf-num">{d.saleIds.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CfCard>

          <CfCard
            title="Previsão de faturamento (informativa)"
            description="Média simples do histórico. Não foi validada por backtesting, não tem faixa de erro e não entra no saldo projetado."
            headingLevel={3}
          >
            <div className="cf-stack">
              {forecast.warnings.map((w) => (
                <CfAlert key={w.code} tone="warning" title={w.code === 'insufficient_history' ? 'Histórico insuficiente' : 'Atenção ao histórico'}>
                  {w.message}
                </CfAlert>
              ))}
              {forecast.points.length > 0 && stats && (
                <p>
                  <strong>Média histórica (baseline não validado)</strong>: {formatBRL(stats.meanCents)} por dia, repetida nos próximos {forecast.points.length} dias (de {formatBR((forecast.points[0] as ForecastPoint).date)} a {formatBR((forecast.points[forecast.points.length - 1] as ForecastPoint).date)}). Treino até {formatBR(stats.toDate)}, {stats.days} dia(s).
                </p>
              )}
            </div>
          </CfCard>
        </>
      )}

      <ManualHypothesis baseDate={baseDate} />
    </div>
  );
}
