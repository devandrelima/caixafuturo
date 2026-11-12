import { describe, expect, it } from 'vitest';
import { project } from '../../finance/projection';
import type { CashEntry } from '../../finance/types';
import { previewSalesCsv } from '../importSales';
import { reconcile } from '../reconcile';
import { DEFAULT_SETTLEMENT_RULES } from '../settlement';
import type { ReconciliationDecision, SettlementRules } from '../types';

const H = 'identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria';
const sales = (...rows: string[]) => previewSalesCsv([H, ...rows].join('\n')).valid.map((v) => v.sale);
const BASE = '2026-11-11';
// Pix sem taxa e D+0: o líquido é igual ao bruto, o que simplifica as contas dos testes.
const RULES: SettlementRules = { ...DEFAULT_SETTLEMENT_RULES, pix: { method: 'pix', feeBps: 0, commissionBps: 0, lagDays: 0 } };

let n = 0;
const entry = (o: Partial<CashEntry>): CashEntry => {
  n += 1;
  return {
    id: `e${n}`, direction: 'in', amountCents: '10000', dueDate: '2026-11-12', description: 'Conta', category: '',
    origin: 'csv', sourceKey: `csv:external:K${n}`, state: 'scheduled', ...o,
  };
};
const run = (s: ReturnType<typeof sales>, entries: CashEntry[], decisions: ReconciliationDecision[] = []) =>
  reconcile({ baseDate: BASE, sales: s, rules: RULES, entries, decisions });
const statusOf = (r: ReturnType<typeof run>, ext: string) => r.receivables.find((x) => x.receivable.externalId === ext)!;
const settings = { baseDate: BASE, openingBalanceCents: '0', minimumBalanceCents: '0' };
const closing = (r: ReturnType<typeof run>, date: string) => project(settings, r.projectionEntries).points.find((p) => p.date === date)!.closingCents;

describe('sem vínculo: venda sem conta correspondente', () => {
  it('derivado conta no saldo na data de repasse, pelo líquido', () => {
    const r = run(sales('V-1;12/11/2026;100,00;pix;'), []);
    const v = statusOf(r, 'V-1');
    expect(v).toMatchObject({ status: 'derived', counts: true });
    expect(r.projectionEntries.map((e) => e.id)).toEqual([v.receivable.id]);
    expect(closing(r, '2026-11-12')).toBe(10000n);
  });
  it('sem vendas, as entradas passam intactas (regressão da S01)', () => {
    const entries = [entry({ direction: 'out' }), entry({})];
    const r = run([], entries);
    expect(r.projectionEntries).toEqual(entries);
    expect(r.receivables).toEqual([]);
  });
  it('data de repasse até a data-base: já está no saldo, não conta (nem vira pendência)', () => {
    const r = run(sales('V-1;10/11/2026;100,00;pix;', 'V-2;11/11/2026;50,00;pix;'), [entry({ dueDate: '2026-11-11' })]);
    expect(statusOf(r, 'V-1')).toMatchObject({ status: 'before_base_date', counts: false });
    expect(statusOf(r, 'V-2')).toMatchObject({ status: 'before_base_date', counts: false });
  });
  it('líquido zero (taxa de 100%) não vai ao motor', () => {
    const rules = { ...RULES, pix: { method: 'pix' as const, feeBps: 10000, commissionBps: 0, lagDays: 0 } };
    const r = reconcile({ baseDate: BASE, sales: sales('V-1;12/11/2026;100,00;pix;'), rules, entries: [], decisions: [] });
    expect(r.receivables[0]).toMatchObject({ status: 'zero_net', counts: false });
    expect(r.projectionEntries).toEqual([]);
  });
});

describe('vínculo explícito por referencia_venda (1:1)', () => {
  const s = sales('V-1;12/11/2026;100,00;pix;');
  it('conta importada prevalece; derivado não soma; diferença de valor é exibida', () => {
    const e = entry({ id: 'imp', saleReference: 'V-1', amountCents: '9900' });
    const r = run(s, [e]);
    expect(statusOf(r, 'V-1')).toMatchObject({ status: 'reconciled', counts: false, entryIds: ['imp'], differenceCents: -100n });
    expect(r.projectionEntries.map((x) => x.id)).toEqual(['imp']);
    expect(closing(r, '2026-11-12')).toBe(9900n);
    expect(r.entryViews.find((v) => v.entryId === 'imp')).toMatchObject({ link: 'reconciled', saleIds: [s[0]!.id] });
  });
  it('ordem de importação não altera o resultado (contas→vendas = vendas→contas, e entradas embaralhadas)', () => {
    const entries = [entry({ id: 'a', saleReference: 'V-1' }), entry({ id: 'b', saleReference: 'V-2', dueDate: '2026-11-13' }), entry({ id: 'c', direction: 'out', dueDate: '2026-11-14' })];
    const sl = sales('V-1;12/11/2026;100,00;pix;', 'V-2;13/11/2026;100,00;pix;', 'V-3;14/11/2026;70,00;pix;');
    const a = run(sl, entries);
    const b = run([...sl].reverse(), [...entries].reverse());
    expect(b.projectionEntries.map((x) => x.id).sort()).toEqual(a.projectionEntries.map((x) => x.id).sort());
    expect(project(settings, b.projectionEntries)).toEqual(project(settings, a.projectionEntries));
    expect(a.receivables.map((x) => [x.receivable.externalId, x.status])).toEqual(b.receivables.map((x) => [x.receivable.externalId, x.status]));
  });
  it('referência sem venda importada: a conta conta; o vínculo nasce quando a venda chega', () => {
    const e = entry({ id: 'imp', saleReference: ' V-9 ' }); // espaços são ignorados
    const antes = run([], [e]);
    expect(antes.entryViews[0]).toMatchObject({ link: 'orphan_reference', saleIds: [] });
    expect(antes.projectionEntries.map((x) => x.id)).toEqual(['imp']);
    const depois = run(sales('V-9;12/11/2026;100,00;pix;'), [e]);
    expect(statusOf(depois, 'V-9').status).toBe('reconciled');
    expect(closing(depois, '2026-11-12')).toBe(10000n); // continua uma única disponibilidade
  });
  it('conta liquidada continua cobrindo a venda: o derivado não reaparece', () => {
    const e = entry({ id: 'imp', saleReference: 'V-1', state: 'settled', settledAt: '2026-11-12' });
    const r = run(s, [e]);
    expect(statusOf(r, 'V-1').status).toBe('reconciled');
    expect(closing(r, '2026-11-12')).toBe(0n); // liquidada já está no saldo informado; nada soma de novo
  });
  it('editar a conta (valor/data) mantém o vínculo; excluir a conta devolve o derivado', () => {
    const edited = run(s, [entry({ id: 'imp', saleReference: 'V-1', amountCents: '12345', dueDate: '2026-11-20' })]);
    expect(statusOf(edited, 'V-1')).toMatchObject({ status: 'reconciled', differenceCents: 2345n });
    expect(closing(edited, '2026-11-20')).toBe(12345n);
    const deleted = run(s, []);
    expect(statusOf(deleted, 'V-1')).toMatchObject({ status: 'derived', counts: true });
  });
  it('referência em conta de saída é ignorada', () => {
    const r = run(s, [entry({ direction: 'out', saleReference: 'V-1' })]);
    expect(statusOf(r, 'V-1').status).toBe('derived');
  });
  it('referência repetida na mesma lista conta uma vez (V-1|V-1 = 1:1)', () => {
    const r = run(s, [entry({ id: 'imp', saleReference: 'V-1|V-1' })]);
    expect(statusOf(r, 'V-1').status).toBe('reconciled');
  });
});

describe('limitações sinalizadas, não fingidas: lotes e parcelas', () => {
  const sl = sales('V-1;12/11/2026;100,00;pix;', 'V-2;12/11/2026;60,00;pix;', 'V-3;12/11/2026;40,00;pix;');
  it('lote (A|B): derivados cobertos ficam fora; a conta importada entra; V-3 segue derivado', () => {
    const lote = entry({ id: 'lote', saleReference: 'V-1|V-2', amountCents: '15900' });
    const r = run(sl, [lote]);
    expect(statusOf(r, 'V-1')).toMatchObject({ status: 'covered_batch', counts: false });
    expect(statusOf(r, 'V-2')).toMatchObject({ status: 'covered_batch', counts: false });
    expect(statusOf(r, 'V-3')).toMatchObject({ status: 'derived', counts: true });
    expect(r.entryViews[0]).toMatchObject({ link: 'batch', saleIds: [sl[0]!.id, sl[1]!.id] });
    expect(closing(r, '2026-11-12')).toBe(15900n + 4000n);
  });
  it('parcelas (2 contas para a mesma venda): derivado fora; as duas contas entram', () => {
    const p1 = entry({ id: 'p1', saleReference: 'V-1', amountCents: '5000' });
    const p2 = entry({ id: 'p2', saleReference: 'V-1', amountCents: '5000', dueDate: '2026-12-12' });
    const r = run(sl, [p1, p2]);
    expect(statusOf(r, 'V-1')).toMatchObject({ status: 'covered_installments', counts: false, entryIds: ['p1', 'p2'] });
    expect(r.entryViews.filter((v) => v.link === 'installments').map((v) => v.entryId)).toEqual(['p1', 'p2']);
    expect(r.projectionEntries.filter((x) => x.id === 'p1' || x.id === 'p2')).toHaveLength(2);
  });
});

describe('ambiguidade: sem chave confiável nunca concilia sozinho', () => {
  const s = sales('V-1;12/11/2026;100,00;pix;');
  it('conta sem referência, mesmo valor e data: derivado PENDENTE, só a importada entra', () => {
    const e = entry({ id: 'imp', amountCents: '10000', dueDate: '2026-11-12' });
    const r = run(s, [e]);
    expect(statusOf(r, 'V-1')).toMatchObject({ status: 'pending', counts: false, entryIds: ['imp'] });
    expect(r.entryViews[0]).toMatchObject({ link: 'imported', pendingSaleIds: [s[0]!.id] });
    expect(closing(r, '2026-11-12')).toBe(10000n); // não soma 20000
  });
  it('valor diferente também é pendente (taxa real ≠ configurada não vira dupla contagem silenciosa)', () => {
    const r = run(s, [entry({ amountCents: '9871', dueDate: '2026-11-14' })]);
    expect(statusOf(r, 'V-1').status).toBe('pending');
  });
  it('janela: 3 dias é pendente; 4 dias volta a ser derivado', () => {
    expect(statusOf(run(s, [entry({ dueDate: '2026-11-15' })]), 'V-1').status).toBe('pending');
    expect(statusOf(run(s, [entry({ dueDate: '2026-11-16' })]), 'V-1').status).toBe('derived');
    expect(statusOf(run(s, [entry({ dueDate: '2026-11-09' })]), 'V-1').status).toBe('pending');
  });
  it('contas liquidadas, de saída ou com referência a outra venda não geram pendência', () => {
    const near = { dueDate: '2026-11-12' };
    expect(statusOf(run(s, [entry({ ...near, state: 'settled' })]), 'V-1').status).toBe('derived');
    expect(statusOf(run(s, [entry({ ...near, direction: 'out' })]), 'V-1').status).toBe('derived');
    expect(statusOf(run(s, [entry({ ...near, saleReference: 'OUTRA' })]), 'V-1').status).toBe('derived');
  });
  it('decisão "mesma": confirma o par, derivado vira conciliado e não soma', () => {
    const e = entry({ id: 'imp' });
    const r = run(s, [e], [{ kind: 'same', saleId: s[0]!.id, entryId: 'imp' }]);
    expect(statusOf(r, 'V-1')).toMatchObject({ status: 'reconciled', counts: false, entryIds: ['imp'] });
    expect(r.entryViews[0]).toMatchObject({ link: 'reconciled' });
    expect(closing(r, '2026-11-12')).toBe(10000n);
  });
  it('decisão "avulsa" (standalone): a conta não é de venda; derivado volta a contar', () => {
    const e = entry({ id: 'imp' });
    const r = run(s, [e], [{ kind: 'standalone', entryId: 'imp' }]);
    expect(statusOf(r, 'V-1')).toMatchObject({ status: 'derived', counts: true });
    expect(r.entryViews[0]!.link).toBe('standalone');
    expect(closing(r, '2026-11-12')).toBe(20000n); // duas receitas distintas, por escolha explícita
  });
  it('uma conta confirmada para uma venda não gera pendência para as outras próximas', () => {
    const two = sales('V-1;12/11/2026;100,00;pix;', 'V-2;12/11/2026;100,00;pix;');
    const r = run(two, [entry({ id: 'imp' })], [{ kind: 'same', saleId: two[0]!.id, entryId: 'imp' }]);
    expect(statusOf(r, 'V-1').status).toBe('reconciled');
    expect(statusOf(r, 'V-2').status).toBe('derived');
  });
  it('duas vendas e uma conta: ambas pendentes, nenhuma soma até decisão', () => {
    const two = sales('V-1;12/11/2026;100,00;pix;', 'V-2;12/11/2026;100,00;pix;');
    const r = run(two, [entry({ id: 'imp' })]);
    expect(two.map((x) => statusOf(r, x.externalId).status)).toEqual(['pending', 'pending']);
    expect(closing(r, '2026-11-12')).toBe(10000n);
  });
  it('decisão obsoleta (conta excluída, referência já cobre, conta já usada) é ignorada e reportada', () => {
    const two = sales('V-1;12/11/2026;100,00;pix;', 'V-2;12/11/2026;100,00;pix;');
    const gone: ReconciliationDecision = { kind: 'same', saleId: two[0]!.id, entryId: 'excluida' };
    const r1 = run(two, [], [gone]);
    expect(r1.staleDecisions).toEqual([gone]);
    expect(statusOf(r1, 'V-1').status).toBe('derived');
    const ref = entry({ id: 'ref', saleReference: 'V-1' });
    const free = entry({ id: 'free' });
    const conflict: ReconciliationDecision = { kind: 'same', saleId: two[0]!.id, entryId: 'free' };
    const r2 = run(two, [ref, free], [conflict]);
    expect(r2.staleDecisions).toEqual([conflict]);
    expect(statusOf(r2, 'V-1').entryIds).toEqual(['ref']);
    const dup: ReconciliationDecision[] = [
      { kind: 'same', saleId: two[0]!.id, entryId: 'free' },
      { kind: 'same', saleId: two[1]!.id, entryId: 'free' },
    ];
    const r3 = run(two, [free], dup);
    expect(r3.staleDecisions).toHaveLength(1);
    expect(r3.receivables.filter((x) => x.status === 'reconciled')).toHaveLength(1);
  });
});

describe('invariante: no máximo uma disponibilidade por recebimento econômico', () => {
  it('em todas as configurações, nenhuma venda é contada por derivado E por conta importada', () => {
    const sl = sales('V-1;12/11/2026;100,00;pix;', 'V-2;13/11/2026;80,00;pix;', 'V-3;14/11/2026;60,00;pix;');
    const cases: CashEntry[][] = [
      [],
      [entry({ id: 'a', saleReference: 'V-1' })],
      [entry({ id: 'a', saleReference: 'V-1|V-2' })],
      [entry({ id: 'a', saleReference: 'V-1' }), entry({ id: 'b', saleReference: 'V-1' })],
      [entry({ id: 'a', dueDate: '2026-11-13' })],
      [entry({ id: 'a', saleReference: 'V-3' }), entry({ id: 'b', dueDate: '2026-11-12' })],
    ];
    for (const entries of cases) {
      const r = run(sl, entries);
      for (const v of r.receivables) {
        const covered = v.status === 'reconciled' || v.status === 'covered_batch' || v.status === 'covered_installments' || v.status === 'pending';
        const inEngine = r.projectionEntries.some((e) => e.id === v.receivable.id);
        expect(inEngine).toBe(v.counts);
        if (covered) expect(inEngine).toBe(false);
      }
    }
  });
});
