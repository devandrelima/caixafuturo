import type { SettlementRules, ReconciliationDecision, Sale } from '../domain/sales/types';
import { DEFAULT_SETTLEMENT_RULES, validateRules } from '../domain/sales/settlement';
import type { CashEntry } from '../domain/finance/types';
import {
  DB_NAME,
  INDEX_SALE_KEY,
  openDatabase,
  runTransaction,
  STORE_ENTRIES,
  STORE_META,
  STORE_RECONCILIATION,
  STORE_SALES,
  STORE_SETTINGS,
  StorageError,
} from './db';
import { validateSale } from './validateSale';

const RULES_KEY = 'settlementRules';
const META_KEY = 'dataset';

export interface SalesImportResult {
  created: string[];
  skipped: string[];
}

export interface SalesRepository {
  listSales(): Promise<Sale[]>;
  /** Tudo ou nada; chave de venda já existente é ignorada (reimportar não duplica faturamento). */
  importSales(sales: Sale[]): Promise<SalesImportResult>;
  getRules(): Promise<SettlementRules>;
  saveRules(rules: SettlementRules): Promise<void>;
  listDecisions(): Promise<ReconciliationDecision[]>;
  /** `same` é único por venda e `standalone` por conta: salvar de novo substitui. */
  saveDecision(decision: ReconciliationDecision): Promise<void>;
  removeDecision(decision: ReconciliationDecision): Promise<void>;
  /** Atualiza somente `saleReference` de contas existentes; devolve quantas foram alteradas. */
  applyReferenceUpdates(updates: { entryId: string; saleReference: string }[]): Promise<number>;
  close(): void;
}

export interface SalesRepositoryOptions {
  factory?: IDBFactory | null;
  dbName?: string;
}

const decisionKey = (d: ReconciliationDecision): string => (d.kind === 'same' ? `same:${d.saleId}` : `standalone:${d.entryId}`);

export function createSalesRepository(options: SalesRepositoryOptions = {}): SalesRepository {
  const factory = options.factory === undefined ? (globalThis.indexedDB ?? null) : options.factory;
  const dbName = options.dbName ?? DB_NAME;
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
        if (connection === pending) connection = undefined;
      });
    }
    return connection;
  }

  async function read<T>(stores: string[], work: (tx: IDBTransaction, set: (v: T) => void) => void): Promise<T> {
    return runTransaction<T>(await db(), stores, 'readonly', work);
  }
  async function write<T>(stores: string[], work: (tx: IDBTransaction, set: (v: T) => void) => void): Promise<T> {
    return runTransaction<T>(await db(), [...stores, STORE_META], 'readwrite', work);
  }
  function ensureUserKind(tx: IDBTransaction): void {
    const meta = tx.objectStore(STORE_META);
    const found = meta.get(META_KEY);
    found.onsuccess = () => {
      if (!found.result) meta.put({ key: META_KEY, kind: 'user' });
    };
  }

  return {
    async listSales() {
      const all = await read<Sale[]>([STORE_SALES], (tx, set) => {
        const req = tx.objectStore(STORE_SALES).getAll();
        req.onsuccess = () => set(req.result as Sale[]);
      });
      return all.sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.id.localeCompare(b.id));
    },

    async importSales(sales) {
      sales.forEach(validateSale);
      return write<SalesImportResult>([STORE_SALES], (tx, set) => {
        const store = tx.objectStore(STORE_SALES);
        const index = store.index(INDEX_SALE_KEY);
        const result: SalesImportResult = { created: [], skipped: [] };
        const step = (i: number): void => {
          const sale = sales[i];
          if (!sale) {
            set(result);
            if (result.created.length > 0) ensureUserKind(tx);
            return;
          }
          const existing = index.getKey(sale.saleKey);
          existing.onsuccess = () => {
            if (existing.result !== undefined) {
              result.skipped.push(sale.id);
              step(i + 1);
              return;
            }
            store.add(sale).onsuccess = () => {
              result.created.push(sale.id);
              step(i + 1);
            };
          };
        };
        step(0);
      });
    },

    async getRules() {
      const row = await read<{ rules: SettlementRules } | undefined>([STORE_SETTINGS], (tx, set) => {
        const req = tx.objectStore(STORE_SETTINGS).get(RULES_KEY);
        req.onsuccess = () => set(req.result as { rules: SettlementRules } | undefined);
      });
      return row?.rules ?? DEFAULT_SETTLEMENT_RULES;
    },

    async saveRules(rules) {
      const problem = validateRules(rules);
      if (problem) throw new StorageError('invalid', problem);
      await write<void>([STORE_SETTINGS], (tx) => {
        tx.objectStore(STORE_SETTINGS).put({ key: RULES_KEY, rules });
        ensureUserKind(tx);
      });
    },

    async listDecisions() {
      const rows = await read<(ReconciliationDecision & { key: string })[]>([STORE_RECONCILIATION], (tx, set) => {
        const req = tx.objectStore(STORE_RECONCILIATION).getAll();
        req.onsuccess = () => set(req.result as (ReconciliationDecision & { key: string })[]);
      });
      return rows
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(({ key: _key, ...decision }) => decision as ReconciliationDecision);
    },

    async saveDecision(decision) {
      await write<void>([STORE_RECONCILIATION], (tx) => {
        tx.objectStore(STORE_RECONCILIATION).put({ key: decisionKey(decision), ...decision });
        ensureUserKind(tx);
      });
    },

    async removeDecision(decision) {
      await write<void>([STORE_RECONCILIATION], (tx) => {
        tx.objectStore(STORE_RECONCILIATION).delete(decisionKey(decision));
      });
    },

    async applyReferenceUpdates(updates) {
      if (updates.length === 0) return 0;
      return write<number>([STORE_ENTRIES], (tx, set) => {
        const store = tx.objectStore(STORE_ENTRIES);
        let changed = 0;
        const step = (i: number): void => {
          const update = updates[i];
          if (!update) {
            set(changed);
            return;
          }
          const found = store.get(update.entryId);
          found.onsuccess = () => {
            const entry = found.result as CashEntry | undefined;
            if (entry) {
              store.put({ ...entry, saleReference: update.saleReference });
              changed += 1;
            }
            step(i + 1);
          };
        };
        step(0);
      });
    },

    close() {
      const current = connection;
      connection = undefined;
      current?.then((d) => d.close()).catch(() => undefined);
    },
  };
}
