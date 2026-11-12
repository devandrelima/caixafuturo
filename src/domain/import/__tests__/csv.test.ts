import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_ROWS, planImport, planReferenceUpdates, previewAccountsCsv } from '../csv';

const H = 'tipo;descricao;valor;vencimento;categoria;identificador_externo';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('formato do arquivo', () => {
  it('lê CSV com ; e uma linha válida', () => {
    const p = previewAccountsCsv(`${H}\npagar;Fornecedor;2.500,00;12/11/2026;Insumos;F-1`);
    expect(p.fatalError).toBeNull();
    expect(p.totalRows).toBe(1);
    expect(p.invalid).toEqual([]);
    expect(p.valid).toHaveLength(1);
    expect(p.valid[0]?.line).toBe(2);
    expect(p.valid[0]?.entry).toMatchObject({
      direction: 'out',
      amountCents: '250000',
      dueDate: '2026-11-12',
      description: 'Fornecedor',
      category: 'Insumos',
      origin: 'csv',
      state: 'scheduled',
      sourceKey: 'csv:external:F-1',
    });
  });

  it('lê CSV com vírgula como separador', () => {
    const p = previewAccountsCsv('tipo,descricao,valor,vencimento\nreceber,Venda,"1.234,56",2026-11-13');
    expect(p.fatalError).toBeNull();
    expect(p.valid[0]?.entry).toMatchObject({ direction: 'in', amountCents: '123456', dueDate: '2026-11-13' });
  });

  it('remove BOM UTF-8 e aceita CRLF, LF e CR', () => {
    for (const nl of ['\r\n', '\n', '\r']) {
      const p = previewAccountsCsv(`﻿${H}${nl}pagar;A;1,00;2026-11-12;;${nl}receber;B;2,00;2026-11-13;;`);
      expect(p.fatalError).toBeNull();
      expect(p.valid.map((v) => v.line)).toEqual([2, 3]);
    }
  });

  it('suporta aspas: delimitador dentro do campo, aspas escapadas e quebra de linha', () => {
    const text = `${H}\npagar;"Fornecedor; Silva ""Ltda""";10,00;2026-11-12;"Insumos\ne bebidas";\nreceber;Venda;5,00;2026-11-13;;`;
    const p = previewAccountsCsv(text);
    expect(p.fatalError).toBeNull();
    expect(p.valid[0]?.entry.description).toBe('Fornecedor; Silva "Ltda"');
    expect(p.valid[0]?.entry.category).toBe('Insumos\ne bebidas');
    // a linha seguinte reporta a linha física correta (campo multilinha ocupa 2 linhas)
    expect(p.valid[1]?.line).toBe(4);
  });

  it('cabeçalho flexível: caixa, acentos, ordem e colunas extras; opcionais podem faltar', () => {
    const p = previewAccountsCsv('Valor;Vencimento;TIPO;Descrição;Observação\n10,00;12/11/2026;Pagar;Luz;qualquer');
    expect(p.fatalError).toBeNull();
    expect(p.valid[0]?.entry).toMatchObject({ description: 'Luz', amountCents: '1000', direction: 'out', category: '' });
  });

  it('ignora linhas em branco sem contá-las como erro', () => {
    const p = previewAccountsCsv(`${H}\n\npagar;A;1,00;2026-11-12;;\n\n   \n`);
    expect(p.totalRows).toBe(1);
    expect(p.invalid).toEqual([]);
  });

  it.each([
    ['arquivo vazio', ''],
    ['só espaços', '   \n  '],
    ['coluna obrigatória ausente', 'tipo;descricao;valor\npagar;A;1,00'],
    ['colunas repetidas', 'tipo;tipo;descricao;valor;vencimento\npagar;pagar;A;1,00;2026-11-12'],
    ['aspas não fechadas', `${H}\npagar;"Sem fim;1,00;2026-11-12;;`],
  ])('erro fatal: %s', (_n, text) => {
    const p = previewAccountsCsv(text);
    expect(p.fatalError).toEqual(expect.any(String));
    expect(p.valid).toEqual([]);
  });

  it('apenas cabeçalho não é erro, mas não tem linhas', () => {
    const p = previewAccountsCsv(H);
    expect(p.fatalError).toBeNull();
    expect(p.totalRows).toBe(0);
    expect(p.valid).toEqual([]);
  });

  it('limita o número de linhas', () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `pagar;C${i};1,00;2026-11-12;;K${i}`);
    const p = previewAccountsCsv([H, ...rows].join('\n'));
    expect(p.fatalError).toMatch(/limite/i);
    expect(p.valid).toEqual([]);
  });
});

describe('validação por linha', () => {
  const rows = [
    'pagar;Válida 1;10,00;2026-11-12;;',
    'pagar;;10,00;2026-11-12;;', // 3: sem descrição
    'pagar;Zero;0,00;2026-11-12;;', // 4
    'pagar;Negativa;-5,00;2026-11-12;;', // 5
    'pagar;Exp;1e3;2026-11-12;;', // 6
    'pagar;Ponto;1234.56;2026-11-12;;', // 7
    'pagar;Texto;abc;2026-11-12;;', // 8
    'pagar;Data;10,00;31/04/2026;;', // 9
    'pagar;Data2;10,00;2026-13-01;;', // 10
    'dividir;Tipo;10,00;2026-11-12;;', // 11
    'receber;Válida 2;R$ 1.234,56;14/11/2026;;', // 12
    'pagar;Valor vazio;;2026-11-12;;', // 13
    'pagar;Venc vazio;1,00;;;', // 14
    `pagar;${'x'.repeat(201)};1,00;2026-11-12;;`, // 15
  ];
  const p = previewAccountsCsv([H, ...rows].join('\n'));

  it('só linhas válidas entram no lote', () => {
    expect(p.valid.map((v) => v.line)).toEqual([2, 12]);
    expect(p.valid[1]?.entry.amountCents).toBe('123456');
  });

  it('cada erro informa a linha e o motivo', () => {
    expect(p.invalid.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15]);
    for (const e of p.invalid) expect(e.message.length).toBeGreaterThan(5);
    expect(p.invalid.find((e) => e.line === 3)?.message).toMatch(/descri/i);
    expect(p.invalid.find((e) => e.line === 4)?.message).toMatch(/valor/i);
    expect(p.invalid.find((e) => e.line === 9)?.message).toMatch(/vencimento|data/i);
    expect(p.invalid.find((e) => e.line === 11)?.message).toMatch(/tipo/i);
  });

  it('uma linha com vários problemas lista todos na mesma mensagem', () => {
    const q = previewAccountsCsv(`${H}\nxxx;;abc;99/99/9999;;`);
    expect(q.invalid).toHaveLength(1);
    expect(q.invalid[0]?.message).toMatch(/tipo/i);
    expect(q.invalid[0]?.message).toMatch(/descri/i);
    expect(q.invalid[0]?.message).toMatch(/valor/i);
    expect(q.invalid[0]?.message).toMatch(/vencimento/i);
  });

  it('total de linhas = válidas + duplicadas + inválidas', () => {
    expect(p.totalRows).toBe(rows.length);
    expect(p.valid.length + p.duplicates.length + p.invalid.length).toBe(p.totalRows);
  });
});

describe('chave idempotente e duplicatas', () => {
  it('sem identificador externo usa SHA-256 dos campos normalizados (prefixo csv:hash)', () => {
    const p = previewAccountsCsv(`${H}\npagar;Aluguel Fictício;2.000,00;14/11/2026;Fixas;`);
    const expected = sha(['out', '2026-11-14', '200000', 'aluguel fictício'].join('\u001f'));
    expect(p.valid[0]?.entry.sourceKey).toBe(`csv:hash:${expected}`);
  });

  it('normalização: caixa, espaços, formato de data e de valor não mudam a chave', () => {
    const variants = [
      'pagar;Aluguel Fictício;2.000,00;14/11/2026;;',
      'PAGAR;  aluguel   fictício ;R$ 2.000,00;2026-11-14;;',
      'Pagar;ALUGUEL FICTÍCIO;2000,00;14/11/2026;Qualquer;',
      'pagar;Aluguel Fictício;2000;2026-11-14;;',
    ];
    const keys = variants.map((v) => previewAccountsCsv(`${H}\n${v}`).valid[0]?.entry.sourceKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('valor, data, tipo ou descrição diferentes geram chaves diferentes', () => {
    const base = previewAccountsCsv(`${H}\npagar;Luz;100,00;2026-11-12;;`).valid[0]?.entry.sourceKey;
    for (const v of ['receber;Luz;100,00;2026-11-12;;', 'pagar;Luz;100,01;2026-11-12;;', 'pagar;Luz;100,00;2026-11-13;;', 'pagar;Gás;100,00;2026-11-12;;']) {
      expect(previewAccountsCsv(`${H}\n${v}`).valid[0]?.entry.sourceKey).not.toBe(base);
    }
  });

  it('linhas idênticas sem identificador são o mesmo lançamento: a segunda é duplicada', () => {
    const p = previewAccountsCsv(`${H}\npagar;Luz;100,00;2026-11-12;;\npagar;Luz;100,00;2026-11-12;;`);
    expect(p.valid).toHaveLength(1);
    expect(p.duplicates).toEqual([{ line: 3, duplicateOfLine: 2, sourceKey: p.valid[0]?.entry.sourceKey }]);
  });

  it('duplicatas legítimas exigem identificadores externos distintos', () => {
    const p = previewAccountsCsv(`${H}\npagar;Luz;100,00;2026-11-12;;A\npagar;Luz;100,00;2026-11-12;;B`);
    expect(p.valid).toHaveLength(2);
    expect(p.valid.map((v) => v.entry.sourceKey)).toEqual(['csv:external:A', 'csv:external:B']);
    expect(new Set(p.valid.map((v) => v.entry.id)).size).toBe(2);
  });

  it('mesmo identificador com os mesmos dados: duplicata ignorada', () => {
    const p = previewAccountsCsv(`${H}\npagar;Luz;100,00;2026-11-12;;A\npagar;Luz;100,00;2026-11-12;;A`);
    expect(p.valid).toHaveLength(1);
    expect(p.duplicates).toHaveLength(1);
  });

  it('mesmo identificador com dados diferentes é erro (não descarta dado em silêncio)', () => {
    const p = previewAccountsCsv(`${H}\npagar;Luz;100,00;2026-11-12;;A\npagar;Luz;999,00;2026-11-12;;A`);
    expect(p.valid).toHaveLength(1);
    expect(p.invalid).toHaveLength(1);
    expect(p.invalid[0]).toMatchObject({ line: 3 });
    expect(p.invalid[0]?.message).toMatch(/identificador/i);
  });

  it('ids de lançamento são determinísticos a partir da chave', () => {
    const a = previewAccountsCsv(`${H}\npagar;Luz;100,00;2026-11-12;;`).valid[0]?.entry.id;
    const b = previewAccountsCsv(`${H}\npagar;Luz;100,00;2026-11-12;;`).valid[0]?.entry.id;
    expect(a).toBe(b);
    expect(a).toMatch(/^csv_[0-9a-f]{20}$/);
  });
});

describe('planImport: importação repetida não duplica', () => {
  const text = `${H}\npagar;Luz;100,00;2026-11-12;;\nreceber;Venda;50,00;2026-11-13;;V1\nxxx;inválida;1,00;2026-11-13;;`;

  it('primeira importação cria as válidas; informa criadas/ignoradas/erros', () => {
    const plan = planImport(previewAccountsCsv(text), []);
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.alreadyImported).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.summary).toEqual({ created: 2, ignored: 0, errors: 1 });
  });

  it('segunda importação do mesmo arquivo não cria nada', () => {
    const first = planImport(previewAccountsCsv(text), []);
    const existing = first.toCreate.map((e) => e.sourceKey);
    const second = planImport(previewAccountsCsv(text), existing);
    expect(second.toCreate).toEqual([]);
    expect(second.alreadyImported).toHaveLength(2);
    expect(second.summary).toEqual({ created: 0, ignored: 2, errors: 1 });
  });

  it('arquivo parcialmente novo cria só o que falta', () => {
    const first = planImport(previewAccountsCsv(text), []);
    const grown = `${text}\npagar;Gás;70,00;2026-11-15;;`;
    const second = planImport(previewAccountsCsv(grown), first.toCreate.map((e) => e.sourceKey));
    expect(second.toCreate.map((e) => e.description)).toEqual(['Gás']);
    expect(second.summary).toMatchObject({ created: 1, ignored: 2 });
  });

  it('duplicatas dentro do arquivo contam como ignoradas', () => {
    const dup = `${H}\npagar;Luz;100,00;2026-11-12;;\npagar;Luz;100,00;2026-11-12;;`;
    const plan = planImport(previewAccountsCsv(dup), []);
    expect(plan.summary).toEqual({ created: 1, ignored: 1, errors: 0 });
  });

  it('erro fatal não cria nada e é propagado', () => {
    const plan = planImport(previewAccountsCsv(''), []);
    expect(plan.toCreate).toEqual([]);
    expect(plan.fatalError).toEqual(expect.any(String));
  });
});

describe('referencia_venda (ADR-0006)', () => {
  const HR = `${H};referencia_venda`;

  it('lê a referência em conta a receber e a guarda sem espaços; sem coluna ou vazia, o campo não existe', () => {
    const p = previewAccountsCsv(`${HR}\nreceber;Repasse;100,00;12/11/2026;;R-1; V-1 \nreceber;Outro;50,00;12/11/2026;;R-2;`);
    expect(p.invalid).toEqual([]);
    expect(p.valid[0]?.entry.saleReference).toBe('V-1');
    expect('saleReference' in (p.valid[1]?.entry ?? {})).toBe(false);
    const old = previewAccountsCsv(`${H}\nreceber;Repasse;100,00;12/11/2026;;R-1`);
    expect('saleReference' in (old.valid[0]?.entry ?? {})).toBe(false);
  });

  it('lote "A|B" é aceito como texto (a conciliação o sinaliza como não suportado)', () => {
    const p = previewAccountsCsv(`${HR}\nreceber;Lote;100,00;12/11/2026;;R-1;V-1|V-2`);
    expect(p.valid[0]?.entry.saleReference).toBe('V-1|V-2');
  });

  it('referência em conta a pagar ou longa demais é erro por linha', () => {
    const p = previewAccountsCsv(`${HR}\npagar;Fornecedor;100,00;12/11/2026;;R-1;V-1\nreceber;X;1,00;12/11/2026;;R-2;${'v'.repeat(101)}`);
    expect(p.valid).toEqual([]);
    expect(p.invalid.map((e) => e.line)).toEqual([2, 3]);
    expect(p.invalid[0]?.message).toMatch(/referencia_venda.*receber/i);
    expect(p.invalid[1]?.message).toMatch(/referência.*longa/i);
  });

  it('a referência não entra na chave idempotente: mesma conta, outra referência = mesma sourceKey', () => {
    const a = previewAccountsCsv(`${HR}\nreceber;Repasse;100,00;12/11/2026;;;V-1`).valid[0]?.entry;
    const b = previewAccountsCsv(`${HR}\nreceber;Repasse;100,00;12/11/2026;;;V-2`).valid[0]?.entry;
    expect(a?.sourceKey).toBe(b?.sourceKey);
    expect(a?.id).toBe(b?.id);
  });
});

describe('planReferenceUpdates — reimportar com referência nova enriquece, não duplica', () => {
  const HR = `${H};referencia_venda`;
  const stored = previewAccountsCsv(`${HR}\nreceber;Repasse;100,00;12/11/2026;;R-1;\nreceber;Outro;50,00;12/11/2026;;R-2;V-7`).valid.map((v) => v.entry);

  it('conta existente sem referência recebe a nova; com mesma ou sem referência no arquivo não muda; nunca remove', () => {
    const again = previewAccountsCsv(`${HR}\nreceber;Repasse;100,00;12/11/2026;;R-1;V-1\nreceber;Outro;50,00;12/11/2026;;R-2;`);
    expect(planImport(again, stored.map((e) => e.sourceKey)).summary).toEqual({ created: 0, ignored: 2, errors: 0 });
    expect(planReferenceUpdates(again, stored)).toEqual([{ entryId: stored[0]?.id, saleReference: 'V-1' }]);
    const same = previewAccountsCsv(`${HR}\nreceber;Outro;50,00;12/11/2026;;R-2;V-7`);
    expect(planReferenceUpdates(same, stored)).toEqual([]);
  });

  it('referência diferente da armazenada também é atualizada; contas inexistentes são ignoradas', () => {
    const other = previewAccountsCsv(`${HR}\nreceber;Outro;50,00;12/11/2026;;R-2;V-8\nreceber;Novo;9,00;12/11/2026;;R-3;V-9`);
    expect(planReferenceUpdates(other, stored)).toEqual([{ entryId: stored[1]?.id, saleReference: 'V-8' }]);
  });

  it('erro fatal não gera atualizações', () => {
    expect(planReferenceUpdates(previewAccountsCsv(''), stored)).toEqual([]);
  });
});
