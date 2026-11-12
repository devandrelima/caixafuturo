import { useMemo, useState } from 'react';
import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { ISODate } from '../domain/finance/types';
import { runBacktest, toForecastPoints } from '../domain/forecast/backtest';
import type { BacktestMetrics, BacktestReport, ModelBacktest } from '../domain/forecast/backtest';
import type { ModelId } from '../domain/forecast/models';
import { analyzeSeasonality, buildTrainingSeries } from '../domain/forecast/seasonality';
import type { SeasonalComponent, SeasonalityResult } from '../domain/forecast/seasonality';
import type { Sale } from '../domain/sales/types';
import { ForecastChart } from './ForecastChart';
import { shortDate } from './riskText';
import { CfAlert, CfBadge, CfButton, CfCard, CfSelect } from './ui/UiPrimitives';

export interface ForecastPanelProps {
  sales: readonly Sale[];
  /** Data-base: o faturamento realizado é conhecido até aqui; a previsão começa no dia seguinte. */
  baseDate: ISODate;
  demoMode: boolean;
  busy: boolean;
  onLoadDemoHistory: () => void;
  onGoSales: () => void;
}

export const HORIZON_OPTIONS = [7, 14, 28] as const;
const HISTORY_DAYS = 28;

/** "6,9%" a partir de pontos-base. */
export const formatPercentBps = (bps: number): string => `${(bps / 100).toFixed(1).replace('.', ',')}%`;

/** Padrão (decisão do usuário, ADR-0007): menor erro medido; sem medição, média móvel de 7 dias; senão o 1º elegível. */
export function pickDefaultModel(report: BacktestReport): ModelId | null {
  if (report.comparison.lowestErrorModel) return report.comparison.lowestErrorModel;
  const moving = report.models.find((m) => m.id === 'moving_average_7');
  if (moving?.eligible) return moving.id;
  return report.models.find((m) => m.eligible)?.id ?? null;
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const dash = '—';

/** "12/11" + "/2026": o ano some no mobile (CSS) para a tabela caber; segue no texto para leitores de tela e desktop. */
function DateText({ iso }: { iso: ISODate }) {
  const full = formatBR(iso);
  return (
    <>
      {full.slice(0, 5)}
      <span className="cf-year">{full.slice(5)}</span>
    </>
  );
}

function modelStatus(m: ModelBacktest, lowest: ModelId | null): { tone: 'neutral' | 'warning'; text: string } {
  if (!m.eligible) return { tone: 'neutral', text: 'Indisponível' };
  if (m.metrics === null) return { tone: 'warning', text: 'Sem erro medido' };
  return { tone: 'neutral', text: m.id === lowest ? 'Menor erro no período avaliado' : 'Erro medido' };
}

function statsLine(metrics: BacktestMetrics | null): { mae: string; wape: string; note: string } {
  if (!metrics) return { mae: dash, wape: dash, note: 'sem medição' };
  return {
    mae: formatBRL(metrics.maeCents),
    wape: metrics.wapeBps === null ? 'indefinido' : formatPercentBps(metrics.wapeBps),
    note: metrics.wapeNote ?? '',
  };
}

function SeasonalityCard({ result }: { result: SeasonalityResult }) {
  const weekly: SeasonalComponent = result.weekly;
  const groups = WEEKDAY_ORDER.map((w) => weekly.groups.find((g) => g.key === w)!);
  return (
    <CfCard
      title="Sazonalidade"
      description="Só é afirmada quando há amostra e padrão suficientes; caso contrário aparece o motivo, nunca um número inventado."
    >
      <div className="cf-stack">
        <div className="cf-row">
          <strong>Dia da semana:</strong>
          {weekly.status === 'seasonal' && <CfBadge tone="neutral">Padrão semanal detectado</CfBadge>}
          {weekly.status === 'not_seasonal' && <CfBadge tone="neutral">Sem padrão semanal claro</CfBadge>}
          {weekly.status === 'insufficient_data' && <CfBadge tone="warning">Dados insuficientes</CfBadge>}
        </div>
        {weekly.reason && <p className="cf-subtle">{weekly.reason}</p>}
        {weekly.status !== 'insufficient_data' && weekly.strengthBps !== null && (
          <p className="cf-subtle">
            Força do padrão: {formatPercentBps(weekly.strengthBps)} da variação do faturamento diário é explicada pelo dia da semana. É uma medida de tamanho de efeito, não uma probabilidade nem um teste estatístico.
          </p>
        )}
        {weekly.status !== 'insufficient_data' && (
          <div className="cf-table-wrap">
            <table className="cf-table cf-table--compact" aria-label="Índice sazonal por dia da semana">
              <caption>Índice = média do dia ÷ média geral (100% = igual à média). Valores atípicos ficam de fora.</caption>
              <thead>
                <tr>
                  <th scope="col">Dia</th>
                  <th scope="col" className="cf-num">Dias usados</th>
                  <th scope="col" className="cf-num">Média</th>
                  <th scope="col" className="cf-num">Índice</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key}>
                    <th scope="row">{g.label}</th>
                    <td className="cf-num">{g.observations}</td>
                    <td className="cf-num">{g.meanCents === null ? dash : formatBRL(g.meanCents)}</td>
                    <td className="cf-num">{g.indexBps === null ? dash : formatPercentBps(g.indexBps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.outliers.length > 0 && (
          <div>
            <strong>Valores atípicos excluídos do índice</strong>
            <ul className="cf-list">
              {result.outliers.map((o) => (
                <li key={o.date}>
                  {formatBR(o.date)}:{' '}
                  {o.filled
                    ? 'dia sem venda registrada, tratado como R$ 0 (lacuna ou dia fechado)'
                    : `${formatBRL(o.valueCents)}, bem fora do usual para esse dia da semana (mediana ${formatBRL(o.medianCents)})`}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="cf-row">
          <strong>Período do mês:</strong>
          {result.monthly.status === 'seasonal' && <CfBadge tone="neutral">Padrão por período detectado</CfBadge>}
          {result.monthly.status === 'not_seasonal' && <CfBadge tone="neutral">Sem padrão por período claro</CfBadge>}
          {result.monthly.status === 'insufficient_data' && <CfBadge tone="warning">Dados insuficientes</CfBadge>}
        </div>
        {result.monthly.reason && <p className="cf-subtle">{result.monthly.reason}</p>}
        {result.monthly.status !== 'insufficient_data' && (
          <ul className="cf-list">
            {result.monthly.groups.map((g) => (
              <li key={g.key}>
                {g.label}: média {g.meanCents === null ? dash : formatBRL(g.meanCents)} · índice {g.indexBps === null ? dash : formatPercentBps(g.indexBps)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </CfCard>
  );
}

function ComparisonCard({ report, selectedId }: { report: BacktestReport; selectedId: ModelId | null }) {
  const { comparison } = report;
  return (
    <CfCard
      title="Comparação de modelos (backtesting)"
      description="Cada modelo é treinado só com dados anteriores ao período avaliado e comparado com o faturamento que realmente aconteceu, nas mesmas janelas."
    >
      <div className="cf-stack">
        {comparison.status === 'insufficient' ? (
          <CfAlert tone="warning" title="Dados insuficientes para medir o erro">
            {comparison.reason}
          </CfAlert>
        ) : (
          <p className="cf-subtle">
            Erro medido em {comparison.comparableFolds} janelas semanais ({comparison.points} previsões do dia comparadas com o realizado), de {report.evaluation.evalFrom && formatBR(report.evaluation.evalFrom)} a {report.evaluation.evalTo && formatBR(report.evaluation.evalTo)}.
            MAE é o erro absoluto médio por dia; WAPE é o erro absoluto total dividido pelo faturamento realizado. Viés positivo = o modelo costuma prever menos do que aconteceu.
          </p>
        )}
        <div className="cf-table-wrap">
          <table className="cf-table cf-table--compact" aria-label="Erro de cada modelo no período avaliado">
            <thead>
              <tr>
                <th scope="col">Modelo</th>
                <th scope="col" className="cf-num">MAE</th>
                <th scope="col" className="cf-num">WAPE</th>
                <th scope="col" className="cf-num">Viés</th>
              </tr>
            </thead>
            <tbody>
              {report.models.map((m) => {
                const s = statsLine(m.metrics);
                return (
                  <tr key={m.id} aria-current={m.id === selectedId ? 'true' : undefined}>
                    <th scope="row" className="cf-wrap">
                      {m.label}
                      {m.id === selectedId ? ' (selecionado)' : ''}
                    </th>
                    <td className="cf-num">{s.mae}</td>
                    <td className="cf-num">{s.wape}</td>
                    <td className="cf-num">{m.metrics ? formatBRL(m.metrics.biasCents) : dash}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="cf-list" aria-label="Situação de cada modelo">
          {report.models.map((m) => {
            const status = modelStatus(m, comparison.lowestErrorModel);
            const why = m.reason ?? m.backtestNote;
            return (
              <li key={m.id}>
                <div className="cf-row">
                  <strong>{m.label}</strong>
                  <CfBadge tone={status.tone}>{status.text}</CfBadge>
                </div>
                <p className="cf-subtle">{m.description}</p>
                {why && <p className="cf-subtle">{why}</p>}
                {m.metrics?.wapeNote && <p className="cf-subtle">{m.metrics.wapeNote}</p>}
              </li>
            );
          })}
        </ul>
        <p className="cf-subtle">
          Parâmetros fixos e documentados (ADR-0007); nada é ajustado olhando o desempenho. &quot;Menor erro no período avaliado&quot; descreve só o passado destes dados, não é garantia de que será o melhor no futuro.
        </p>
      </div>
    </CfCard>
  );
}

function ActualVsPredictedCard({ model, horizonDays }: { model: ModelBacktest; horizonDays: number }) {
  const [foldIndex, setFoldIndex] = useState<number | null>(null);
  const folds = model.folds;
  if (folds.length === 0) {
    return (
      <CfCard title="Previsto versus realizado" description="Compara o que o modelo teria previsto com o faturamento realmente importado.">
        <CfAlert tone="warning" title="Sem comparação disponível">
          {model.backtestNote ?? 'O modelo escolhido não tem janelas avaliadas.'}
        </CfAlert>
      </CfCard>
    );
  }
  const index = foldIndex !== null && foldIndex < folds.length ? foldIndex : folds.length - 1;
  const fold = folds[index] as (typeof folds)[number];
  return (
    <CfCard
      title="Previsto versus realizado"
      description="Previsão retrospectiva: o que o modelo teria previsto usando só os dados até a data de corte de cada janela. Não é a previsão emitida na época; se vendas antigas forem corrigidas, estes valores mudam."
    >
      <div className="cf-stack">
        <div className="cf-table-wrap">
          <table className="cf-table cf-table--compact" aria-label={`Previsto versus realizado por janela, modelo ${model.label}`}>
            <thead>
              <tr>
                <th scope="col">Dias avaliados</th>
                <th scope="col" className="cf-num">Previsto</th>
                <th scope="col" className="cf-num">Realizado</th>
                <th scope="col" className="cf-num">Erro absoluto</th>
              </tr>
            </thead>
            <tbody>
              {folds.map((f) => (
                <tr key={f.origin}>
                  <th scope="row">{`${shortDate(f.evalFrom)} a ${shortDate(f.evalTo)}`}</th>
                  <td className="cf-num">{formatBRL(f.predictedCents)}</td>
                  <td className="cf-num">{formatBRL(f.actualCents)}</td>
                  <td className="cf-num cf-num--stack">
                    {formatBRL(f.absErrorCents)} <span className="cf-block">{f.wapeBps === null ? '(WAPE indefinido)' : `(${formatPercentBps(f.wapeBps)})`}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cf-subtle">Cada janela tem {horizonDays} dias; o corte é o dia anterior ao primeiro dia avaliado.</p>
        <CfSelect
          label="Ver dia a dia a janela"
          value={String(index)}
          onChange={(e) => setFoldIndex(Number(e.target.value))}
        >
          {folds.map((f, i) => (
            <option key={f.origin} value={i}>
              {`Corte ${formatBR(f.origin)} · avaliada de ${shortDate(f.evalFrom)} a ${shortDate(f.evalTo)}`}
            </option>
          ))}
        </CfSelect>
        <div className="cf-table-wrap">
          <table className="cf-table cf-table--compact" aria-label={`Dia a dia da janela com corte em ${formatBR(fold.origin)}`}>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col" className="cf-num">Previsto</th>
                <th scope="col" className="cf-num">Realizado</th>
                <th scope="col" className="cf-num">Erro (realizado − previsto)</th>
              </tr>
            </thead>
            <tbody>
              {fold.points.map((p) => (
                <tr key={p.date}>
                  <th scope="row">
                    <DateText iso={p.date} />
                    {p.filled ? ' · sem venda (R$ 0)' : ''}
                  </th>
                  <td className="cf-num">{formatBRL(p.predictedCents)}</td>
                  <td className="cf-num">{formatBRL(p.actualCents)}</td>
                  <td className="cf-num">{`${p.errorCents > 0n ? '+' : ''}${formatBRL(p.errorCents)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </CfCard>
  );
}

/** Tela "Previsões": modelos, erro medido, faixas e previsto × realizado, sempre com limites claros. */
export function ForecastPanel({ sales, baseDate, demoMode, busy, onLoadDemoHistory, onGoSales }: ForecastPanelProps) {
  const [horizonDays, setHorizonDays] = useState<number>(7);
  const [chosen, setChosen] = useState<ModelId | null>(null);

  const report = useMemo(() => runBacktest(sales, { asOf: baseDate, horizonDays }), [sales, baseDate, horizonDays]);
  const seasonality = useMemo(() => analyzeSeasonality(sales, { cutoff: baseDate }), [sales, baseDate]);
  const history = useMemo(
    () => buildTrainingSeries(sales, baseDate).slice(-HISTORY_DAYS).map((p) => ({ date: p.date, cents: p.grossCents })),
    [sales, baseDate],
  );

  const defaultId = pickDefaultModel(report);
  const selectedId = chosen && report.models.find((m) => m.id === chosen)?.eligible ? chosen : defaultId;
  const selected = report.models.find((m) => m.id === selectedId) ?? null;
  const points = useMemo(() => (selectedId ? toForecastPoints(report, selectedId) : []), [report, selectedId]);
  const bandNote = selected && selected.band?.status !== 'available' ? (selected.band?.reason ?? selected.backtestNote ?? 'Sem erro medido suficiente.') : null;
  const stats = statsLine(selected?.metrics ?? null);
  const centralOutside = points.some((p) => p.lowerCents !== null && p.upperCents !== null && (p.centralCents < p.lowerCents || p.centralCents > p.upperCents));

  const noForecast = selected === null;

  return (
    <div className="cf-stack">
      <CfCard
        title="Previsão de faturamento bruto"
        description="Estimativa estatística do valor bruto das vendas dos próximos dias. Não é dinheiro disponível, não vira recebimento e não altera o saldo projetado."
      >
        <div className="cf-stack">
          {demoMode && (
            <CfAlert tone="neutral" title="Dados fictícios com padrão artificial">
              O histórico da demonstração é sintético e muito regular, então o erro medido aqui é baixo. Isso só mostra que o cálculo funciona; não indica o que aconteceria com vendas reais.
            </CfAlert>
          )}

          <div className="cf-grid cf-grid--two">
            <CfSelect
              label="Modelo"
              value={selectedId ?? ''}
              onChange={(e) => setChosen(e.target.value as ModelId)}
              disabled={noForecast}
              hint={noForecast ? 'Nenhum modelo disponível com os dados atuais.' : undefined}
            >
              {noForecast && <option value="">Sem modelo disponível</option>}
              {report.models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.eligible}>
                  {m.eligible ? (m.metrics ? m.label : `${m.label} (sem erro medido)`) : `${m.label} (indisponível)`}
                </option>
              ))}
            </CfSelect>
            <CfSelect
              label="Horizonte"
              value={String(horizonDays)}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              hint="O erro é medido nesta mesma distância."
            >
              {HORIZON_OPTIONS.map((h) => (
                <option key={h} value={h}>{`${h} dias`}</option>
              ))}
            </CfSelect>
          </div>

          {noForecast ? (
            <CfAlert tone="warning" title="Dados insuficientes: nenhuma previsão foi gerada">
              <p>{report.models[0]?.reason ?? report.comparison.reason ?? 'Importe vendas para ver a previsão.'}</p>
              <p>Sem histórico suficiente o app mostra este aviso em vez de um número.</p>
              <div className="cf-row" style={{ marginTop: 8 }}>
                {demoMode ? (
                  <CfButton variant="primary" disabled={busy} onClick={onLoadDemoHistory}>
                    Carregar histórico fictício de 12 semanas
                  </CfButton>
                ) : (
                  <CfButton variant="secondary" onClick={onGoSales}>
                    Importar vendas
                  </CfButton>
                )}
              </div>
            </CfAlert>
          ) : (
            <>
              <div className="cf-row">
                <strong>{selected.label}</strong>
                <CfBadge tone={modelStatus(selected, report.comparison.lowestErrorModel).tone}>{modelStatus(selected, report.comparison.lowestErrorModel).text}</CfBadge>
                {selected.id === selectedId && selectedId === defaultId && <span className="cf-subtle">modelo padrão</span>}
              </div>
              <p className="cf-subtle">{selected.description}</p>

              <div className="cf-grid cf-grid--stats">
                <div className="cf-stat">
                  <span className="cf-stat__label">Janela de treino</span>
                  <span className="cf-stat__value">{report.window.from && report.window.to ? `${shortDate(report.window.from)} a ${shortDate(report.window.to)}` : dash}</span>
                  <span className="cf-stat__note">{`${report.window.days} dias${report.window.filledDays > 0 ? ` (${report.window.filledDays} sem venda)` : ''}`}</span>
                </div>
                <div className="cf-stat">
                  <span className="cf-stat__label">Avaliação (backtesting)</span>
                  <span className="cf-stat__value">{selected.metrics ? `${selected.metrics.folds} janelas` : 'Não medida'}</span>
                  <span className="cf-stat__note">
                    {selected.metrics && report.evaluation.evalFrom && report.evaluation.evalTo
                      ? `${shortDate(report.evaluation.evalFrom)} a ${shortDate(report.evaluation.evalTo)} · ${selected.metrics.points} dias`
                      : 'sem erro medido'}
                  </span>
                </div>
                <div className="cf-stat">
                  <span className="cf-stat__label">Erro médio por dia (MAE)</span>
                  <span className="cf-stat__value">{stats.mae}</span>
                  <span className="cf-stat__note">no período avaliado</span>
                </div>
                <div className="cf-stat">
                  <span className="cf-stat__label">Erro relativo (WAPE)</span>
                  <span className="cf-stat__value">{stats.wape}</span>
                  <span className="cf-stat__note">{stats.note || 'erro total ÷ realizado'}</span>
                </div>
              </div>

              <ForecastChart history={history} points={points} />

              {bandNote ? (
                <CfAlert tone="warning" title="Faixa indisponível">
                  {bandNote} A previsão central aparece sem faixa e sem erro medido.
                </CfAlert>
              ) : (
                <p className="cf-subtle">
                  Faixa dos erros passados: soma à previsão o 10º e o 90º percentis dos {selected.band?.status === 'available' ? selected.band.residuals : 0} erros históricos deste modelo. Não é intervalo de confiança nem promete que o futuro ficará dentro dela.
                  {centralOutside ? ' Em alguns dias a previsão central fica fora da faixa: nos dados passados o modelo errou quase sempre para o mesmo lado.' : ''}
                </p>
              )}

              <details className="cf-details" open>
                <summary>Tabela de valores da previsão</summary>
                <div className="cf-details__body">
                  <div className="cf-table-wrap">
                    <table className="cf-table cf-table--compact" aria-label={`Faturamento bruto previsto, modelo ${selected.label}`}>
                      <thead>
                        <tr>
                          <th scope="col">Data</th>
                          <th scope="col" className="cf-num">Conservadora</th>
                          <th scope="col" className="cf-num">Central</th>
                          <th scope="col" className="cf-num">Otimista</th>
                        </tr>
                      </thead>
                      <tbody>
                        {points.map((p) => (
                          <tr key={p.date}>
                            <th scope="row"><DateText iso={p.date} /></th>
                            <td className="cf-num">{p.lowerCents === null ? dash : formatBRL(p.lowerCents)}</td>
                            <td className="cf-num">{formatBRL(p.centralCents)}</td>
                            <td className="cf-num">{p.upperCents === null ? dash : formatBRL(p.upperCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="cf-subtle">Valores em faturamento bruto. Conservadora e otimista são os extremos da faixa dos erros passados; {dash} = sem faixa.</p>
                </div>
              </details>
            </>
          )}

          {report.warnings.map((w) => (
            <CfAlert key={w} tone="warning" title="Atenção">
              {w}
            </CfAlert>
          ))}
        </div>
      </CfCard>

      <ComparisonCard report={report} selectedId={selectedId} />

      {selected && <ActualVsPredictedCard model={selected} horizonDays={horizonDays} />}

      <SeasonalityCard result={seasonality} />

      <CfCard title="O que esta tela mostra e o que não mostra">
        <ul className="cf-list">
          <li>Mostra o erro que cada método teria tido <strong>nestes dados</strong>. Não garante o erro futuro nem uma &quot;precisão&quot;.</li>
          <li>A previsão é de <strong>faturamento bruto</strong>. Para virar caixa seria preciso aplicar taxas e prazos de repasse; isso não é feito aqui e o saldo projetado não muda.</li>
          <li>Previsto × realizado é <strong>retrospectivo</strong>: recalculado com os dados até cada corte, não gravado na época.</li>
          <li>Com poucas janelas (menos de 8) a medição de erro é instável; sem ao menos 4 janelas nenhum erro é medido e nenhuma faixa aparece.</li>
          <li>Dias sem venda entram como R$ 0 e são sinalizados; valores muito fora do padrão ficam de fora da sazonalidade, mas não são apagados dos dados.</li>
        </ul>
      </CfCard>
    </div>
  );
}
