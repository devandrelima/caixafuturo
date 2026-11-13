import { describe, expect, it } from 'vitest';
import { simulate } from '../../domain/scenarios/engine';
import { advanceCost } from '../../domain/scenarios/advance';
import { createAdvancedDemoAdjustments, createAdvancedDemoBase, createAdvancedDemoEntries } from '../advancedDemo';
import { createScenarioDemoBase } from '../scenarioDemo';

const at = (r: { points: { date: string; closingCents: bigint }[] }, date: string) => r.points.find((p) => p.date === date)?.closingCents;

describe('advancedDemo — base fictícia da S06 (valores conferidos por modelo Python independente)', () => {
  it('a base: saldos de fechamento documentados e fim do horizonte em 09/02/2027', () => {
    const r = simulate(createAdvancedDemoBase(), []);
    expect([ '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-20', '2026-12-05', '2026-12-10', '2027-02-09'].map((d) => at(r.baseProjection, d))).toEqual([
      300_000n, 80_000n, 260_000n, 356_010n, 206_010n, 398_030n, 318_030n, 818_030n, 698_030n, 698_030n,
    ]);
    expect(r.baseProjection.points).toHaveLength(90);
    expect(r.baseProjection.points.at(-1)?.date).toBe('2027-02-09');
    expect(r.baseProjection.summary.riskDays).toBe(1);
  });

  it('não altera a fixture da S05: os mesmos lançamentos e a mesma base de venda; os dois novos são só dezembro', () => {
    const s05 = createScenarioDemoBase();
    const adv = createAdvancedDemoEntries();
    expect(adv.slice(0, s05.entries.length).map((e) => e.id).sort()).toEqual(s05.entries.map((e) => e.id).sort());
    expect(adv.slice(s05.entries.length).map((e) => e.dueDate)).toEqual(['2026-12-05', '2026-12-10']);
    expect(createAdvancedDemoBase().saleBasis).toEqual(s05.saleBasis);
  });

  it('as quatro decisões + o atraso da S05 na MESMA Alternativa: cada efeito aplicado, sem soma dupla (à mão/Python)', () => {
    const r = simulate(createAdvancedDemoBase(), createAdvancedDemoAdjustments());
    expect(r.effects.map((e) => e.status)).toEqual(['applied', 'applied', 'applied', 'applied', 'applied']);
    // antecipação: R$ 1.920,20 de 18/11 → 13/11 (5 dias, 2% a.m.): custo 6,40, líquido R$ 1.913,80
    expect(advanceCost(192_020n, 200, 5)).toBe(640n);
    // compra: R$ 6.000 em 3× a 2%: 2.080,53 + 2.080,53 + 2.080,52 = 6.241,58 (encargos R$ 241,58); contratação: R$ 3.080,00 por mês
    const expected: [string, bigint, bigint][] = [
      ['2026-11-12', 300_000n, 0n],
      ['2026-11-13', 271_380n, 191_380n],
      ['2026-11-14', 271_380n, 11_380n],
      ['2026-11-16', 367_390n, 11_380n],
      ['2026-11-17', 547_390n, 341_380n],
      ['2026-11-18', 547_390n, 149_360n],
      ['2026-11-20', 467_390n, 149_360n],
      ['2026-11-24', 317_390n, -640n],
      ['2026-11-25', 109_337n, -208_693n],
      ['2026-12-05', 301_337n, -516_693n],
      ['2026-12-10', 181_337n, -516_693n],
      ['2026-12-25', -26_716n, -724_746n],
      ['2027-01-05', -334_716n, -1_032_746n],
      ['2027-01-25', -542_768n, -1_240_798n],
      ['2027-02-05', -850_768n, -1_548_798n],
    ];
    for (const [date, alt, delta] of expected) {
      expect(at(r.alternativeProjection, date), `alt ${date}`).toBe(alt);
      expect(r.deltaByDate.find((d) => d.date === date)?.deltaCents, `delta ${date}`).toBe(delta);
    }
    expect(r.deltaByDate.at(-1)?.deltaCents).toBe(-1_548_798n);
    expect(r.alternativeProjection.summary.riskDays).toBe(47);
    expect(r.alternativeProjection.summary.lowest.closingCents).toBe(-850_768n);
  });

  it('criados e retirados: 3 parcelas + 3 custos mensais + 1 líquido antecipado; só o repasse antecipado sai', () => {
    const r = simulate(createAdvancedDemoBase(), createAdvancedDemoAdjustments());
    expect(r.createdEntries.map((e) => [e.id, e.dueDate, e.direction, e.amountCents])).toEqual([
      ['scn:demo-compra:1', '2026-11-25', 'out', '208053'],
      ['scn:demo-compra:2', '2026-12-25', 'out', '208053'],
      ['scn:demo-compra:3', '2027-01-25', 'out', '208052'],
      ['scn:demo-contratacao:1', '2026-12-05', 'out', '308000'],
      ['scn:demo-contratacao:2', '2027-01-05', 'out', '308000'],
      ['scn:demo-contratacao:3', '2027-02-05', 'out', '308000'],
      ['scn:demo-antecipacao:1', '2026-11-13', 'in', '191380'],
    ]);
    expect(r.removedEntryIds).toEqual(['cen-rcv-02']);
    expect(r.effects.find((e) => e.adjustmentId === 'demo-vencimento')?.changes).toEqual([
      { entryId: 'cen-despesa-02', description: 'Aluguel fictício', field: 'dueDate', from: '2026-11-17', to: '2026-11-24' },
    ]);
    expect(r.assumptions.join(' ')).toContain('principal R$ 6.000,00 + encargos R$ 241,58 = total R$ 6.241,58');
  });

  it('a base não muda e o resultado é reproduzível', () => {
    const base = createAdvancedDemoBase();
    const before = JSON.stringify(base);
    const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
    expect(json(simulate(base, createAdvancedDemoAdjustments()))).toBe(json(simulate(base, createAdvancedDemoAdjustments())));
    expect(JSON.stringify(base)).toBe(before);
  });
});
