import { validateRule } from '../domain/finance/recurrence';
import type { RecurrenceRule } from '../domain/finance/recurrence';
import { DB_NAME, openDatabase, runTransaction, STORE_META, STORE_RECURRENCE, StorageError } from './db';

const META_KEY = 'dataset';

/** Regras de recorrência (S04, ADR-0008). Só a regra é gravada; as ocorrências são calculadas. */
export interface RecurrenceRepository {
  /** Ordem estável: data inicial, depois id. */
  listRules(): Promise<RecurrenceRule[]>;
  /** Valida e grava (substitui a regra de mesmo id). Nunca mexe em lançamentos. */
  saveRule(rule: RecurrenceRule): Promise<void>;
  /** Exclui a regra. Lançamentos já gravados (inclusive liquidados) permanecem. Idempotente. */
  removeRule(id: string): Promise<void>;
  close(): void;
}

export interface RecurrenceRepositoryOptions {
  factory?: IDBFactory | null;
  dbName?: string;
}

/** Identificador de regra sem crypto.randomUUID (indisponível em HTTP por IP): usa getRandomValues. */
export function newRuleId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return `r_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function createRecurrenceRepository(options: RecurrenceRepositoryOptions = {}): RecurrenceRepository {
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

  return {
    async listRules() {
      const rows = await runTransaction<RecurrenceRule[]>(await db(), [STORE_RECURRENCE], 'readonly', (tx, set) => {
        const req = tx.objectStore(STORE_RECURRENCE).getAll();
        req.onsuccess = () => set(req.result as RecurrenceRule[]);
      });
      return rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
    },

    async saveRule(rule) {
      const problems = validateRule(rule);
      if (problems.length > 0) throw new StorageError('invalid', problems[0] as string);
      await runTransaction<void>(await db(), [STORE_RECURRENCE, STORE_META], 'readwrite', (tx) => {
        tx.objectStore(STORE_RECURRENCE).put(rule);
        const meta = tx.objectStore(STORE_META);
        const found = meta.get(META_KEY);
        found.onsuccess = () => {
          if (!found.result) meta.put({ key: META_KEY, kind: 'user' });
        };
      });
    },

    async removeRule(id) {
      await runTransaction<void>(await db(), [STORE_RECURRENCE], 'readwrite', (tx) => {
        tx.objectStore(STORE_RECURRENCE).delete(id);
      });
    },

    close() {
      const current = connection;
      connection = undefined;
      current?.then((d) => d.close()).catch(() => undefined);
    },
  };
}
