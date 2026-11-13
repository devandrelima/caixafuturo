import { DEFAULT_HORIZON_DAYS, project } from '../finance/projection';
import type { ProjectionResult } from '../finance/projection';
import { addDays, formatBR, isValidISODate } from '../finance/dates';
import { centsFromString } from '../finance/money';
import type { CashEntry, CashSettings, ISODate } from '../finance/types';
import { sha256Hex } from '../import/sha256';
import { applyDelay } from './delay';
import { applyEquipmentPurchase } from './equipment';
import { applyScaleExpense, applyScaleSales } from './shocks';
import { HYPOTHETICAL_ID_PREFIX, HYPOTHETICAL_LABEL, ScenarioError } from './types';
import type {
  Adjustment,
  AdjustmentEffect,
  ApplierContext,
  ApplierOutcome,
  ApplierRegistry,
  BaseSnapshot,
  DeltaPoint,
  EffectChange,
  EntryAddition,
  EntryChange,
  RiskDiff,
  SaleBasis,
  Scenario,
  SimulationResult,
  SupportedAdjustment,
} from './types';

/**
 * Motor puro de cenários (S05, ADR-0009). Não lê relógio, não grava, não muta a entrada e NÃO tem fórmula
 * de saldo própria: base e alternativa passam pelo mesmo `project()` do app.
 */

/** Aplicadores reais por tipo de ajuste . */
const APPLIERS: ApplierRegistry = { delay_receipt: applyDelay, scale_sales: applyScaleSales, scale_expense: applyScaleExpense, equipment_purchase: applyEquipmentPurchase };
// hiring, shift_vendor_due e advance_receivable são registrados nas demais tasks da S06 (ADR-0010).

// ───────────────────────────── utilitários ─────────────────────────────

/** Congela objetos e listas recursivamente e devolve o mesmo valor. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/** JSON canônico: chaves ordenadas em todos os níveis; `undefined` omitido (como o JSON.stringify). */
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        const item = (v as Record<string, unknown>)[key];
        if (item !== undefined) out[key] = normalize(item);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

// Mesma ordem canônica do project() (projection.ts: compareParsed).
const compareEntries = (a: CashEntry, b: CashEntry): number =>
  a.dueDate.localeCompare(b.dueDate) ||
  a.id.localeCompare(b.id) ||
  a.direction.localeCompare(b.direction) ||
  a.amountCents.localeCompare(b.amountCents) ||
  a.sourceKey.localeCompare(b.sourceKey);

// ───────────────────────────── snapshot ─────────────────────────────

export interface BaseSnapshotInput {
  settings: CashSettings;
  entries: readonly CashEntry[];
  /** Bruto e custo de cada repasse derivado de venda (para `scale_sales`). */
  saleBasis?: readonly SaleBasis[];
  horizonDays?: number;
}

function validateSaleBasis(basis: readonly SaleBasis[]): SaleBasis[] {
  const seen = new Set<string>();
  return basis.map((b) => {
    if (typeof b.entryId !== 'string' || b.entryId === '') throw new ScenarioError('Base de venda sem id de lançamento.');
    if (seen.has(b.entryId)) throw new ScenarioError(`Base de venda repetida para ${b.entryId}.`);
    seen.add(b.entryId);
    if (!isValidISODate(b.saleDate)) throw new ScenarioError(`Base de venda ${b.entryId}: data inválida.`);
    let gross: bigint;
    try {
      gross = centsFromString(b.grossCents);
    } catch {
      throw new ScenarioError(`Base de venda ${b.entryId}: bruto inválido.`);
    }
    if (gross <= 0n) throw new ScenarioError(`Base de venda ${b.entryId}: o bruto deve ser maior que zero.`);
    if (!Number.isInteger(b.costBps) || b.costBps < 0 || b.costBps > 10_000) throw new ScenarioError(`Base de venda ${b.entryId}: custo deve ser inteiro de 0 a 10 000 bps.`);
    return { entryId: b.entryId, saleDate: b.saleDate, grossCents: b.grossCents, costBps: b.costBps };
  });
}

/**
 * Cria a base imutável: valida pelo próprio motor (dado inválido lança ProjectionError), descarta duplicados
 * como o `project()` faz, copia tudo (os objetos do chamador não são tocados nem congelados) e congela.
 */
export function createBaseSnapshot(input: BaseSnapshotInput): BaseSnapshot {
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  project(input.settings, input.entries, { horizonDays }); // valida configuração, horizonte e cada lançamento
  const saleBasis = validateSaleBasis(input.saleBasis ?? []).sort((a, b) => a.entryId.localeCompare(b.entryId));

  const sorted = [...input.entries].sort(compareEntries);
  const ids = new Set<string>();
  const keys = new Set<string>();
  const kept: CashEntry[] = [];
  for (const e of sorted) {
    if (e.state === 'settled') continue;
    if (ids.has(e.id) || (e.sourceKey !== '' && keys.has(e.sourceKey))) continue;
    ids.add(e.id);
    if (e.sourceKey !== '') keys.add(e.sourceKey);
    kept.push({ ...e });
  }
  for (const e of sorted) {
    if (e.state !== 'settled' || ids.has(e.id)) continue;
    ids.add(e.id);
    kept.push({ ...e });
  }
  kept.sort(compareEntries);

  const settings: CashSettings = { ...input.settings };
  const id = `snap_${sha256Hex(canonicalJson({ settings, horizonDays, entries: kept, saleBasis })).slice(0, 16)}`;
  return deepFreeze({ id, settings, horizonDays, entries: kept, saleBasis });
}

export function createScenario(snapshot: BaseSnapshot, label: string, adjustments: readonly Adjustment[], id: string): Scenario {
  const copy = JSON.parse(JSON.stringify(adjustments)) as Adjustment[];
  return deepFreeze({ id, baseSnapshotId: snapshot.id, label, adjustments: copy });
}

// ───────────────────────────── simulação ─────────────────────────────

const FIELD_LABEL = { dueDate: 'data', amountCents: 'valor', removed: 'presença' } as const;
type Field = keyof typeof FIELD_LABEL;

const labelOf = (adjustment: Adjustment): string => adjustment.label ?? `Ajuste ${adjustment.id}`;

function validateChange(change: EntryChange): void {
  if (typeof change.entryId !== 'string' || change.entryId === '') throw new ScenarioError('Mudança sem id de lançamento.');
  if (change.remove === true && (change.dueDate !== undefined || change.amountCents !== undefined)) throw new ScenarioError(`Mudança em ${change.entryId}: retirar não combina com mudar data ou valor.`);
  if (change.dueDate !== undefined && !isValidISODate(change.dueDate)) throw new ScenarioError(`Mudança em ${change.entryId}: data inválida (${change.dueDate}).`);
  if (change.amountCents !== undefined) {
    try {
      centsFromString(change.amountCents);
    } catch {
      throw new ScenarioError(`Mudança em ${change.entryId}: valor em centavos inválido.`);
    }
  }
}

function validateAddition(addition: EntryAddition, adjustmentId: string): bigint {
  const where = `Ajuste ${adjustmentId}: lançamento hipotético "${addition.description}"`;
  if (addition.direction !== 'in' && addition.direction !== 'out') throw new ScenarioError(`${where}: direção inválida.`);
  if (!isValidISODate(addition.dueDate)) throw new ScenarioError(`${where}: data inválida (${addition.dueDate}).`);
  let cents: bigint;
  try {
    cents = centsFromString(addition.amountCents);
  } catch {
    throw new ScenarioError(`${where}: valor em centavos inválido.`);
  }
  if (cents <= 0n) throw new ScenarioError(`${where}: o valor deve ser maior que zero.`);
  return cents;
}

function buildDelta(base: ProjectionResult, alternative: ProjectionResult): { deltaByDate: DeltaPoint[]; riskDiff: RiskDiff } {
  const newRiskDates: ISODate[] = [];
  const resolvedRiskDates: ISODate[] = [];
  const deltaByDate = base.points.map((b, i): DeltaPoint => {
    const a = alternative.points[i];
    if (!a || a.date !== b.date) throw new ScenarioError('Base e alternativa com calendários diferentes.');
    if (b.risk === 'ok' && a.risk !== 'ok') newRiskDates.push(b.date);
    if (b.risk !== 'ok' && a.risk === 'ok') resolvedRiskDates.push(b.date);
    return {
      date: b.date,
      baseClosingCents: b.closingCents,
      alternativeClosingCents: a.closingCents,
      deltaCents: a.closingCents - b.closingCents,
      deltaIncomingCents: a.incomingCents - b.incomingCents,
      deltaOutgoingCents: a.outgoingCents - b.outgoingCents,
      baseRisk: b.risk,
      alternativeRisk: a.risk,
    };
  });
  return { deltaByDate, riskDiff: { newRiskDates, resolvedRiskDates } };
}

function generalWarnings(base: ProjectionResult, alternative: ProjectionResult, riskDiff: RiskDiff, horizonDays: number, createdBeyond: number): string[] {
  const out: string[] = [];
  if (createdBeyond > 0) {
    out.push(`${createdBeyond} lançamento(s) da hipótese vence(m) depois do horizonte de ${horizonDays} dias e não entra(m) no saldo projetado (o valor existe na hipótese; só cai fora da janela).`);
  }
  const extraBeyond = alternative.summary.beyondHorizon - base.summary.beyondHorizon - createdBeyond;
  if (extraBeyond > 0) {
    out.push(`${extraBeyond} lançamento(s) passam a vencer depois do horizonte de ${horizonDays} dias e deixam de contar nele (o valor não some: só cai fora da janela).`);
  }
  const { newRiskDates, resolvedRiskDates } = riskDiff;
  if (newRiskDates.length > 0) {
    out.push(
      base.summary.firstRisk === null
        ? `A hipótese cria risco: o primeiro dia em risco seria ${formatBR(newRiskDates[0] as ISODate)}.`
        : `A hipótese coloca ${newRiskDates.length} dia(s) a mais em risco (o primeiro: ${formatBR(newRiskDates[0] as ISODate)}).`,
    );
  }
  if (resolvedRiskDates.length > 0) {
    out.push(
      alternative.summary.firstRisk === null
        ? `A hipótese elimina o risco de caixa dos próximos ${horizonDays} dias.`
        : `A hipótese reduz o risco: ${resolvedRiskDates.length} dia(s) deixam de estar em risco.`,
    );
  }
  return out;
}

/** Núcleo do simulador, com os aplicadores injetados (permite testar o motor sem os ajustes reais). */
export function simulateWith(appliers: ApplierRegistry, snapshot: BaseSnapshot, adjustments: readonly Adjustment[]): SimulationResult {
  for (const adjustment of adjustments) {
    if (typeof adjustment.id !== 'string' || adjustment.id.trim() === '') throw new ScenarioError('Todo ajuste precisa de um id.');
  }
  const { settings, horizonDays, entries } = snapshot;
  const baseProjection = project(settings, entries, { horizonDays });

  const all = new Map(entries.map((e) => [e.id, e] as const));
  const live = new Map(entries.filter((e) => e.state === 'scheduled' && e.dueDate > settings.baseDate).map((e) => [e.id, e] as const));
  const context: ApplierContext = { snapshot, live, all, saleBasis: new Map(snapshot.saleBasis.map((b) => [b.entryId, b] as const)) };

  const assumptions: string[] = [
    `${HYPOTHETICAL_LABEL}: nada é gravado, executado ou transferido; o saldo real e os lançamentos não mudam.`,
    `Base ${snapshot.id}: ${live.size} lançamento(s) agendados contam no saldo, horizonte de ${horizonDays} dias a partir de ${formatBR(settings.baseDate)}.`,
    'Saldos calculados pelo mesmo motor de projeção do aplicativo; cada lançamento muda no máximo uma vez por campo (data e valor), sempre a partir do valor original.',
  ];
  const warnings: string[] = [];
  const effects: AdjustmentEffect[] = [];

  const seenIds = new Set<string>();
  const touched = new Map<string, Map<Field, string>>(); // lançamento → campo → rótulo do ajuste que o alterou
  const overrides = new Map<string, { dueDate?: ISODate; amountCents?: string; removed?: true }>();
  const created: CashEntry[] = [];
  const removedIds: string[] = [];
  const lastDate = addDays(settings.baseDate, horizonDays);

  for (const adjustment of adjustments) {
    if (seenIds.has(adjustment.id)) {
      warnings.push(`Ajuste repetido ignorado (id ${adjustment.id}): o mesmo ajuste nunca é aplicado duas vezes.`);
      continue;
    }
    seenIds.add(adjustment.id);
    const label = labelOf(adjustment);
    const effect: AdjustmentEffect = { adjustmentId: adjustment.id, kind: adjustment.kind, label, status: 'ignored', changedEntryIds: [], createdEntryIds: [], changes: [] };
    effects.push(effect);

    const applier = appliers[adjustment.kind as keyof ApplierRegistry] as ((a: SupportedAdjustment, c: ApplierContext) => ApplierOutcome) | undefined;
    if (!applier) {
      warnings.push(`${label} (${adjustment.kind}): tipo ainda não suportado; ignorado.`);
      continue;
    }
    const outcome = applier(adjustment as SupportedAdjustment, context);
    assumptions.push(...outcome.assumptions);
    warnings.push(...outcome.warnings);

    const removedHere = new Set<string>();
    for (const change of outcome.changes) {
      validateChange(change);
      if (!live.has(change.entryId)) {
        warnings.push(`${label}: o lançamento ${change.entryId} não conta no saldo; mudança ignorada.`);
        continue;
      }
      const original = live.get(change.entryId) as CashEntry;
      const marks = touched.get(change.entryId) ?? new Map<Field, string>();
      touched.set(change.entryId, marks);
      const draft = overrides.get(change.entryId) ?? {};
      const trail: EffectChange[] = [];
      let applied = false;

      if (change.remove === true) {
        const owner = [...marks.values()][0];
        if (owner !== undefined) {
          warnings.push(`${label} ignorado em ${change.entryId} (retirada): já alterado por "${owner}". Um lançamento alterado ou retirado não pode ser retirado de novo.`);
        } else {
          for (const field of Object.keys(FIELD_LABEL) as Field[]) marks.set(field, label);
          draft.removed = true;
          trail.push({ entryId: change.entryId, field: 'removed', from: original.dueDate, to: null });
          removedHere.add(change.entryId);
          applied = true;
        }
      } else {
        for (const field of ['dueDate', 'amountCents'] as const) {
          const value = change[field];
          if (value === undefined) continue;
          const owner = marks.get(field);
          if (owner !== undefined) {
            warnings.push(`${label} ignorado em ${change.entryId} (${FIELD_LABEL[field]}): já alterado por "${owner}". Cada lançamento muda uma vez por campo.`);
            continue;
          }
          marks.set(field, label);
          draft[field] = value;
          trail.push({ entryId: change.entryId, field, from: original[field], to: value });
          applied = true;
        }
      }
      if (applied) {
        overrides.set(change.entryId, draft);
        if (!effect.changedEntryIds.includes(change.entryId)) effect.changedEntryIds.push(change.entryId);
        effect.changes.push(...trail);
        if (draft.removed === true && !removedIds.includes(change.entryId)) removedIds.push(change.entryId);
      }
    }

    (outcome.additions ?? []).forEach((addition, index) => {
      validateAddition(addition, adjustment.id);
      const id = `${HYPOTHETICAL_ID_PREFIX}${adjustment.id}:${index + 1}`;
      if (addition.dependsOn !== undefined && !removedHere.has(addition.dependsOn)) {
        warnings.push(`${label}: o lançamento hipotético "${addition.description}" não foi criado, porque a retirada de ${addition.dependsOn} não valeu (conflito com outro ajuste ou lançamento fora do saldo).`);
        return;
      }
      if (addition.dueDate <= settings.baseDate) {
        warnings.push(`${label}: o lançamento hipotético "${addition.description}" vence em ${formatBR(addition.dueDate)}, até a data-base (${formatBR(settings.baseDate)}): já estaria no saldo informado e não foi criado.`);
        return;
      }
      if (all.has(id)) {
        warnings.push(`${label}: o id ${id} já existe na base e o lançamento hipotético "${addition.description}" não foi criado (a base nunca é sobrescrita).`);
        return;
      }
      created.push({
        id,
        direction: addition.direction,
        amountCents: addition.amountCents,
        dueDate: addition.dueDate,
        description: addition.description,
        category: addition.category,
        origin: 'manual',
        sourceKey: id,
        state: 'scheduled',
        ...(addition.linkedSaleId !== undefined ? { linkedSaleId: addition.linkedSaleId } : {}),
      });
      effect.createdEntryIds.push(id);
    });
    if (effect.changedEntryIds.length > 0 || effect.createdEntryIds.length > 0) effect.status = 'applied';
  }

  const alternativeEntries: CashEntry[] = [];
  for (const entry of entries) {
    const override = overrides.get(entry.id);
    if (!override) {
      alternativeEntries.push(entry);
      continue;
    }
    if (override.removed === true) continue;
    const next: CashEntry = { ...entry, ...(override.dueDate !== undefined ? { dueDate: override.dueDate } : {}), ...(override.amountCents !== undefined ? { amountCents: override.amountCents } : {}) };
    if (override.amountCents !== undefined && centsFromString(override.amountCents) <= 0n) {
      warnings.push(`O lançamento ${entry.id} ficou com valor zero na hipótese e foi retirado da alternativa.`);
      continue;
    }
    alternativeEntries.push(next);
  }
  alternativeEntries.push(...created);

  const alternativeProjection = project(settings, alternativeEntries, { horizonDays });
  const { deltaByDate, riskDiff } = buildDelta(baseProjection, alternativeProjection);
  warnings.push(...generalWarnings(baseProjection, alternativeProjection, riskDiff, horizonDays, created.filter((e) => e.dueDate > lastDate).length));

  return { hypothetical: true, label: HYPOTHETICAL_LABEL, baseSnapshotId: snapshot.id, baseProjection, alternativeProjection, deltaByDate, riskDiff, effects, createdEntries: created, removedEntryIds: removedIds, assumptions, warnings };
}

/** `simulate(baseSnapshot, adjustments)` do contrato: pura, determinística e sem efeitos colaterais. */
export function simulate(snapshot: BaseSnapshot, adjustments: readonly Adjustment[]): SimulationResult {
  return simulateWith(APPLIERS, snapshot, adjustments);
}

/** Refaz um cenário salvo/descrito, recusando-o se a base mudou. */
export function simulateScenario(snapshot: BaseSnapshot, scenario: Scenario, appliers: ApplierRegistry = APPLIERS): SimulationResult {
  if (scenario.baseSnapshotId !== snapshot.id) {
    throw new ScenarioError(`O cenário "${scenario.label}" foi criado para outra base (${scenario.baseSnapshotId}); a base atual é ${snapshot.id}.`);
  }
  return simulateWith(appliers, snapshot, scenario.adjustments);
}
