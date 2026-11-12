export const DB_NAME = 'caixafuturo';
export const DB_VERSION = 2;
export const STORE_SETTINGS = 'settings';
export const STORE_ENTRIES = 'entries';
export const STORE_META = 'meta';
export const STORE_SALES = 'sales';
export const STORE_RECONCILIATION = 'reconciliation';
export const INDEX_SOURCE_KEY = 'sourceKey';
export const INDEX_SALE_KEY = 'saleKey';

export type StorageErrorCode =
  | 'unavailable'
  | 'quota'
  | 'duplicate'
  | 'not_found'
  | 'invalid'
  | 'confirmation_required'
  | 'write_failed'
  | 'read_failed';

/** Erro de armazenamento com código estável e mensagem legível para a interface. */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Converte qualquer falha do IndexedDB em StorageError, sem perder a distinção de cota/duplicidade. */
export function toStorageError(cause: unknown, fallback: 'write_failed' | 'read_failed'): StorageError {
  if (cause instanceof StorageError) return cause;
  const name = typeof cause === 'object' && cause !== null && 'name' in cause ? String((cause as { name: unknown }).name) : '';
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', 'Sem espaço de armazenamento no navegador. Libere espaço e tente novamente; seus dados anteriores foram preservados.');
  }
  if (name === 'ConstraintError') {
    return new StorageError('duplicate', 'Já existe um lançamento com a mesma identificação.');
  }
  return new StorageError(
    fallback,
    fallback === 'write_failed'
      ? 'Não foi possível salvar. Nada foi alterado; tente novamente.'
      : 'Não foi possível ler os dados salvos neste navegador.',
  );
}

function migrate(db: IDBDatabase, oldVersion: number): void {
  // Migrações futuras entram como novos "if (oldVersion < N)", sem alterar as anteriores.
  if (oldVersion < 1) {
    db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
    const entries = db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' });
    entries.createIndex(INDEX_SOURCE_KEY, 'sourceKey', { unique: true });
    db.createObjectStore(STORE_META, { keyPath: 'key' });
  }
  // v2 (S02): vendas e decisões de conciliação. Só ADICIONA stores; settings/entries/meta ficam intactos.
  if (oldVersion < 2) {
    db.createObjectStore(STORE_SALES, { keyPath: 'id' }).createIndex(INDEX_SALE_KEY, 'saleKey', { unique: true });
    db.createObjectStore(STORE_RECONCILIATION, { keyPath: 'key' });
  }
}

export function openDatabase(factory: IDBFactory | null, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const unavailable = (detail: string) =>
      new StorageError('unavailable', `O armazenamento local do navegador não está disponível (${detail}). Verifique se o modo privado ou o bloqueio de dados do site está ativo.`);
    if (!factory) {
      reject(unavailable('IndexedDB ausente'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, DB_VERSION);
    } catch {
      reject(unavailable('falha ao abrir'));
      return;
    }
    request.onupgradeneeded = (event) => migrate(request.result, event.oldVersion);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(unavailable('erro ao abrir'));
    request.onblocked = () => reject(unavailable('bloqueado por outra aba'));
  });
}

/**
 * Executa trabalho em uma transação. Resolve só após `oncomplete` (dados duráveis);
 * qualquer erro aborta a transação inteira e rejeita com StorageError.
 */
export function runTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, setResult: (value: T) => void) => void,
): Promise<T> {
  const fallback = mode === 'readonly' ? 'read_failed' : 'write_failed';
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(toStorageError(error, fallback));
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(toStorageError(tx.error, fallback));
    try {
      work(tx, (value) => {
        result = value;
      });
    } catch (error) {
      reject(toStorageError(error, fallback));
      try {
        tx.abort();
      } catch {
        /* transação já finalizada */
      }
    }
  });
}
