import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatBR } from '../domain/finance/dates';
import { formatBRL } from '../domain/finance/money';
import type { ProjectionResult } from '../domain/finance/projection';
import type { EffectChange, SimulationResult } from '../domain/scenarios/types';
import { riskLabel, riskSentence, riskTone, shortDate } from './riskText';
import { CfAlert, CfBadge, CfButton, CfCard } from './ui/UiPrimitives';

export interface ScenarioCompareProps {
  result: SimulationResult;
  /** Há alguma hipótese ativa? Sem ela a Alternativa é igual ao Original e a tela diz isso. */
  hasAdjustments: boolean;
}

type Tab = 'original' | 'alternative';

const NARROW_QUERY = '(max-width: 767px)';

/** Telas estreitas mostram abas (Original | Alternativa) ao lado da diferença; as largas mostram tudo lado a lado. */
function useNarrow(): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** "+R$ 100,00" · "-R$ 100,00" · "R$ 0,00" (o sinal é sempre explícito quando há diferença). */
export const signedBRL = (cents: bigint): string => (cents > 0n ? `+${formatBRL(cents)}` : formatBRL(cents));

function Summary({ projection }: { projection: ProjectionResult }) {
  const { summary } = projection;
  const end = projection.points[projection.points.length - 1];
  return (
    <dl className="cf-compare__facts">
      <div>
        <dt>Saldo em {end ? formatBR(end.date) : '—'}</dt>
        <dd>{formatBRL(summary.endingCents)}</dd>
      </div>
      <div>
        <dt>Menor saldo</dt>
        <dd>
          {formatBRL(summary.lowest.closingCents)} em {shortDate(summary.lowest.date)}
        </dd>
      </div>
      <div>
        <dt>Primeiro alerta</dt>
        <dd>{summary.firstRisk ? riskSentence(summary.firstRisk) : 'Sem alerta no período'}</dd>
      </div>
      <div>
        <dt>Dias em alerta</dt>
        <dd>{summary.riskDays}</dd>
      </div>
    </dl>
  );
}

/** "Aluguel: data de 14/11/2026 para 21/11/2026" · "valor de R$ 2.000,00 para R$ 2.200,00" · "retirado da data original (15/11/2026)". */
export function changeText(change: EffectChange): string {
  if (change.field === 'dueDate') return `${change.description}: data de ${formatBR(change.from)} para ${formatBR(change.to as string)}`;
  if (change.field === 'amountCents') return `${change.description}: valor de ${formatBRL(BigInt(change.from))} para ${formatBRL(BigInt(change.to as string))}`;
  return `${change.description}: retirado da data original (${formatBR(change.from)}) na Alternativa; não existe mais nessa data`;
}

/**
 * Custos, datas e mudanças da hipótese em TEXTO, antes do resumo e da tabela: o que cada hipótese assume, os
 * lançamentos hipotéticos que ela cria (com valor e data) e o que muda nos lançamentos existentes (de → para).
 */
function HypothesisText({ result }: { result: SimulationResult }) {
  const horizonEnd = result.baseProjection.points[result.baseProjection.points.length - 1]?.date ?? '';
  const changes = result.effects.flatMap((e) => e.changes);
  return (
    <section className="cf-hypo cf-advanced__text" aria-label="Custos, datas e mudanças desta hipótese" data-hypothetical="true">
      <h3 className="cf-compare__head">
        Custos, datas e mudanças <CfBadge tone="demo">Hipótese</CfBadge>
      </h3>
      <details className="cf-details" open>
        <summary>{`Premissas desta hipótese (${result.assumptions.length})`}</summary>
        <div className="cf-details__body">
          <ul>
            {result.assumptions.map((a, i) => (
              <li key={`${i}-${a}`}>{a}</li>
            ))}
          </ul>
        </div>
      </details>
      {changes.length > 0 && (
        <div>
          <h4 className="cf-advanced__subhead">Mudanças em lançamentos existentes</h4>
          <ul aria-label="Mudanças em lançamentos existentes">
            {changes.map((c, i) => (
              <li key={`${i}-${c.entryId}-${c.field}`}>{changeText(c)}</li>
            ))}
          </ul>
        </div>
      )}
      {result.createdEntries.length > 0 && (
        <div>
          <h4 className="cf-advanced__subhead">Lançamentos hipotéticos criados (existem só nesta tela)</h4>
          <div className="cf-table-wrap">
            <table className="cf-table cf-table--compact cf-table--stack" role="table" aria-label="Lançamentos hipotéticos criados">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Descrição</th>
                  <th scope="col" className="cf-num">Valor</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {result.createdEntries.map((e) => (
                  <tr key={e.id} role="row" data-hypothetical="true">
                    <th scope="row" role="rowheader">
                      {formatBR(e.dueDate)}
                    </th>
                    <td role="cell" data-label="Descrição">
                      {e.description}
                    </td>
                    <td className="cf-num" role="cell" data-label="Valor">
                      {e.direction === 'in' ? '+' : '-'}
                      {formatBRL(BigInt(e.amountCents))}
                    </td>
                    <td role="cell" data-label="Situação">
                      <span className="cf-compare__cell cf-compare__cell--start">
                        <CfBadge tone="demo">Hipótese</CfBadge>
                        {e.dueDate > horizonEnd && <CfBadge tone="neutral">Fora do horizonte</CfBadge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function DifferenceSummary({ result }: { result: SimulationResult }) {
  const base = result.baseProjection.summary;
  const alt = result.alternativeProjection.summary;
  const riskDays = alt.riskDays - base.riskDays;
  return (
    <dl className="cf-compare__facts">
      <div>
        <dt>Saldo final</dt>
        <dd>{signedBRL(alt.endingCents - base.endingCents)}</dd>
      </div>
      <div>
        <dt>Menor saldo</dt>
        <dd>{signedBRL(alt.lowest.closingCents - base.lowest.closingCents)}</dd>
      </div>
      <div>
        <dt>Dias em alerta</dt>
        <dd>{riskDays === 0 ? 'Igual' : riskDays > 0 ? `${riskDays} a mais` : `${-riskDays} a menos`}</dd>
      </div>
    </dl>
  );
}

/**
 * Comparação lado a lado. O Original NUNCA some: em telas largas aparece ao lado da Alternativa; em telas
 * estreitas é uma aba (a outra é a Alternativa) e a coluna Diferença fica sempre à vista. Tudo o que vem da
 * Alternativa é rotulado como hipótese em texto (a cor nunca é o único sinal).
 */
export function ScenarioCompare({ result, hasAdjustments }: ScenarioCompareProps) {
  const narrow = useNarrow();
  const [tab, setTab] = useState<Tab>('original');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const tableId = useId();
  const showOriginal = !narrow || tab === 'original';
  const showAlt = !narrow || tab === 'alternative';

  const rows = result.deltaByDate.filter((d) => !onlyDiff || d.deltaCents !== 0n);
  const reconciled = result.deltaByDate.filter((d) => d.baseClosingCents + d.deltaCents === d.alternativeClosingCents).length;
  const total = result.deltaByDate.length;
  const differing = result.deltaByDate.filter((d) => d.deltaCents !== 0n).length;

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next: Tab = tab === 'original' ? 'alternative' : 'original';
      setTab(next);
      const root = event.currentTarget.parentElement;
      window.setTimeout(() => root?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus(), 0);
    }
  };

  return (
    <CfCard title="Original × Alternativa (hipótese)" description="O Original é a sua projeção atual, sem nenhuma hipótese. A Alternativa existe só nesta tela: nada é gravado nem executado.">
      <div className="cf-stack">
        {!hasAdjustments && (
          <CfAlert tone="neutral" title="Nenhuma hipótese ativa">
            Escolha uma hipótese acima. Enquanto isso a Alternativa é igual ao Original e a Diferença é zero.
          </CfAlert>
        )}

        {result.warnings.length > 0 && (
          <CfAlert tone="warning" title="Atenção nesta hipótese">
            <ul>
              {result.warnings.map((w, i) => (
                <li key={`${i}-${w}`}>{w}</li>
              ))}
            </ul>
          </CfAlert>
        )}

        {hasAdjustments ? (
          <HypothesisText result={result} />
        ) : (
          <details className="cf-details">
            <summary>{`Premissas desta hipótese (${result.assumptions.length})`}</summary>
            <div className="cf-details__body">
              <ul>
                {result.assumptions.map((a, i) => (
                  <li key={`${i}-${a}`}>{a}</li>
                ))}
              </ul>
            </div>
          </details>
        )}

        {narrow && (
          <div className="cf-compare__tabs" role="tablist" aria-label="Escolha o que ver ao lado da diferença">
            <button type="button" role="tab" id={`${tableId}-tab-original`} data-tab="original" aria-selected={tab === 'original'} aria-controls={tableId} tabIndex={tab === 'original' ? 0 : -1} className="cf-compare__tab" onClick={() => setTab('original')} onKeyDown={onTabKey}>
              Original
            </button>
            <button type="button" role="tab" id={`${tableId}-tab-alternative`} data-tab="alternative" aria-selected={tab === 'alternative'} aria-controls={tableId} tabIndex={tab === 'alternative' ? 0 : -1} className="cf-compare__tab cf-compare__tab--hypo" onClick={() => setTab('alternative')} onKeyDown={onTabKey}>
              Alternativa (hipótese)
            </button>
          </div>
        )}

        <div className="cf-compare__summary">
          {showOriginal && (
            <section className="cf-compare__col" aria-label="Resumo do Original">
              <h3 className="cf-compare__head">Original</h3>
              <Summary projection={result.baseProjection} />
            </section>
          )}
          {showAlt && (
            <section className="cf-compare__col cf-hypo" aria-label="Resumo da Alternativa (hipótese)" data-hypothetical="true">
              <h3 className="cf-compare__head">
                Alternativa <CfBadge tone="demo">Hipótese</CfBadge>
              </h3>
              <Summary projection={result.alternativeProjection} />
            </section>
          )}
          <section className="cf-compare__col" aria-label="Resumo da diferença">
            <h3 className="cf-compare__head">Diferença (Alternativa − Original)</h3>
            <DifferenceSummary result={result} />
          </section>
        </div>

        <p className="cf-muted" role="status">
          {reconciled === total
            ? `Conferido: nos ${total} dias, Original + Diferença = Alternativa. A alternativa difere do original em ${differing} dia${differing === 1 ? '' : 's'}.`
            : `Atenção: a conferência falhou em ${total - reconciled} de ${total} dias.`}
        </p>

        <div>
          <CfButton variant="secondary" aria-pressed={onlyDiff} onClick={() => setOnlyDiff(!onlyDiff)}>
            {onlyDiff && <span aria-hidden="true">✓ </span>}
            Só os dias com diferença
          </CfButton>
        </div>

        <div className="cf-table-wrap" id={tableId} role={narrow ? 'tabpanel' : undefined} aria-labelledby={narrow ? `${tableId}-tab-${tab}` : undefined}>
          <table className="cf-table cf-table--compact cf-table--stack" role="table" aria-label="Saldo por dia: Original, Alternativa (hipótese) e Diferença">
            <thead>
              <tr>
                <th scope="col">Dia</th>
                {showOriginal && <th scope="col" className="cf-num">Original</th>}
                {showAlt && (
                  <th scope="col" className="cf-num cf-hypo-head">
                    Alternativa (hipótese)
                  </th>
                )}
                <th scope="col" className="cf-num">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr role="row">
                  <td colSpan={4} role="cell">
                    Nenhum dia difere do original.
                  </td>
                </tr>
              )}
              {rows.map((d) => (
                <tr key={d.date} role="row" data-date={d.date} data-changed={d.deltaCents !== 0n ? 'true' : 'false'}>
                  <th scope="row" role="rowheader">
                    {formatBR(d.date)}
                  </th>
                  {showOriginal && (
                    <td className="cf-num" role="cell" data-label="Original">
                      <span className="cf-compare__cell">
                        <span>{formatBRL(d.baseClosingCents)}</span>
                        {d.baseRisk !== 'ok' && <CfBadge tone={riskTone(d.baseRisk)}>{riskLabel(d.baseRisk)}</CfBadge>}
                      </span>
                    </td>
                  )}
                  {showAlt && (
                    <td className="cf-num cf-hypo-cell" role="cell" data-label="Alternativa (hipótese)" data-hypothetical="true">
                      <span className="cf-compare__cell">
                        <span>{formatBRL(d.alternativeClosingCents)}</span>
                        {d.alternativeRisk !== 'ok' && <CfBadge tone={riskTone(d.alternativeRisk)}>{riskLabel(d.alternativeRisk)}</CfBadge>}
                      </span>
                    </td>
                  )}
                  <td className="cf-num" role="cell" data-label="Diferença">
                    {signedBRL(d.deltaCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </CfCard>
  );
}
