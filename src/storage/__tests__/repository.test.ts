import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CashEntry, CashSettings } from '../../domain/finance/types';
import { createRepository, StorageError } from '../repository';
import type { EntryDraft, Repository } from '../repository';

const SETTINGS: CashSettings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };
const draft = (over: Partial<EntryDraft> = {}): EntryDraft => ({
  direction: 'out',
  amountCents: '250000',
  dueDate: '2026-11-12',
  description: 'Fornecedor fictício',
  category: 'Insumos',
  ...over,
});
const csvEntry = (id: string, key: string, over: Partial<CashEntry> = {}): CashEntry => ({
  id,
  direction: 'in',
  amountCents: '80000',
  dueDate: '2026-11-13',
  description: 'Recebimento',
  category: '',
  origin: 'csv',
  sourceKey: key,
  state: 'scheduled',
  ...over,
});

let counter = 0;
const open = (factory: IDBFactory = new IDBFactory()): { repo: Repository; factory: IDBFactory } => {
  counter = 0;
  const repo = createRepository({ factory, dbName: 'cf-test', newId: () => `id-${(counter += 1)}` });
  return { repo, factory };
};

afterEach(() => vi.restoreAllMocks());

describe('configurações', () => {
  it('retorna null quando ainda não há configuração', async () => {
    const { repo } = open();
    expect(await repo.getSettings()).toBeNull();
  });

  it('grava e lê CashSettings com centavos como string', async () => {
    const { repo } = open();
    await repo.saveSettings(SETTINGS);
    expect(await repo.getSettings()).toEqual(SETTINGS);
  });

  it('o registro bruto no IndexedDB guarda centavos como string (nunca number/BigInt)', async () => {
    const { repo, factory } = open();
    await repo.saveSettings({ ...SETTINGS, openingBalanceCents: '-70000' });
    await repo.addEntry(draft({ amountCents: '900719925474099399' }));
    const raw = await new Promise<{ settings: unknown; entry: Record<string, unknown> }>((resolve, reject) => {
      const req = factory.open('cf-test');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['settings', 'entries'], 'readonly');
        const s = tx.objectStore('settings').getAll();
        const e = tx.objectStore('entries').getAll();
        tx.oncomplete = () => {
          db.close();
          resolve({ settings: s.result[0], entry: e.result[0] });
        };
      };
    });
    expect(typeof (raw.settings as { openingBalanceCents: unknown }).openingBalanceCents).toBe('string');
    expect(raw.entry.amountCents).toBe('900719925474099399');
    expect(typeof raw.entry.amountCents).toBe('string');
  });

  it('valida a configuração antes de gravar', async () => {
    const { repo } = open();
    await expect(repo.saveSettings({ ...SETTINGS, baseDate: '2026-02-30' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(repo.saveSettings({ ...SETTINGS, openingBalanceCents: '10.5' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(repo.saveSettings({ ...SETTINGS, minimumBalanceCents: '-1' })).rejects.toMatchObject({ code: 'invalid' });
    expect(await repo.getSettings()).toBeNull();
  });

  it('regravar substitui a configuração anterior', async () => {
    const { repo } = open();
    await repo.saveSettings(SETTINGS);
    await repo.saveSettings({ ...SETTINGS, openingBalanceCents: '1' });
    expect((await repo.getSettings())?.openingBalanceCents).toBe('1');
  });
});

describe('persistência após recarregar', () => {
  it('dados permanecem quando uma nova instância abre o mesmo banco', async () => {
    const { repo, factory } = open();
    await repo.saveSettings(SETTINGS);
    const created = await repo.addEntry(draft());
    repo.close();

    const reloaded = createRepository({ factory, dbName: 'cf-test' });
    expect(await reloaded.getSettings()).toEqual(SETTINGS);
    expect(await reloaded.listEntries()).toEqual([created]);
    reloaded.close();
  });
});

describe('lançamentos manuais: criar, editar, excluir', () => {
  it('cria com id, origem manual, estado agendado e chave de origem estável', async () => {
    const { repo } = open();
    const e = await repo.addEntry(draft({ description: '  Aluguel  ' }));
    expect(e).toMatchObject({
      id: 'id-1',
      direction: 'out',
      amountCents: '250000',
      dueDate: '2026-11-12',
      description: 'Aluguel',
      origin: 'manual',
      sourceKey: 'manual:id-1',
      state: 'scheduled',
    });
    expect(await repo.getEntry('id-1')).toEqual(e);
  });

  it('lista ordenada por vencimento e id', async () => {
    const { repo } = open();
    await repo.addEntry(draft({ dueDate: '2026-11-20' }));
    await repo.addEntry(draft({ dueDate: '2026-11-12' }));
    await repo.addEntry(draft({ dueDate: '2026-11-12' }));
    const ids = (await repo.listEntries()).map((e) => e.id);
    expect(ids).toEqual(['id-2', 'id-3', 'id-1']);
  });

  it('edita campos preservando id, origem e chave', async () => {
    const { repo } = open();
    const original = await repo.addEntry(draft());
    const updated = await repo.updateEntry({ ...original, amountCents: '999', description: 'Novo', sourceKey: 'tentativa-de-troca', origin: 'csv' });
    expect(updated).toMatchObject({ id: original.id, amountCents: '999', description: 'Novo', origin: 'manual', sourceKey: original.sourceKey });
    expect(await repo.getEntry(original.id)).toEqual(updated);
  });

  it('exclui e confirma a ausência', async () => {
    const { repo } = open();
    const e = await repo.addEntry(draft());
    await repo.deleteEntry(e.id);
    expect(await repo.getEntry(e.id)).toBeNull();
    expect(await repo.listEntries()).toEqual([]);
  });

  it('excluir ou editar inexistente falha com not_found', async () => {
    const { repo } = open();
    await expect(repo.deleteEntry('nada')).rejects.toMatchObject({ code: 'not_found' });
    await expect(repo.updateEntry(csvEntry('nada', 'k'))).rejects.toMatchObject({ code: 'not_found' });
  });

  it.each([
    ['valor zero', { amountCents: '0' }],
    ['valor negativo', { amountCents: '-5' }],
    ['valor decimal', { amountCents: '1.5' }],
    ['data inválida', { dueDate: '2026-13-01' }],
    ['descrição vazia', { description: '   ' }],
    ['direção inválida', { direction: 'x' as 'in' }],
  ])('rejeita %s sem gravar nada', async (_n, over) => {
    const { repo } = open();
    await expect(repo.addEntry(draft(over))).rejects.toMatchObject({ code: 'invalid' });
    expect(await repo.listEntries()).toEqual([]);
  });

  it('manual duas vezes idêntico gera dois lançamentos distintos (chaves próprias)', async () => {
    const { repo } = open();
    await repo.addEntry(draft());
    await repo.addEntry(draft());
    expect(await repo.listEntries()).toHaveLength(2);
  });
});

describe('importação idempotente na camada de storage', () => {
  it('cria os novos e ignora chaves de origem já existentes', async () => {
    const { repo } = open();
    const batch = [csvEntry('a', 'csv:external:1'), csvEntry('b', 'csv:external:2')];
    expect(await repo.importEntries(batch)).toEqual({ created: ['a', 'b'], skipped: [] });
    expect(await repo.importEntries(batch)).toEqual({ created: [], skipped: ['a', 'b'] });
    const mixed = [csvEntry('c', 'csv:external:1'), csvEntry('d', 'csv:external:3')];
    expect(await repo.importEntries(mixed)).toEqual({ created: ['d'], skipped: ['c'] });
    expect(await repo.listEntries()).toHaveLength(3);
  });

  it('é tudo ou nada: um registro inválido impede todo o lote', async () => {
    const { repo } = open();
    const batch = [csvEntry('a', 'k1'), csvEntry('b', 'k2', { amountCents: '0' })];
    await expect(repo.importEntries(batch)).rejects.toMatchObject({ code: 'invalid' });
    expect(await repo.listEntries()).toEqual([]);
  });

  it('chave repetida dentro do mesmo lote conta uma vez', async () => {
    const { repo } = open();
    const res = await repo.importEntries([csvEntry('a', 'same'), csvEntry('b', 'same')]);
    expect(res).toEqual({ created: ['a'], skipped: ['b'] });
  });
});

describe('substituir tudo (demonstração) e limpar', () => {
  it('replaceAll troca configuração, lançamentos e tipo de conjunto atomicamente', async () => {
    const { repo } = open();
    await repo.saveSettings(SETTINGS);
    await repo.addEntry(draft());
    await repo.replaceAll({
      settings: { ...SETTINGS, openingBalanceCents: '1' },
      entries: [csvEntry('d1', 'demo:d1', { origin: 'demo' })],
      kind: 'demo',
    });
    expect((await repo.getSettings())?.openingBalanceCents).toBe('1');
    expect((await repo.listEntries()).map((e) => e.id)).toEqual(['d1']);
    expect(await repo.getDatasetKind()).toBe('demo');
  });

  it('replaceAll com dado inválido não altera o que já existe', async () => {
    const { repo } = open();
    await repo.saveSettings(SETTINGS);
    const kept = await repo.addEntry(draft());
    await expect(
      repo.replaceAll({ settings: SETTINGS, entries: [csvEntry('x', 'k', { amountCents: 'abc' })], kind: 'demo' }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(await repo.listEntries()).toEqual([kept]);
  });

  it('replaceAll com conflito de chave aborta a transação inteira e preserva os dados', async () => {
    const { repo } = open();
    await repo.saveSettings(SETTINGS);
    const kept = await repo.addEntry(draft());
    await expect(
      repo.replaceAll({ settings: { ...SETTINGS, openingBalanceCents: '7' }, entries: [csvEntry('a', 'dup'), csvEntry('b', 'dup')], kind: 'demo' }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await repo.listEntries()).toEqual([kept]);
    expect((await repo.getSettings())?.openingBalanceCents).toBe('300000');
  });

  it('tipo de conjunto: null → user após primeira gravação; demo só via replaceAll', async () => {
    const { repo } = open();
    expect(await repo.getDatasetKind()).toBeNull();
    await repo.addEntry(draft());
    expect(await repo.getDatasetKind()).toBe('user');
  });

  it('clearAll exige confirmação explícita e então apaga tudo', async () => {
    const { repo } = open();
    await repo.saveSettings(SETTINGS);
    await repo.addEntry(draft());
    await expect(repo.clearAll({ confirmed: false as unknown as true })).rejects.toMatchObject({ code: 'confirmation_required' });
    await expect(repo.clearAll(undefined as unknown as { confirmed: true })).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(await repo.listEntries()).toHaveLength(1);
    await repo.clearAll({ confirmed: true });
    expect(await repo.listEntries()).toEqual([]);
    expect(await repo.getSettings()).toBeNull();
    expect(await repo.getDatasetKind()).toBeNull();
  });
});

describe('falhas de armazenamento não destroem dados em silêncio', () => {
  it('indisponibilidade ao abrir vira StorageError(unavailable) e permite nova tentativa', async () => {
    const real = new IDBFactory();
    let failures = 1;
    const flaky = {
      open: (name: string, version?: number) => {
        if (failures > 0) {
          failures -= 1;
          const req = {} as IDBOpenDBRequest & { error: DOMException | null };
          queueMicrotask(() => {
            Object.defineProperty(req, 'error', { value: new DOMException('indisponível', 'UnknownError') });
            req.onerror?.(new Event('error') as never);
          });
          return req;
        }
        return real.open(name, version);
      },
    } as unknown as IDBFactory;
    const repo = createRepository({ factory: flaky, dbName: 'cf-test' });
    await expect(repo.listEntries()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(repo.listEntries()).resolves.toEqual([]);
  });

  it('sem IndexedDB no ambiente: StorageError(unavailable)', async () => {
    const repo = createRepository({ factory: null, dbName: 'cf-test' });
    await expect(repo.getSettings()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('quota excedida na gravação vira StorageError(quota) e preserva os dados anteriores', async () => {
    const { repo } = open();
    const kept = await repo.addEntry(draft());
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => {
      throw new DOMException('cheio', 'QuotaExceededError');
    });
    await expect(repo.addEntry(draft({ description: 'novo' }))).rejects.toMatchObject({ code: 'quota' });
    expect(await repo.listEntries()).toEqual([kept]);
  });

  it('erro genérico em put vira StorageError(write_failed)', async () => {
    const { repo } = open();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('falha', 'DataError');
    });
    await expect(repo.saveSettings(SETTINGS)).rejects.toMatchObject({ code: 'write_failed' });
    expect(await repo.getSettings()).toBeNull();
  });

  it('StorageError carrega código e mensagem legível', () => {
    const e = new StorageError('quota', 'Sem espaço.');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('quota');
    expect(e.message).toBe('Sem espaço.');
  });

  it('fechar a conexão e usar de novo reabre sem perder dados', async () => {
    const { repo } = open();
    await repo.addEntry(draft());
    repo.close();
    expect(await repo.listEntries()).toHaveLength(1);
  });
});
