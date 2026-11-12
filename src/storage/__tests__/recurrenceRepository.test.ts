import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { expandRecurrences, occurrenceEntry, type RecurrenceRule } from '../../domain/finance/recurrence';
import { project } from '../../domain/finance/projection';
import type { CashEntry, CashSettings } from '../../domain/finance/types';
import { DB_VERSION } from '../db';
import { createRepository } from '../repository';
import { createRecurrenceRepository, newRuleId } from '../recurrenceRepository';

const SETTINGS: CashSettings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };
const NAME = 'cf-recurrence-test';

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  id: 'r_rent',
  direction: 'out',
  amountCents: '180000',
  description: 'Condomínio',
  category: 'Fixas',
  frequency: 'monthly',
  startDate: '2026-01-31',
  ...over,
});

const repos: { close(): void }[] = [];
const open = (factory = new IDBFactory()) => {
  const repo = createRepository({ factory, dbName: NAME });
  repos.push(repo);
  return { factory, repo, recurrence: repo.recurrence };
};
afterEach(() => {
  repos.splice(0).forEach((r) => r.close());
});

const sale = {
  id: 'sale_1',
  saleKey: 'sale:V-1',
  externalId: 'V-1',
  saleDate: '2026-11-10',
  method: 'pix' as const,
  grossCents: '10000',
  category: '',
  origin: 'csv' as const,
};

/** Banco v2 EXATAMENTE como a S02/S03 o criava (settings, entries, meta, sales, reconciliation), populado. */
async function seedV2(factory: IDBFactory): Promise<{ entries: CashEntry[] }> {
  const entries: CashEntry[] = [
    { id: 'e_manual', direction: 'out', amountCents: '200000', dueDate: '2026-11-14', description: 'Aluguel', category: 'Fixas', origin: 'manual', sourceKey: 'manual:e_manual', state: 'scheduled' },
    { id: 'e_paid', direction: 'out', amountCents: '5000', dueDate: '2026-11-10', description: 'Já pago', category: '', origin: 'manual', sourceKey: 'manual:e_paid', state: 'settled', settledAt: '2026-11-10' },
  ];
  await new Promise<void>((resolve, reject) => {
    const req = factory.open(NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('sourceKey', 'sourceKey', { unique: true });
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('sales', { keyPath: 'id' }).createIndex('saleKey', 'saleKey', { unique: true });
      db.createObjectStore('reconciliation', { keyPath: 'key' });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['settings', 'entries', 'meta', 'sales', 'reconciliation'], 'readwrite');
      tx.objectStore('settings').put({ key: 'cash', ...SETTINGS });
      tx.objectStore('settings').put({ key: 'settlementRules', rules: { marker: 'regras v2 do usuário' } });
      entries.forEach((e) => tx.objectStore('entries').put(e));
      tx.objectStore('meta').put({ key: 'dataset', kind: 'user' });
      tx.objectStore('sales').put(sale);
      tx.objectStore('reconciliation').put({ key: 'same:sale_1', kind: 'same', saleId: 'sale_1', entryId: 'e_manual' });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  return { entries };
}

describe('migração do IndexedDB v2 → v3', () => {
  it('a versão do esquema é 3', () => {
    expect(DB_VERSION).toBe(3);
  });

  it('banco v2 populado abre em v3 sem perder nada (config, lançamentos, liquidado, vendas, decisões, regras de repasse)', async () => {
    const factory = new IDBFactory();
    const { entries } = await seedV2(factory);
    const { repo, recurrence } = open(factory);
    expect(await repo.getSettings()).toEqual(SETTINGS);
    expect(await repo.listEntries()).toEqual([...entries].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)));
    expect(await repo.getDatasetKind()).toBe('user');
    expect((await repo.sales.listSales()).map((s) => s.id)).toEqual(['sale_1']);
    expect(await repo.sales.listDecisions()).toEqual([{ kind: 'same', saleId: 'sale_1', entryId: 'e_manual' }]);
    expect(await recurrence.listRules()).toEqual([]); // store nova, vazia
    // as regras de repasse (store settings) seguem intactas
    const raw = await new Promise<unknown>((resolve) => {
      const req = factory.open(NAME);
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction('settings').objectStore('settings').get('settlementRules');
        get.onsuccess = () => {
          db.close();
          resolve(get.result);
        };
      };
    });
    expect(raw).toEqual({ key: 'settlementRules', rules: { marker: 'regras v2 do usuário' } });
  });

  it('banco v1 também chega a v3 (migrações encadeadas)', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('sourceKey', 'sourceKey', { unique: true });
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    const { recurrence, repo } = open(factory);
    expect(await recurrence.listRules()).toEqual([]);
    expect(await repo.sales.listSales()).toEqual([]);
  });

  it('o banco migrado grava regras e a projeção da S01/S02 continua igual sem regras', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const { repo, recurrence } = open(factory);
    const before = project(SETTINGS, await repo.listEntries());
    await recurrence.saveRule(rule());
    expect(project(SETTINGS, await repo.listEntries())).toEqual(before); // regra só vale quando expandida
  });

  it('reabrir após a migração não reaplica nada: as regras gravadas sobrevivem', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const a = open(factory);
    await a.recurrence.saveRule(rule());
    a.repo.close();
    const b = open(factory);
    expect(await b.recurrence.listRules()).toEqual([rule()]);
  });
});

describe('recurrenceRepository', () => {
  it('salvar, listar (ordem estável por início e id), substituir pelo mesmo id e remover', async () => {
    const { recurrence } = open();
    await recurrence.saveRule(rule({ id: 'r_b', startDate: '2026-02-01' }));
    await recurrence.saveRule(rule({ id: 'r_a', startDate: '2026-02-01' }));
    await recurrence.saveRule(rule({ id: 'r_c', startDate: '2026-01-05' }));
    expect((await recurrence.listRules()).map((r) => r.id)).toEqual(['r_c', 'r_a', 'r_b']);
    await recurrence.saveRule(rule({ id: 'r_a', startDate: '2026-02-01', amountCents: '999' }));
    expect((await recurrence.listRules()).find((r) => r.id === 'r_a')?.amountCents).toBe('999');
    expect(await recurrence.listRules()).toHaveLength(3); // substituiu, não duplicou
    await recurrence.removeRule('r_b');
    expect((await recurrence.listRules()).map((r) => r.id)).toEqual(['r_c', 'r_a']);
    await recurrence.removeRule('nao-existe'); // idempotente
    expect(await recurrence.listRules()).toHaveLength(2);
  });

  it('campos opcionais (fim e datas excluídas) fazem a viagem de ida e volta', async () => {
    const { recurrence } = open();
    const full = rule({ endDate: '2026-12-31', skippedDates: ['2026-02-28'] });
    await recurrence.saveRule(full);
    expect(await recurrence.listRules()).toEqual([full]);
  });

  it.each([
    [{ amountCents: '0' }, /valor/i],
    [{ description: '  ' }, /descri/i],
    [{ endDate: '2025-01-01' }, /final/i],
    [{ frequency: 'daily' as never }, /periodicidade/i],
    [{ startDate: '2026-02-30' }, /inicial/i],
  ])('recusa regra inválida %j sem gravar nada', async (patch, msg) => {
    const { recurrence } = open();
    await expect(recurrence.saveRule(rule(patch))).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(msg) });
    expect(await recurrence.listRules()).toEqual([]);
  });

  it('gravar regra num banco vazio marca o conjunto como "user" (não "demo")', async () => {
    const { repo, recurrence } = open();
    expect(await repo.getDatasetKind()).toBeNull();
    await recurrence.saveRule(rule());
    expect(await repo.getDatasetKind()).toBe('user');
  });

  it('newRuleId gera ids únicos no formato r_<hex> usando getRandomValues (não randomUUID)', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRuleId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^r_[0-9a-f]{20}$/);
  });

  it('banco indisponível → erro legível, não exceção solta', async () => {
    const repo = createRepository({ factory: null, dbName: NAME });
    repos.push(repo);
    await expect(repo.recurrence.listRules()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('regras × lançamentos no mesmo banco', () => {
  it('EXCLUIR a regra NÃO apaga lançamentos já materializados (nem o liquidado)', async () => {
    const { repo, recurrence } = open();
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'user' });
    const r = rule();
    await recurrence.saveRule(r);
    const settled: CashEntry = { ...occurrenceEntry(r, '2026-11-30'), amountCents: '175000', state: 'settled', settledAt: '2026-11-30' };
    await repo.importEntries([settled]);
    await recurrence.removeRule(r.id);
    expect(await recurrence.listRules()).toEqual([]);
    expect(await repo.listEntries()).toEqual([settled]);
  });

  it('materializar a mesma ocorrência duas vezes é idempotente (chave de origem) e não soma duas vezes', async () => {
    const { repo, recurrence } = open();
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'user' });
    const r = rule();
    await recurrence.saveRule(r);
    const occ = occurrenceEntry(r, '2026-11-30');
    expect((await repo.importEntries([occ])).created).toEqual([occ.id]);
    expect((await repo.importEntries([occ])).skipped).toEqual([occ.id]);
    const entries = await repo.listEntries();
    const { entries: expanded, covered } = expandRecurrences(await recurrence.listRules(), entries, { from: '2026-11-12', to: '2026-12-31' });
    expect(expanded.map((e) => e.dueDate)).toEqual(['2026-12-31']);
    expect(covered.map((c) => c.reason)).toEqual(['materialized']);
    const result = project(SETTINGS, [...entries, ...expanded]);
    expect(result.points.find((p) => p.date === '2026-11-30')?.closingCents).toBe(300000n - 180000n); // 1.200,00
    expect(result.duplicates).toEqual([]);
  });

  it('mudar a regra depois NÃO altera a ocorrência já gravada (passado imutável) e muda só as calculadas', async () => {
    const { repo, recurrence } = open();
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'user' });
    const r = rule();
    await recurrence.saveRule(r);
    const gravada = occurrenceEntry(r, '2026-11-30');
    await repo.importEntries([gravada]);
    await recurrence.saveRule({ ...r, amountCents: '200000' });
    const entries = await repo.listEntries();
    expect(entries).toEqual([gravada]);
    expect(entries[0]?.amountCents).toBe('180000');
    const { entries: calc } = expandRecurrences(await recurrence.listRules(), entries, { from: '2026-11-12', to: '2026-12-31' });
    expect(calc.map((e) => [e.dueDate, e.amountCents])).toEqual([['2026-12-31', '200000']]);
  });

  it('replaceAll troca as regras pelas do novo conjunto; sem regras, apaga as anteriores', async () => {
    const { repo, recurrence } = open();
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'user', recurrences: [rule({ id: 'r_1' })] });
    expect((await recurrence.listRules()).map((r) => r.id)).toEqual(['r_1']);
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'demo', recurrences: [rule({ id: 'r_2' })] });
    expect((await recurrence.listRules()).map((r) => r.id)).toEqual(['r_2']);
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'demo' });
    expect(await recurrence.listRules()).toEqual([]);
  });

  it('replaceAll recusa regra inválida e não perde os dados anteriores (tudo ou nada)', async () => {
    const { repo, recurrence } = open();
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'user', recurrences: [rule({ id: 'r_1' })] });
    await expect(repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'user', recurrences: [rule({ id: 'r_bad', amountCents: '0' })] })).rejects.toMatchObject({ code: 'invalid' });
    expect((await recurrence.listRules()).map((r) => r.id)).toEqual(['r_1']);
  });

  it('clearAll apaga também as regras', async () => {
    const { repo, recurrence } = open();
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'user', recurrences: [rule()] });
    await repo.clearAll({ confirmed: true });
    expect(await recurrence.listRules()).toEqual([]);
    expect(await repo.getSettings()).toBeNull();
  });
});

describe('createRecurrenceRepository isolado', () => {
  it('funciona sozinho sobre o mesmo banco do repositório principal', async () => {
    const factory = new IDBFactory();
    const main = createRepository({ factory, dbName: NAME });
    const solo = createRecurrenceRepository({ factory, dbName: NAME });
    repos.push(main, solo);
    await solo.saveRule(rule());
    expect(await main.recurrence.listRules()).toEqual([rule()]);
  });
});
