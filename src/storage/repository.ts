import { isValidISODate } from '../domain/finance/dates';
import { centsFromString } from '../domain/finance/money';
import { validateRules } from '../domain/sales/settlement';
import { validateSale } from './validateSale';
import type { CashEntry, CashSettings, Direction, EntryOrigin, ISODate } from '../domain/finance/types';
import type { Sale, SettlementRules } from '../domain/sales/types';
import {
  DB_NAME,
  INDEX_SOURCE_KEY,
  openDatabase,
  runTransaction,
  STORE_ENTRIES,
  STORE_META,
  STORE_RECONCILIATION,
  STORE_SALES,
  STORE_SETTINGS,
  StorageError,
} from './db';

export { StorageError } from './db';
export type { StorageErrorCode } from './db';

export type DatasetKind = 'demo' | 'user';

/** Dados informados pelo usuário para um novo lançamento manual. */
export interface EntryDraft {
  direction: Direction;
  amountCents: string;
  dueDate: ISODate;
  description: string;
  category?: string;
}

export interface ImportResult {
  created: string[];
  skipped: string[];
}

export interface ReplaceAllInput {
  settings: CashSettings;
  entries: CashEntry[];
  kind: DatasetKind;
  /** Vendas e regras de repasse do novo conjunto (S02). Vendas, regras e decisões anteriores sempre são apagadas. */
  sales?: Sale[];
  rules?: SettlementRules;
}

export interface RepositoryOptions {
  /** IndexedDB a usar. `null` simula ambiente sem IndexedDB. Padrão: globalThis.indexedDB. */
  factory?: IDBFactory | null;
  dbName?: string;
  newId?: () => string;
}

export interface Repository {
  getSettings(): Promise<CashSettings | null>;
  saveSettings(settings: CashSettings): Promise<void>;
  listEntries(): Promise<CashEntry[]>;
  getEntry(id: string): Promise<CashEntry | null>;
  addEntry(draft: EntryDraft): Promise<CashEntry>;
  updateEntry(entry: CashEntry): Promise<CashEntry>;
  deleteEntry(id: string): Promise<void>;
  /** Grava lançamentos novos; chaves de origem já existentes são ignoradas. Tudo ou nada. */
  importEntries(entries: CashEntry[]): Promise<ImportResult>;
  /** Troca configuração, lançamentos e tipo de conjunto em uma única transação. */
  replaceAll(input: ReplaceAllInput): Promise<void>;
  getDatasetKind(): Promise<DatasetKind | null>;
  /** Apaga tudo. Exige confirmação explícita; a interface deve pedi-la ao usuário. */
  clearAll(confirmation: { confirmed: true }): Promise<void>;
  close(): void;
}

const SETTINGS_KEY = 'cash';
const RULES_KEY = 'settlementRules';
const META_KEY = 'dataset';
const ORIGINS: ReadonlySet<EntryOrigin> = new Set(['manual', 'csv', 'demo', 'sale', 'recurring']);

const invalid = (message: string) => new StorageError('invalid', message);

function validateSettings(s: CashSettings): void {
  if (!isValidISODate(s.baseDate)) throw invalid('Data-base inválida.');
  try {
    centsFromString(s.openingBalanceCents);
    if (centsFromString(s.minimumBalanceCents) < 0n) throw invalid('O saldo mínimo não pode ser negativo.');
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw invalid('Saldo inicial ou mínimo inválido.');
  }
}

function validateEntry(e: CashEntry): void {
  if (!e.id) throw invalid('Lançamento sem identificador.');
  if (e.direction !== 'in' && e.direction !== 'out') throw invalid('Tipo do lançamento inválido.');
  if (e.state !== 'scheduled' && e.state !== 'settled') throw invalid('Estado do lançamento inválido.');
  if (!ORIGINS.has(e.origin)) throw invalid('Origem do lançamento inválida.');
  if (!isValidISODate(e.dueDate)) throw invalid('Vencimento inválido.');
  if (typeof e.description !== 'string' || e.description.trim() === '') throw invalid('A descrição é obrigatória.');
  if (typeof e.sourceKey !== 'string' || e.sourceKey === '') throw invalid('Lançamento sem chave de origem.');
  let cents: bigint;
  try {
    cents = centsFromString(e.amountCents);
  } catch {
    throw invalid('Valor inválido.');
  }
  if (cents <= 0n) throw invalid('O valor deve ser maior que zero.');
}

function defaultId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes); // disponível mesmo em HTTP (randomUUID não é)
  return `e_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const byDueDateThenId = (a: CashEntry, b: CashEntry) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id);

export function createRepository(options: RepositoryOptions = {}): Repository {
  const factory = options.factory === undefined ? (globalThis.indexedDB ?? null) : options.factory;
  const dbName = options.dbName ?? DB_NAME;
  const newId = options.newId ?? defaultId;
  let connection: Promise<IDBDatabase> | undefined;

  function db(): Promise<IDBDatabase> {
    if (!connection) {
      const pending = openDatabase(factory, dbName).then((opened) => {
        opened.onversionchange = () => opened.close();
        opened.onclose = () => {
          connection = undefined;
        };
        return opened;
      });
      connection = pending;
      pending.catch(() => {
        if (connection === pending) connection = undefined; // permite nova tentativa
      });
    }
    return connection;
  }

  /** Marca o conjunto como "user" quando ainda não há tipo definido. */
  function ensureUserKind(tx: IDBTransaction): void {
    const meta = tx.objectStore(STORE_META);
    const read = meta.get(META_KEY);
    read.onsuccess = () => {
      if (!read.result) meta.put({ key: META_KEY, kind: 'user' satisfies DatasetKind });
    };
  }

  async function read<T>(stores: string[], work: (tx: IDBTransaction, set: (v: T) => void) => void): Promise<T> {
    return runTransaction<T>(await db(), stores, 'readonly', work);
  }
  async function write<T>(stores: string[], work: (tx: IDBTransaction, set: (v: T) => void) => void): Promise<T> {
    return runTransaction<T>(await db(), [...stores, STORE_META], 'readwrite', work);
  }

  const api: Repository = {
    getSettings: () =>
      read<CashSettings | null>([STORE_SETTINGS], (tx, set) => {
        const req = tx.objectStore(STORE_SETTINGS).get(SETTINGS_KEY);
        req.onsuccess = () => {
          const row = req.result as (CashSettings & { key: string }) | undefined;
          set(row ? { baseDate: row.baseDate, openingBalanceCents: row.openingBalanceCents, minimumBalanceCents: row.minimumBalanceCents } : null);
        };
      }),

    async saveSettings(settings) {
      validateSettings(settings);
      await write<void>([STORE_SETTINGS], (tx) => {
        tx.objectStore(STORE_SETTINGS).put({
          key: SETTINGS_KEY,
          baseDate: settings.baseDate,
          openingBalanceCents: settings.openingBalanceCents,
          minimumBalanceCents: settings.minimumBalanceCents,
        });
        ensureUserKind(tx);
      });
    },

    async listEntries() {
      const all = await read<CashEntry[]>([STORE_ENTRIES], (tx, set) => {
        const req = tx.objectStore(STORE_ENTRIES).getAll();
        req.onsuccess = () => set(req.result as CashEntry[]);
      });
      return all.sort(byDueDateThenId);
    },

    async getEntry(id) {
      const row = await read<CashEntry | undefined>([STORE_ENTRIES], (tx, set) => {
        const req = tx.objectStore(STORE_ENTRIES).get(id);
        req.onsuccess = () => set(req.result as CashEntry | undefined);
      });
      return row ?? null;
    },

    async addEntry(draft) {
      const id = newId();
      const entry: CashEntry = {
        id,
        direction: draft.direction,
        amountCents: draft.amountCents,
        dueDate: draft.dueDate,
        description: typeof draft.description === 'string' ? draft.description.trim() : '',
        category: (draft.category ?? '').trim(),
        origin: 'manual',
        sourceKey: `manual:${id}`,
        state: 'scheduled',
      };
      validateEntry(entry);
      await write<void>([STORE_ENTRIES], (tx) => {
        tx.objectStore(STORE_ENTRIES).add(entry);
        ensureUserKind(tx);
      });
      return entry;
    },

    async updateEntry(entry) {
      const current = await api.getEntry(entry.id);
      if (!current) throw new StorageError('not_found', 'Lançamento não encontrado; ele pode ter sido excluído.');
      // id, origem e chave de origem são imutáveis: reimportar o mesmo CSV nunca duplica um lançamento editado.
      const next: CashEntry = {
        ...entry,
        id: current.id,
        origin: current.origin,
        sourceKey: current.sourceKey,
        description: typeof entry.description === 'string' ? entry.description.trim() : '',
        category: (entry.category ?? '').trim(),
      };
      validateEntry(next);
      await write<void>([STORE_ENTRIES], (tx) => {
        tx.objectStore(STORE_ENTRIES).put(next);
      });
      return next;
    },

    async deleteEntry(id) {
      if (!(await api.getEntry(id))) throw new StorageError('not_found', 'Lançamento não encontrado; ele pode já ter sido excluído.');
      await write<void>([STORE_ENTRIES], (tx) => {
        tx.objectStore(STORE_ENTRIES).delete(id);
      });
    },

    async importEntries(entries) {
      entries.forEach(validateEntry); // nada é gravado se qualquer registro for inválido
      return write<ImportResult>([STORE_ENTRIES], (tx, set) => {
        const store = tx.objectStore(STORE_ENTRIES);
        const index = store.index(INDEX_SOURCE_KEY);
        const result: ImportResult = { created: [], skipped: [] };
        const step = (i: number): void => {
          const entry = entries[i];
          if (!entry) {
            set(result);
            if (result.created.length > 0) ensureUserKind(tx);
            return;
          }
          const existing = index.getKey(entry.sourceKey);
          existing.onsuccess = () => {
            if (existing.result !== undefined) {
              result.skipped.push(entry.id);
              step(i + 1);
              return;
            }
            const added = store.add(entry);
            added.onsuccess = () => {
              result.created.push(entry.id);
              step(i + 1);
            };
          };
        };
        step(0);
      });
    },

    async replaceAll({ settings, entries, kind, sales = [], rules }) {
      validateSettings(settings);
      entries.forEach(validateEntry);
      sales.forEach(validateSale);
      if (rules) {
        const problem = validateRules(rules);
        if (problem) throw invalid(problem);
      }
      await write<void>([STORE_SETTINGS, STORE_ENTRIES, STORE_SALES, STORE_RECONCILIATION], (tx) => {
        tx.objectStore(STORE_ENTRIES).clear();
        tx.objectStore(STORE_SETTINGS).clear();
        tx.objectStore(STORE_SALES).clear();
        tx.objectStore(STORE_RECONCILIATION).clear();
        tx.objectStore(STORE_SETTINGS).put({ key: SETTINGS_KEY, ...settings });
        if (rules) tx.objectStore(STORE_SETTINGS).put({ key: RULES_KEY, rules });
        const store = tx.objectStore(STORE_ENTRIES);
        for (const entry of entries) store.add(entry);
        for (const sale of sales) tx.objectStore(STORE_SALES).add(sale);
        tx.objectStore(STORE_META).put({ key: META_KEY, kind });
      });
    },

    async getDatasetKind() {
      const row = await read<{ kind: DatasetKind } | undefined>([STORE_META], (tx, set) => {
        const req = tx.objectStore(STORE_META).get(META_KEY);
        req.onsuccess = () => set(req.result as { kind: DatasetKind } | undefined);
      });
      return row?.kind ?? null;
    },

    async clearAll(confirmation) {
      if (confirmation?.confirmed !== true) {
        throw new StorageError('confirmation_required', 'Confirme a exclusão de todos os dados para continuar.');
      }
      await write<void>([STORE_SETTINGS, STORE_ENTRIES, STORE_SALES, STORE_RECONCILIATION], (tx) => {
        tx.objectStore(STORE_ENTRIES).clear();
        tx.objectStore(STORE_SETTINGS).clear();
        tx.objectStore(STORE_SALES).clear();
        tx.objectStore(STORE_RECONCILIATION).clear();
        tx.objectStore(STORE_META).clear();
      });
    },

    close() {
      const current = connection;
      connection = undefined;
      current?.then((d) => d.close()).catch(() => undefined);
    },
  };
  return api;
}

let shared: Repository | undefined;
/** Repositório compartilhado do aplicativo (banco "caixafuturo"). */
export function getRepository(): Repository {
  shared ??= createRepository();
  return shared;
}
