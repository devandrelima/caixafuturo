import { describe, expect, it } from 'vitest';
import { MAX_ROWS } from '../../import/csv';
import { grossByDay, planSalesImport, previewSalesCsv, totalGrossCents } from '../importSales';
import type { Sale } from '../types';

const H = 'identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria';

/** Fixture fictícia: totais calculados à mão (ver comentários). */
const FIXTURE = [
  H,
  'V-001;02/11/2026;100,00;pix;Salão',
  'V-002;02/11/2026;250,50;crédito;Salão',
  'V-003;03/11/2026;1.234,56;débito;Delivery',
  'V-004;03/11/2026;80,00;dinheiro;Salão',
  'V-005;04/11/2026;45,90;voucher;',
].join('\n');
// 10000 + 25050 + 123456 + 8000 + 4590 = 171096 centavos = R$ 1.710,96

describe('previewSalesCsv — leitura e identidade', () => {
  it('lê vendas válidas com identidade rastreável e valores em centavos exatos', () => {
    const p = previewSalesCsv(FIXTURE);
    expect(p.fatalError).toBeNull();
    expect(p.totalRows).toBe(5);
    expect(p.invalid).toEqual([]);
    expect(p.valid).toHaveLength(5);
    expect(p.valid[0]).toMatchObject({
      line: 2,
      sale: {
        externalId: 'V-001',
        saleKey: 'sale:V-001',
        saleDate: '2026-11-02',
        grossCents: '10000',
        method: 'pix',
        category: 'Salão',
      },
    });
    expect(p.valid[2]?.sale).toMatchObject({ grossCents: '123456', method: 'debit', saleDate: '2026-11-03' });
    expect(p.valid[1]?.sale.method).toBe('credit');
    expect(p.valid[3]?.sale.method).toBe('cash');
    expect(p.valid[4]?.sale.method).toBe('voucher');
    expect(totalGrossCents(p.valid.map((v) => v.sale))).toBe(171096n);
  });

  it('o id interno é determinístico e derivado só da chave da venda (não da data/valor)', () => {
    const a = previewSalesCsv(`${H}\nV-9;02/11/2026;10,00;pix;`).valid[0]?.sale;
    const b = previewSalesCsv(`${H}\nV-9;05/11/2026;99,00;crédito;x`).valid[0]?.sale;
    expect(a?.id).toBe(b?.id);
    expect(a?.id).toMatch(/^sale_[0-9a-f]{20}$/);
    const c = previewSalesCsv(`${H}\nV-10;02/11/2026;10,00;pix;`).valid[0]?.sale;
    expect(c?.id).not.toBe(a?.id);
  });

  it('chave de venda não compartilha namespace com a chave do CSV de contas', () => {
    const sale = previewSalesCsv(`${H}\nX1;02/11/2026;10,00;pix;`).valid[0]?.sale;
    expect(sale?.saleKey.startsWith('sale:')).toBe(true);
    expect(sale?.saleKey.startsWith('csv:')).toBe(false);
  });

  it('aceita vírgula, tabulação, BOM, CRLF, aspas, datas ISO e cabeçalho com acento/caixa', () => {
    const csv = '﻿Identificador Venda,Data-Venda,Valor_Bruto,Meio Pagamento\r\n"V,1",2026-11-02,"1.000,00",PIX\r\n';
    const p = previewSalesCsv(csv);
    expect(p.fatalError).toBeNull();
    expect(p.valid[0]?.sale).toMatchObject({ externalId: 'V,1', grossCents: '100000', method: 'pix', category: '' });
  });

  it('normaliza sinônimos do meio de pagamento', () => {
    const rows = ['cartão de crédito', 'cartao_credito', 'Cartão Débito', 'espécie', 'vale refeição', 'VR', 'Pix'];
    const csv = [H, ...rows.map((m, i) => `S${i};02/11/2026;1,00;${m};`)].join('\n');
    const p = previewSalesCsv(csv);
    expect(p.invalid).toEqual([]);
    expect(p.valid.map((v) => v.sale.method)).toEqual(['credit', 'credit', 'debit', 'cash', 'voucher', 'voucher', 'pix']);
  });
});

describe('previewSalesCsv — erros por linha (nada parcial escondido)', () => {
  it('cada erro vem com número da linha e mensagem; linhas boas continuam válidas', () => {
    const csv = [
      H,
      'A1;02/11/2026;10,00;pix;', //                  linha 2 ok
      ';02/11/2026;10,00;pix;', //                    linha 3: sem id
      'A3;31/02/2026;10,00;pix;', //                  linha 4: data impossível
      'A4;02/11/2026;abc;pix;', //                    linha 5: valor inválido
      'A5;02/11/2026;0,00;pix;', //                   linha 6: zero
      'A6;02/11/2026;-5,00;pix;', //                  linha 7: negativo (estorno não suportado)
      'A7;02/11/2026;10,00;cheque;', //               linha 8: meio desconhecido
      'A8;02/11/2026;10,00;pix;' + 'c'.repeat(101), //linha 9: categoria longa
      'A9;02/11/2026;10,00;pix;', //                  linha 10 ok
    ].join('\n');
    const p = previewSalesCsv(csv);
    expect(p.fatalError).toBeNull();
    expect(p.totalRows).toBe(9);
    expect(p.valid.map((v) => v.line)).toEqual([2, 10]);
    expect(p.invalid.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(p.invalid[0]?.message).toMatch(/identificador/i);
    expect(p.invalid[1]?.message).toMatch(/data/i);
    expect(p.invalid[2]?.message).toMatch(/valor/i);
    expect(p.invalid[3]?.message).toMatch(/maior que zero/i);
    expect(p.invalid[4]?.message).toMatch(/negativ/i);
    expect(p.invalid[5]?.message).toMatch(/meio de pagamento/i);
    expect(p.invalid[6]?.message).toMatch(/categoria/i);
  });

  it('uma linha com vários problemas junta as mensagens', () => {
    const p = previewSalesCsv(`${H}\n;99/99/9999;xx;nada;`);
    expect(p.invalid).toHaveLength(1);
    expect(p.invalid[0]?.message.split('.').filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });

  it('identificador muito longo é recusado', () => {
    const p = previewSalesCsv(`${H}\n${'x'.repeat(101)};02/11/2026;1,00;pix;`);
    expect(p.invalid[0]?.message).toMatch(/identificador.*longo/i);
  });

  it('erros fatais: vazio, colunas ausentes/repetidas, aspas abertas e excesso de linhas', () => {
    expect(previewSalesCsv('').fatalError).toMatch(/vazio/i);
    expect(previewSalesCsv('   \n  ').fatalError).toMatch(/vazio/i);
    expect(previewSalesCsv('data_venda;valor_bruto\n02/11/2026;1,00').fatalError).toMatch(/identificador_venda.*meio_pagamento/);
    expect(previewSalesCsv(`${H};valor_bruto\nA;02/11/2026;1,00;pix;;1,00`).fatalError).toMatch(/repetidas.*valor_bruto/);
    expect(previewSalesCsv(`${H}\nA;02/11/2026;1,00;"pix;`).fatalError).toMatch(/aspas/i);
    const many = [H, ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => `V${i};02/11/2026;1,00;pix;`)].join('\n');
    expect(previewSalesCsv(many).fatalError).toMatch(/limite/i);
  });

  it('o CSV de contas é recusado como CSV de vendas (e vice-versa não é confundido)', () => {
    const accounts = 'tipo;descricao;valor;vencimento\nreceber;Venda;10,00;12/11/2026';
    const p = previewSalesCsv(accounts);
    expect(p.fatalError).toMatch(/colunas obrigatórias ausentes/i);
    expect(p.valid).toEqual([]);
  });

  it('aceita arquivo só com cabeçalho (0 linhas)', () => {
    const p = previewSalesCsv(H);
    expect(p.fatalError).toBeNull();
    expect(p.totalRows).toBe(0);
  });
});

describe('previewSalesCsv — duplicidade dentro do arquivo', () => {
  it('mesma venda repetida com os mesmos dados vira duplicata (não soma duas vezes)', () => {
    const p = previewSalesCsv([H, 'V-1;02/11/2026;100,00;pix;', 'V-1;02/11/2026;100,00;PIX;Outra categoria'].join('\n'));
    expect(p.valid).toHaveLength(1);
    expect(p.duplicates).toEqual([{ line: 3, duplicateOfLine: 2, saleKey: 'sale:V-1' }]);
    expect(p.invalid).toEqual([]);
  });

  it('mesmo identificador com data/valor/meio diferentes é erro (não sobrescreve nem soma)', () => {
    const p = previewSalesCsv([H, 'V-1;02/11/2026;100,00;pix;', 'V-1;02/11/2026;101,00;pix;'].join('\n'));
    expect(p.valid).toHaveLength(1);
    expect(p.invalid[0]).toMatchObject({ line: 3 });
    expect(p.invalid[0]?.message).toMatch(/linha 2.*dados diferentes/i);
  });

  it('vendas idênticas porém com identificadores distintos são vendas distintas', () => {
    const p = previewSalesCsv([H, 'V-1;02/11/2026;30,00;pix;', 'V-2;02/11/2026;30,00;pix;'].join('\n'));
    expect(p.valid).toHaveLength(2);
    expect(totalGrossCents(p.valid.map((v) => v.sale))).toBe(6000n);
  });
});

describe('planSalesImport — reimportar não duplica faturamento', () => {
  const salesOf = (csv: string): Sale[] => previewSalesCsv(csv).valid.map((v) => v.sale);

  it('primeira importação cria tudo; a segunda cria 0 e faturamento permanece 171096', () => {
    const first = planSalesImport(previewSalesCsv(FIXTURE), []);
    expect(first.summary).toEqual({ created: 5, ignored: 0, errors: 0, grossCreatedCents: '171096' });
    const stored = first.toCreate;
    const second = planSalesImport(previewSalesCsv(FIXTURE), stored);
    expect(second.toCreate).toEqual([]);
    expect(second.alreadyImported).toHaveLength(5);
    expect(second.summary).toEqual({ created: 0, ignored: 5, errors: 0, grossCreatedCents: '0' });
    expect(totalGrossCents([...stored, ...second.toCreate])).toBe(171096n);
  });

  it('arquivo sobreposto grava só as vendas novas', () => {
    const stored = salesOf(FIXTURE);
    const overlap = `${FIXTURE}\nV-006;05/11/2026;20,00;pix;\nV-001;02/11/2026;100,00;pix;Salão`;
    const plan = planSalesImport(previewSalesCsv(overlap), stored);
    expect(plan.toCreate.map((s) => s.externalId)).toEqual(['V-006']);
    expect(plan.summary).toEqual({ created: 1, ignored: 6, errors: 0, grossCreatedCents: '2000' });
  });

  it('recategorizar uma venda já importada não é conflito nem cria outra venda', () => {
    const stored = salesOf(FIXTURE);
    const again = FIXTURE.replace('V-001;02/11/2026;100,00;pix;Salão', 'V-001;02/11/2026;100,00;pix;Balcão');
    const plan = planSalesImport(previewSalesCsv(again), stored);
    expect(plan.toCreate).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it('mesmo identificador já gravado com valor/data/meio diferentes é conflito explícito, nunca sobrescrita silenciosa', () => {
    const stored = salesOf(FIXTURE);
    const altered = FIXTURE.replace('V-001;02/11/2026;100,00;pix', 'V-001;02/11/2026;105,00;pix');
    const plan = planSalesImport(previewSalesCsv(altered), stored);
    expect(plan.toCreate).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatchObject({ line: 2 });
    expect(plan.errors[0]?.message).toMatch(/já importad.*diferentes/i);
    expect(plan.summary.errors).toBe(1);
    expect(totalGrossCents(stored)).toBe(171096n);
  });

  it('erro fatal não cria nada; erros por linha acompanham o plano', () => {
    const fatal = planSalesImport(previewSalesCsv(''), []);
    expect(fatal.fatalError).toMatch(/vazio/i);
    expect(fatal.toCreate).toEqual([]);
    const mixed = planSalesImport(previewSalesCsv(`${H}\nA;02/11/2026;1,00;pix;\nB;xx;1,00;pix;`), []);
    expect(mixed.summary).toEqual({ created: 1, ignored: 0, errors: 1, grossCreatedCents: '100' });
  });

  it('duplicatas dentro do arquivo contam como ignoradas', () => {
    const plan = planSalesImport(previewSalesCsv([H, 'A;02/11/2026;1,00;pix;', 'A;02/11/2026;1,00;pix;'].join('\n')), []);
    expect(plan.summary).toEqual({ created: 1, ignored: 1, errors: 0, grossCreatedCents: '100' });
  });
});

describe('faturamento ≠ recebimento', () => {
  it('Sale não carrega data de recebimento nem valor líquido: venda não é dinheiro disponível', () => {
    const sale = previewSalesCsv(`${H}\nV-1;02/11/2026;100,00;pix;`).valid[0]?.sale as Sale;
    expect(Object.keys(sale).sort()).toEqual(
      ['category', 'externalId', 'grossCents', 'id', 'method', 'saleDate', 'saleKey'].sort(),
    );
  });

  it('faturamento por dia soma só vendas do dia, em BigInt, ordenado por data', () => {
    const sales = previewSalesCsv(FIXTURE).valid.map((v) => v.sale);
    const days = grossByDay(sales);
    expect(days).toEqual([
      { date: '2026-11-02', grossCents: 35050n, saleIds: [sales[0]?.id, sales[1]?.id] }, // 10000 + 25050
      { date: '2026-11-03', grossCents: 131456n, saleIds: [sales[2]?.id, sales[3]?.id] }, // 123456 + 8000
      { date: '2026-11-04', grossCents: 4590n, saleIds: [sales[4]?.id] },
    ]);
    expect(totalGrossCents([])).toBe(0n);
    expect(grossByDay([])).toEqual([]);
  });

  it('valores grandes não perdem precisão (acima de 2^53 centavos)', () => {
    const p = previewSalesCsv(`${H}\nBIG;02/11/2026;90.071.992.547.409,93;pix;`); // 9007199254740993 centavos > 2^53
    expect(p.invalid).toEqual([]);
    expect(p.valid[0]?.sale.grossCents).toBe('9007199254740993');
    expect(totalGrossCents([p.valid[0]!.sale, p.valid[0]!.sale])).toBe(18014398509481986n);
  });
});
