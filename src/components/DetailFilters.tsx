import type { ReactNode } from 'react';
import { ORIGIN_LABELS, describeFilter, filterError, isFilterActive } from '../domain/finance/filters';
import type { CategoryOption, EntryFilter } from '../domain/finance/filters';
import type { EntryOrigin } from '../domain/finance/types';
import { CfBadge, CfButton, CfField, CfSelect } from './ui/UiPrimitives';

export interface DetailFiltersProps {
  filter: EntryFilter;
  onChange: (filter: EntryFilter) => void;
  categories: readonly CategoryOption[];
  origins: readonly EntryOrigin[];
  /** Quantos lançamentos aparecem agora e quantos existem sem filtro. */
  shown: number;
  total: number;
  /** Alerta global de risco: vem do cálculo completo e NUNCA é filtrado. */
  globalAlert?: ReactNode;
}

const ALL = '__all__';

/** Filtros de visualização: não alteram saldos nem alertas. Estado do filtro sempre em texto. */
export function DetailFilters({ filter, onChange, categories, origins, shown, total, globalAlert }: DetailFiltersProps) {
  const active = isFilterActive(filter);
  const chips = describeFilter(filter);
  const error = filterError(filter);

  return (
    <div className="cf-stack">
      {globalAlert && (
        <div className="cf-stack" aria-label="Alertas do caixa (não são filtrados)">
          {globalAlert}
          <p className="cf-subtle">Os filtros abaixo só mudam a lista: saldos e alertas continuam calculados sobre todos os lançamentos.</p>
        </div>
      )}

      <form className="cf-stack" role="search" aria-label="Filtros de lançamentos" onSubmit={(e) => e.preventDefault()}>
        <div className="cf-grid cf-grid--two">
          <CfField label="Período a partir de" type="date" value={filter.from} onChange={(e) => onChange({ ...filter, from: e.target.value })} />
          <CfField label="Período até" type="date" value={filter.to} onChange={(e) => onChange({ ...filter, to: e.target.value })} />
          <CfSelect
            label="Categoria"
            value={filter.category === null ? ALL : filter.category}
            onChange={(e) => onChange({ ...filter, category: e.target.value === ALL ? null : e.target.value })}
          >
            <option value={ALL}>Todas as categorias</option>
            {categories.map((c) => (
              <option key={`c-${c.value}`} value={c.value}>
                {c.label}
              </option>
            ))}
          </CfSelect>
          <CfSelect label="Origem" value={filter.origin ?? ALL} onChange={(e) => onChange({ ...filter, origin: e.target.value === ALL ? null : (e.target.value as EntryOrigin) })}>
            <option value={ALL}>Todas as origens</option>
            {origins.map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABELS[o]}
              </option>
            ))}
          </CfSelect>
        </div>

        {error && (
          <p className="cf-field__error" role="alert">
            {error}
          </p>
        )}

        <div className="cf-row">
          <CfButton variant="secondary" onClick={() => onChange({ from: '', to: '', category: null, origin: null })}>
            Limpar filtros
          </CfButton>
          <p role="status" className="cf-muted" data-testid="filter-status">
            {active ? `Filtro ativo — mostrando ${shown} de ${total} lançamento${total === 1 ? '' : 's'}.` : `Sem filtros — mostrando todos os ${total} lançamento${total === 1 ? '' : 's'}.`}
          </p>
        </div>

        {chips.length > 0 && (
          <ul className="cf-row" aria-label="Filtros ativos" style={{ margin: 0, padding: 0 }}>
            {chips.map((text) => (
              <li key={text} style={{ listStyle: 'none' }}>
                <CfBadge tone="neutral">{text}</CfBadge>
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}
