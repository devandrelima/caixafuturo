import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { planImport, planReferenceUpdates, previewAccountsCsv } from '../../domain/import/csv';
import { project } from '../../domain/finance/projection';
import type { CashEntry, CashSettings } from '../../domain/finance/types';
import { planSalesImport, previewSalesCsv } from '../../domain/sales/importSales';
import { reconcile } from '../../domain/sales/reconcile';
import { DEFAULT_SETTLEMENT_RULES } from '../../domain/sales/settlement';
import type { Sale } from '../../domain/sales/types';
import { DB_VERSION } from '../db';
import { createRepository } from '../repository';
import { createSalesRepository } from '../salesRepository';

const SETTINGS: CashSettings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };
const NAME = 'cf-sales-test';
const SH = 'identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria';
const AH = 'tipo;descricao;valor;vencimento;categoria;identificador_externo;referencia_venda';
const salesOf = (...rows: string[]): Sale[] => previewSalesCsv([SH, ...rows].join('\n')).valid.map((v) => v.sale);

const repos: { close(): void }[] = [];
const open = (factory = new IDBFactory()) => {
  const repo = createRepository({ factory, dbName: NAME });
  const sales = createSalesRepository({ factory, dbName: NAME });
  repos.push(repo, sales);
  return { factory, repo, sales };
};
afterEach(() => {
  repos.splice(0).forEach((r) => r.close());
});

/** Banco v1 EXATAMENTE como a S01 o criava, populado com dados reais do usuário. */
async function seedV1(factory: IDBFactory): Promise<CashEntry[]> {
  const entries: CashEntry[] = [
    { id: 'e_manual', direction: 'out', amountCents: '200000', dueDate: '2026-11-14', description: 'Aluguel', category: 'Fixas', origin: 'manual', sourceKey: 'manual:e_manual', state: 'scheduled' },
    { id: 'csv_aaa', direction: 'in', amountCents: '80000', dueDate: '2026-11-13', description: 'Recebimento', category: '', origin: 'csv', sourceKey: 'csv:external:R-1', state: 'scheduled' },
    { id: 'e_paid', direction: 'out', amountCents: '5000', dueDate: '2026-11-10', description: 'Já pago', category: '', origin: 'manual', sourceKey: 'manual:e_paid', state: 'settled', settledAt: '2026-11-10' },
  ];
  await new Promise<void>((resolve, reject) => {
    const req = factory.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('sourceKey', 'sourceKey', { unique: true });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['settings', 'entries', 'meta'], 'readwrite');
      tx.objectStore('settings').put({ key: 'cash', ...SETTINGS });
      entries.forEach((e) => tx.objectStore('entries').put(e));
      tx.objectStore('meta').put({ key: 'dataset', kind: 'user' });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  return entries;
}

describe('migração do IndexedDB v1 → v2', () => {
  it('a versão do esquema é 2', () => {
    expect(DB_VERSION).toBe(2);
  });

  it('banco v1 populado abre em v2 sem perder configurações, lançamentos, estado liquidado nem tipo do conjunto', async () => {
    const factory = new IDBFactory();
    const seeded = await seedV1(factory);
    const { repo, sales } = open(factory);
    expect(await repo.getSettings()).toEqual(SETTINGS);
    expect(await repo.listEntries()).toEqual([...seeded].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)));
    expect(await repo.getDatasetKind()).toBe('user');
    // stores novas existem e começam vazias; regras caem no padrão
    expect(await sales.listSales()).toEqual([]);
    expect(await sales.listDecisions()).toEqual([]);
    expect(await sales.getRules()).toEqual(DEFAULT_SETTLEMENT_RULES);
  });

  it('o banco migrado aceita novos dados e a projeção da S01 não muda', async () => {
    const factory = new IDBFactory();
    await seedV1(factory);
    const { repo, sales } = open(factory);
    const before = project(SETTINGS, await repo.listEntries());
    await sales.importSales(salesOf('V-1;12/11/2026;100,00;pix;'));
    const after = project(SETTINGS, await repo.listEntries());
    expect(after).toEqual(before); // vendas armazenadas não mexem no caixa sem derivar/reconciliar
    expect(before.points[1]?.closingCents).toBe(300000n + 80000n); // 13/11: +800 ; 12/11 sem lançamentos
  });

  it('reabrir após a migração não reaplica nada (idempotente) e importar contas continua idempotente', async () => {
    const factory = new IDBFactory();
    await seedV1(factory);
    const a = open(factory);
    await a.sales.importSales(salesOf('V-1;12/11/2026;100,00;pix;'));
    a.repo.close();
    a.sales.close();
    const b = open(factory);
    expect((await b.sales.listSales()).map((s) => s.externalId)).toEqual(['V-1']);
    const csv = previewAccountsCsv(`${AH}\nreceber;Recebimento;800,00;13/11/2026;;R-1;`);
    const plan = planImport(csv, (await b.repo.listEntries()).map((e) => e.sourceKey));
    expect(plan.summary.created).toBe(0);
  });
});

describe('salesRepository', () => {
  it('importSales: tudo ou nada, idempotente por chave e rejeita venda inválida sem gravar nada', async () => {
    const { sales } = open();
    const s = salesOf('V-1;12/11/2026;100,00;pix;', 'V-2;12/11/2026;50,00;crédito;');
    expect(await sales.importSales(s)).toEqual({ created: s.map((x) => x.id), skipped: [] });
    expect(await sales.importSales(s)).toEqual({ created: [], skipped: s.map((x) => x.id) });
    expect((await sales.listSales()).map((x) => x.externalId).sort()).toEqual(['V-1', 'V-2']);
    const bad = { ...salesOf('V-3;12/11/2026;10,00;pix;')[0]!, grossCents: '0' };
    await expect(sales.importSales([salesOf('V-4;12/11/2026;10,00;pix;')[0]!, bad])).rejects.toMatchObject({ code: 'invalid' });
    expect((await sales.listSales()).map((x) => x.externalId).sort()).toEqual(['V-1', 'V-2']);
  });

  it.each([
    [{ saleDate: '2026-02-30' }, /data/i],
    [{ method: 'cheque' as never }, /meio/i],
    [{ grossCents: '12,5' }, /valor/i],
    [{ grossCents: '-5' }, /maior que zero/i],
    [{ saleKey: '' }, /identifica/i],
  ])('recusa venda inválida %j e não grava nada', async (patch, msg) => {
    const { sales } = open();
    await expect(sales.importSales([{ ...salesOf('V-1;12/11/2026;10,00;pix;')[0]!, ...patch }])).rejects.toThrow(msg);
    expect(await sales.listSales()).toEqual([]);
  });

  it('regras: padrão, salvar válidas, recusar inválidas', async () => {
    const { sales } = open();
    const custom = { ...DEFAULT_SETTLEMENT_RULES, credit: { method: 'credit' as const, feeBps: 250, commissionBps: 0, lagDays: 14 } };
    await sales.saveRules(custom);
    expect(await sales.getRules()).toEqual(custom);
    await expect(sales.saveRules({ ...custom, pix: { ...custom.pix, feeBps: -1 } })).rejects.toMatchObject({ code: 'invalid' });
    expect(await sales.getRules()).toEqual(custom);
  });

  it('decisões de conciliação: salvar, substituir por venda, remover', async () => {
    const { sales } = open();
    await sales.saveDecision({ kind: 'same', saleId: 'sale_a', entryId: 'e1' });
    await sales.saveDecision({ kind: 'same', saleId: 'sale_a', entryId: 'e2' }); // substitui
    await sales.saveDecision({ kind: 'standalone', entryId: 'e3' });
    expect(await sales.listDecisions()).toEqual([
      { kind: 'same', saleId: 'sale_a', entryId: 'e2' },
      { kind: 'standalone', entryId: 'e3' },
    ]);
    await sales.removeDecision({ kind: 'standalone', entryId: 'e3' });
    expect(await sales.listDecisions()).toEqual([{ kind: 'same', saleId: 'sale_a', entryId: 'e2' }]);
  });

  it('applyReferenceUpdates grava só a referência da conta existente; id inexistente é ignorado', async () => {
    const { repo, sales } = open();
    await repo.saveSettings(SETTINGS);
    const csv = previewAccountsCsv(`${AH}\nreceber;Repasse;100,00;12/11/2026;;R-1;`);
    await repo.importEntries(csv.valid.map((v) => v.entry));
    const [stored] = await repo.listEntries();
    expect(await sales.applyReferenceUpdates([{ entryId: stored!.id, saleReference: 'V-1' }, { entryId: 'nao-existe', saleReference: 'X' }])).toBe(1);
    expect(await repo.getEntry(stored!.id)).toEqual({ ...stored, saleReference: 'V-1' });
  });

  it('apagar tudo e substituir por outro conjunto também limpam vendas, regras e decisões', async () => {
    const { repo, sales } = open();
    await repo.saveSettings(SETTINGS);
    await sales.importSales(salesOf('V-1;12/11/2026;100,00;pix;'));
    await sales.saveDecision({ kind: 'standalone', entryId: 'e1' });
    await sales.saveRules({ ...DEFAULT_SETTLEMENT_RULES, pix: { method: 'pix', feeBps: 10, commissionBps: 0, lagDays: 0 } });
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'demo' });
    expect(await sales.listSales()).toEqual([]);
    expect(await sales.listDecisions()).toEqual([]);
    expect(await sales.getRules()).toEqual(DEFAULT_SETTLEMENT_RULES);
    await sales.importSales(salesOf('V-2;12/11/2026;100,00;pix;'));
    await repo.clearAll({ confirmed: true });
    expect(await sales.listSales()).toEqual([]);
  });

  it('replaceAll pode gravar vendas e regras junto, atomicamente', async () => {
    const { repo, sales } = open();
    const s = salesOf('V-1;12/11/2026;100,00;pix;');
    const rules = { ...DEFAULT_SETTLEMENT_RULES, pix: { method: 'pix' as const, feeBps: 10, commissionBps: 0, lagDays: 0 } };
    await repo.replaceAll({ settings: SETTINGS, entries: [], kind: 'demo', sales: s, rules });
    expect(await sales.listSales()).toEqual(s);
    expect(await sales.getRules()).toEqual(rules);
  });

  it('sem IndexedDB: erro de armazenamento indisponível', async () => {
    const sales = createSalesRepository({ factory: null });
    await expect(sales.listSales()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('ponta a ponta: contas e vendas em QUALQUER ordem dão o mesmo caixa (gate PEND-S02-001)', () => {
  const ACCOUNTS = [
    AH,
    'receber;Repasse crédito V-1;985,00;27/11/2026;;R-1;V-1', // vínculo explícito (líquido calculado = R$ 985,00)
    'receber;Repasse sem referência;100,00;13/11/2026;;R-2;', // ambíguo com V-2 (13/11, pix)
    'pagar;Aluguel;2.000,00;14/11/2026;;R-3;',
  ].join('\n');
  const SALES = [SH, 'V-1;12/11/2026;1.000,00;crédito;', 'V-2;13/11/2026;100,00;pix;', 'V-3;20/11/2026;300,00;pix;'].join('\n');
  // Pix sem taxa D+0; crédito 1,5% D+15: V-1 R$ 1.000,00 em 12/11 → líquido R$ 985,00 em 27/11.
  const RULES = {
    ...DEFAULT_SETTLEMENT_RULES,
    pix: { method: 'pix' as const, feeBps: 0, commissionBps: 0, lagDays: 0 },
    credit: { method: 'credit' as const, feeBps: 150, commissionBps: 0, lagDays: 15 },
  };

  async function importAccounts(h: ReturnType<typeof open>) {
    const preview = previewAccountsCsv(ACCOUNTS);
    const existing = await h.repo.listEntries();
    await h.repo.importEntries(planImport(preview, existing.map((e) => e.sourceKey)).toCreate);
    await h.sales.applyReferenceUpdates(planReferenceUpdates(preview, existing));
  }
  async function importSales(h: ReturnType<typeof open>) {
    const plan = planSalesImport(previewSalesCsv(SALES), await h.sales.listSales());
    await h.sales.importSales(plan.toCreate);
  }
  async function cash(h: ReturnType<typeof open>) {
    const r = reconcile({ baseDate: SETTINGS.baseDate, sales: await h.sales.listSales(), rules: RULES, entries: await h.repo.listEntries(), decisions: await h.sales.listDecisions() });
    const p = project(SETTINGS, r.projectionEntries);
    return { statuses: r.receivables.map((x) => [x.receivable.externalId, x.status]), closings: p.points.map((x) => x.closingCents), total: p.summary.totalIncomingCents };
  }

  it('contas→vendas = vendas→contas; reimportar ambos não muda nada; sem dupla contagem', async () => {
    const a = open();
    await a.repo.saveSettings(SETTINGS);
    await importAccounts(a);
    await importSales(a);
    const ab = await cash(a);

    const b = open();
    await b.repo.saveSettings(SETTINGS);
    await importSales(b);
    await importAccounts(b);
    const ba = await cash(b);
    expect(ba).toEqual(ab);

    // reimportação e reprocessamento
    await importAccounts(a);
    await importSales(a);
    await importSales(a);
    expect(await cash(a)).toEqual(ab);
    expect((await a.repo.listEntries()).length).toBe(3);
    expect((await a.sales.listSales()).length).toBe(3);

    // V-1 conciliado (valem os R$ 985,00 importados); V-2 pendente (só os R$ 100,00 importados); V-3 derivado (R$ 300,00)
    expect(Object.fromEntries(ab.statuses as [string, string][])).toEqual({ 'V-1': 'reconciled', 'V-2': 'pending', 'V-3': 'derived' });
    expect(ab.total).toBe(98500n + 10000n + 30000n);
  });

  it('importar vendas antes das contas, e as contas só depois com a referência nova, concilia sem duplicar', async () => {
    const h = open();
    await h.repo.saveSettings(SETTINGS);
    // 1ª rodada: conta SEM referência (arquivo antigo) e vendas → V-1 fica pendente (mesma data, sem chave)
    const semRef = previewAccountsCsv(`${AH}\nreceber;Repasse crédito V-1;985,00;27/11/2026;;R-1;`);
    await h.repo.importEntries(semRef.valid.map((v) => v.entry));
    await importSales(h);
    expect(Object.fromEntries((await cash(h)).statuses as [string, string][])['V-1']).toBe('pending');
    // 2ª rodada: o mesmo arquivo agora com a referência → enriquece a conta existente, não duplica
    await importAccounts(h);
    const entries = await h.repo.listEntries();
    expect(entries.filter((e) => e.sourceKey === 'csv:external:R-1')).toHaveLength(1);
    expect(entries.find((e) => e.sourceKey === 'csv:external:R-1')?.saleReference).toBe('V-1');
    expect(Object.fromEntries((await cash(h)).statuses as [string, string][])['V-1']).toBe('reconciled');
  });
});
