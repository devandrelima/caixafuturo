import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../../finance/dates';
import type { CashEntry, CashSettings } from '../../finance/types';
import { advanceCost, MAX_ADVANCE_RATE_BPS } from '../advance';
import { createBaseSnapshot, simulate } from '../engine';
import { ScenarioError } from '../types';
import type { Adjustment, AdvanceReceivableAdjustment, BaseSnapshot, SaleBasis } from '../types';

const settings: CashSettings = { baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' };
const entry = (id: string, direction: 'in' | 'out', amountCents: string, dueDate: string, extra: Partial<CashEntry> = {}): CashEntry => ({ id, direction, amountCents, dueDate, description: `L ${id}`, category: '', origin: 'manual', sourceKey: `manual:${id}`, state: 'scheduled', ...extra });
// Demo S01 (à mão): 12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 · 15/11 R$ 3.300.
const demo = (): CashEntry[] => [entry('demo-despesa-01', 'out', '250000', '2026-11-12'), entry('demo-receita-01', 'in', '80000', '2026-11-13'), entry('demo-despesa-02', 'out', '200000', '2026-11-14'), entry('demo-receita-02', 'in', '400000', '2026-11-15')];
const snap = (entries: CashEntry[] = demo(), horizonDays = 30, saleBasis: SaleBasis[] = []): BaseSnapshot => createBaseSnapshot({ settings, entries, horizonDays, saleBasis });
const adv = (entryId: string, advanceDate: string, rateBps: number, id = 'a1'): AdvanceReceivableAdjustment => ({ id, kind: 'advance_receivable', entryId, advanceDate, rateBps });
const closing = (r: { points: { date: string; closingCents: bigint }[] }, date: string) => r.points.find((p) => p.date === date)?.closingCents;
const closes = (r: { points: { closingCents: bigint }[] }) => r.points.map((p) => p.closingCents);

describe('advanceCost — taxa ao mês proporcional a dias/30, meio-sobe, em inteiros', () => {
  it('R$ 4.000,00 antecipados 2 dias a 1% a.m.: 400000×100×2/300000 = 266,67 → R$ 2,67', () => {
    expect(advanceCost(400_000n, 100, 2)).toBe(267n);
  });
  it('R$ 1.000,00 por 41 dias a 2,5% a.m.: 3.416,67 → R$ 34,17', () => {
    expect(advanceCost(100_000n, 250, 41)).toBe(3_417n);
  });
  it('limite exato do meio-sobe: 0,5 centavo sobe para 1; 0,495 desce para 0', () => {
    expect(advanceCost(100n, 100, 15)).toBe(1n); // 100×100×15/300000 = 0,5
    expect(advanceCost(99n, 100, 15)).toBe(0n); // 0,495
  });
  it('taxa zero não tem custo; 30 dias a 1% = exatamente 1% do valor', () => {
    expect(advanceCost(123_456n, 0, 30)).toBe(0n);
    expect(advanceCost(1_000_000n, 100, 30)).toBe(10_000n);
  });
});

describe('simulate — antecipação de recebíveis: o futuro SAI e o líquido ENTRA (nunca os dois)', () => {
  it('R$ 4.000 de 15/11 antecipado para 13/11 a 1% a.m.: custo R$ 2,67, líquido R$ 3.997,33 (à mão)', () => {
    const s = snap();
    const before = JSON.stringify(s);
    const r = simulate(s, [adv('demo-receita-02', '2026-11-13', 100)]);
    // base: 12/11 500 · 13/11 1.300 · 14/11 −700 · 15/11 3.300. Alternativa: 13/11 500+800+3.997,33 = 5.297,33 · 14/11 3.297,33 · 15/11 3.297,33
    expect(r.alternativeProjection.points.slice(0, 4).map((p) => p.closingCents)).toEqual([50_000n, 529_733n, 329_733n, 329_733n]);
    expect(r.deltaByDate.slice(0, 4).map((d) => d.deltaCents)).toEqual([0n, 399_733n, 399_733n, -267n]);
    expect(r.deltaByDate.at(-1)?.deltaCents).toBe(-267n); // do vencimento em diante a diferença é só o custo
    expect(r.removedEntryIds).toEqual(['demo-receita-02']);
    expect(r.createdEntries).toHaveLength(1);
    expect(r.createdEntries[0]).toMatchObject({ id: 'scn:a1:1', direction: 'in', amountCents: '399733', dueDate: '2026-11-13' });
    // o recebível original não aparece em NENHUM dia da alternativa; o líquido aparece uma vez
    const ids = r.alternativeProjection.points.flatMap((p) => p.entryIds);
    expect(ids).not.toContain('demo-receita-02');
    expect(ids.filter((id) => id === 'scn:a1:1')).toHaveLength(1);
    expect(r.effects[0]).toMatchObject({ status: 'applied', changedEntryIds: ['demo-receita-02'], createdEntryIds: ['scn:a1:1'] });
    expect(r.effects[0]?.changes).toEqual([{ entryId: 'demo-receita-02', description: 'L demo-receita-02', field: 'removed', from: '2026-11-15', to: null }]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('a soma é explicada: entradas da alternativa = entradas da base − custo (nada duplicado, nada perdido)', () => {
    const r = simulate(snap(), [adv('demo-receita-02', '2026-11-13', 100)]);
    expect(r.alternativeProjection.summary.totalIncomingCents).toBe(r.baseProjection.summary.totalIncomingCents - 267n);
    expect(r.alternativeProjection.summary.totalOutgoingCents).toBe(r.baseProjection.summary.totalOutgoingCents);
  });

  it('o texto mostra valor bruto, datas, taxa, custo em R$ e em %, líquido e "hipótese; nada foi solicitado"', () => {
    const text = simulate(snap(), [adv('demo-receita-02', '2026-11-13', 100)]).assumptions.join(' ');
    expect(text).toContain('Hipótese');
    expect(text).toContain('R$ 4.000,00');
    expect(text).toContain('15/11/2026');
    expect(text).toContain('13/11/2026');
    expect(text).toContain('2 dias antes');
    expect(text).toContain('taxa informada de 1% ao mês');
    expect(text).toContain('2/30 do mês');
    expect(text).toContain('custo R$ 2,67 (0,07% do valor)');
    expect(text).toContain('valor líquido R$ 3.997,33');
    expect(text).toMatch(/nunca os dois/);
    expect(text).toMatch(/nada foi solicitado ou contratado/i);
    expect(text).not.toMatch(/\b(antecipe agora|contrate|solicite agora|confirme)\b/i);
  });

  it('taxa zero é permitida: líquido = bruto e custo R$ 0,00', () => {
    const r = simulate(snap(), [adv('demo-receita-02', '2026-11-13', 0)]);
    expect(r.createdEntries[0]?.amountCents).toBe('400000');
    expect(r.deltaByDate.at(-1)?.deltaCents).toBe(0n);
    expect(r.assumptions.join(' ')).toContain('custo R$ 0,00');
  });

  it('PROPRIEDADE (300 casos): nunca soma dupla — diferença 0 antes, +líquido entre as datas, −custo depois; custo ≥ 0 e líquido > 0', () => {
    let seed = 20_261_115;
    const next = (max: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % max;
    };
    for (let i = 0; i < 300; i += 1) {
      const entries: CashEntry[] = [];
      const n = 3 + next(8);
      for (let k = 0; k < n; k += 1) entries.push(entry(`e${k}`, next(2) === 0 ? 'in' : 'out', String(100 + next(900_000)), addDays('2026-11-11', 3 + next(40))));
      const ins = entries.filter((e) => e.direction === 'in');
      if (ins.length === 0) continue;
      const target = ins[next(ins.length)] as CashEntry;
      const span = daysBetween('2026-11-11', target.dueDate) - 1; // datas possíveis: data-base+1 … vencimento−1
      const advanceDate = addDays('2026-11-11', 1 + next(span));
      const rate = next(MAX_ADVANCE_RATE_BPS + 1);
      const s = snap(entries, 60);
      const r = simulate(s, [adv(target.id, advanceDate, rate)]);
      const gross = BigInt(target.amountCents);
      const cost = advanceCost(gross, rate, daysBetween(advanceDate, target.dueDate));
      const net = gross - cost;
      expect(net > 0n && cost >= 0n).toBe(true);
      for (const d of r.deltaByDate) {
        const expected = d.date < advanceDate ? 0n : d.date < target.dueDate ? net : -cost;
        expect(d.deltaCents, `${target.id} ${d.date}`).toBe(expected);
      }
      expect(r.alternativeProjection.points.flatMap((p) => p.entryIds).filter((id) => id === target.id)).toEqual([]);
      expect(r.createdEntries).toHaveLength(1);
    }
  });

  it('elegibilidade: ignorada com aviso (nada muda) para inexistente, saída, liquidado, vencido até a data-base, data = vencimento, data depois do vencimento, data até a data-base', () => {
    const entries = [...demo(), entry('liq', 'in', '5000', '2026-11-20', { state: 'settled', settledAt: '2026-11-10' }), entry('velho', 'in', '7000', '2026-11-11')];
    const cases: [AdvanceReceivableAdjustment, RegExp][] = [
      [adv('nao-existe', '2026-11-13', 100), /não existe na base/],
      [adv('demo-despesa-02', '2026-11-12', 100), /não é um recebimento/],
      [adv('liq', '2026-11-13', 100), /já foi liquidado/],
      [adv('velho', '2026-11-13', 100), /até a data-base/],
      [adv('demo-receita-02', '2026-11-15', 100), /depois da data-base.*e antes do vencimento/],
      [adv('demo-receita-02', '2026-11-16', 100), /depois da data-base.*e antes do vencimento/],
      [adv('demo-receita-02', '2026-11-11', 100), /depois da data-base.*e antes do vencimento/],
      [adv('demo-receita-02', '2026-11-10', 100), /depois da data-base.*e antes do vencimento/],
    ];
    for (const [a, re] of cases) {
      const r = simulate(snap(entries), [a]);
      expect(r.effects[0]?.status, `${a.entryId} ${a.advanceDate}`).toBe('ignored');
      expect(r.warnings.join(' ')).toMatch(re);
      expect(closes(r.alternativeProjection)).toEqual(closes(r.baseProjection));
      expect(r.createdEntries).toEqual([]);
      expect(r.removedEntryIds).toEqual([]);
    }
  });

  it('um dia depois da data-base e um dia antes do vencimento são válidos (limites inclusivos)', () => {
    expect(simulate(snap(), [adv('demo-receita-02', '2026-11-12', 100)]).effects[0]?.status).toBe('applied');
    expect(simulate(snap(), [adv('demo-receita-02', '2026-11-14', 100)]).effects[0]?.status).toBe('applied');
  });

  it('custo igual ou maior que o valor: ignorada com aviso (não cria recebimento zero ou negativo)', () => {
    const entries = [entry('r', 'in', '100', '2027-10-01')];
    const r = simulate(snap(entries, 400), [adv('r', '2026-11-12', MAX_ADVANCE_RATE_BPS)]);
    expect(r.effects[0]?.status).toBe('ignored');
    expect(r.warnings.join(' ')).toMatch(/custo.*igual ou maior/);
    expect(r.createdEntries).toEqual([]);
  });

  it('custo EXATAMENTE igual ao valor (líquido zero): ignorada; um dia a menos de antecipação (líquido > 0) vale', () => {
    // 2.000 bps × 150 dias / 30 = 100% do valor: R$ 1,00 antecipado 150 dias custa R$ 1,00 e sobraria zero
    const entries = [entry('r', 'in', '100', '2027-04-11')];
    const zero = simulate(snap(entries, 200), [adv('r', '2026-11-12', MAX_ADVANCE_RATE_BPS)]);
    expect(advanceCost(100n, MAX_ADVANCE_RATE_BPS, 150)).toBe(100n);
    expect(zero.effects[0]?.status).toBe('ignored');
    expect(zero.createdEntries).toEqual([]);
    const ok = simulate(snap(entries, 200), [adv('r', '2026-11-13', MAX_ADVANCE_RATE_BPS)]); // 149 dias: custo 99, líquido R$ 0,01
    expect(ok.effects[0]?.status).toBe('applied');
    expect(ok.createdEntries[0]?.amountCents).toBe('1');
  });

  it('recebível derivado de venda: o texto lembra que o valor já é líquido da taxa da venda e preserva o vínculo causal', () => {
    const sale = entry('rep-1', 'in', '98000', '2026-11-20', { origin: 'sale', linkedSaleId: 'venda-7', sourceKey: 'sale:venda-7' });
    const r = simulate(snap([...demo(), sale], 30, [{ entryId: 'rep-1', saleDate: '2026-11-10', grossCents: '100000', costBps: 200 }]), [adv('rep-1', '2026-11-13', 150)]);
    expect(r.assumptions.join(' ')).toMatch(/repasse estimado.*já é o líquido da taxa/);
    expect(r.createdEntries[0]?.linkedSaleId).toBe('venda-7');
    expect(r.removedEntryIds).toEqual(['rep-1']);
  });

  it('INTERAÇÃO: atraso e antecipação no MESMO recebível nunca somam — o primeiro da lista vence, o outro é ignorado com aviso', () => {
    const delay: Adjustment = { id: 'd1', kind: 'delay_receipt', entryId: 'demo-receita-02', days: 2 };
    const a = simulate(snap(), [delay, adv('demo-receita-02', '2026-11-13', 100)]);
    expect(a.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(a.createdEntries).toEqual([]);
    expect(a.warnings.join(' ')).toMatch(/já alterado por/);
    expect(a.warnings.join(' ')).toMatch(/não foi criado/);
    expect(closing(a.alternativeProjection, '2026-11-17')).toBe(330_000n);
    const b = simulate(snap(), [adv('demo-receita-02', '2026-11-13', 100), delay]);
    expect(b.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(b.createdEntries).toHaveLength(1);
    expect(closing(b.alternativeProjection, '2026-11-17')).toBe(329_733n); // o atraso NÃO traz o original de volta
    expect(b.alternativeProjection.points.flatMap((p) => p.entryIds)).not.toContain('demo-receita-02');
  });

  it('INTERAÇÃO: choque de vendas e antecipação no mesmo repasse também não somam, em qualquer ordem', () => {
    const sale = entry('rep-1', 'in', '98000', '2026-11-20', { origin: 'sale', linkedSaleId: 'venda-7', sourceKey: 'sale:venda-7' });
    const basis: SaleBasis[] = [{ entryId: 'rep-1', saleDate: '2026-11-10', grossCents: '100000', costBps: 200 }];
    const shock: Adjustment = { id: 'x', kind: 'scale_sales', from: '2026-11-20', to: '2026-11-20', change: { mode: 'factor', factorBps: 5000 } };
    const s = snap([...demo(), sale], 30, basis);
    const first = simulate(s, [shock, adv('rep-1', '2026-11-13', 150)]);
    expect(first.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(first.createdEntries).toEqual([]);
    expect(first.alternativeProjection.summary.totalIncomingCents).toBe(first.baseProjection.summary.totalIncomingCents - 49_000n); // só o choque: 98.000 → 49.000
    const second = simulate(s, [adv('rep-1', '2026-11-13', 150), shock]);
    expect(second.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(second.createdEntries).toHaveLength(1);
    expect(second.createdEntries[0]?.amountCents).not.toBe('49000'); // o líquido sai do valor ORIGINAL, nunca do choque
  });

  it('duas antecipações do mesmo recebível: só a primeira vale', () => {
    const r = simulate(snap(), [adv('demo-receita-02', '2026-11-13', 100, 'a1'), adv('demo-receita-02', '2026-11-12', 100, 'a2')]);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'ignored']);
    expect(r.createdEntries.map((e) => e.id)).toEqual(['scn:a1:1']);
  });

  it('antecipar recebíveis diferentes: cada um sai do futuro e entra uma vez', () => {
    const r = simulate(snap(), [adv('demo-receita-02', '2026-11-13', 100, 'a1'), adv('demo-receita-01', '2026-11-12', 100, 'a2')]);
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'applied']);
    expect(r.removedEntryIds.sort()).toEqual(['demo-receita-01', 'demo-receita-02']);
    expect(r.createdEntries.map((e) => e.id)).toEqual(['scn:a1:1', 'scn:a2:1']);
  });

  it('entradas inválidas viram ScenarioError (taxa fora da faixa, não inteira, data inválida, id vazio)', () => {
    expect(() => simulate(snap(), [adv('demo-receita-02', '2026-11-13', -1)])).toThrow(/bps/);
    expect(() => simulate(snap(), [adv('demo-receita-02', '2026-11-13', MAX_ADVANCE_RATE_BPS + 1)])).toThrow(/bps/);
    expect(() => simulate(snap(), [adv('demo-receita-02', '2026-11-13', 1.5)])).toThrow(/bps/);
    expect(() => simulate(snap(), [adv('demo-receita-02', '2026-02-30', 100)])).toThrow(ScenarioError);
    expect(() => simulate(snap(), [adv('', '2026-11-13', 100)])).toThrow(ScenarioError);
  });

  it('é determinístico e a base congelada não muda', () => {
    const s = snap();
    const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
    expect(json(simulate(s, [adv('demo-receita-02', '2026-11-13', 100)]))).toBe(json(simulate(s, [adv('demo-receita-02', '2026-11-13', 100)])));
    expect(Object.isFrozen(s.entries[0])).toBe(true);
  });
});
