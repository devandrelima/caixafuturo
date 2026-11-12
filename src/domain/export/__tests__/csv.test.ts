import { describe, expect, it } from 'vitest';
import { applyFilter, EMPTY_FILTER } from '../../finance/filters';
import { project } from '../../finance/projection';
import { projectWeekly } from '../../finance/weekly';
import type { CashEntry, CashSettings } from '../../finance/types';
import { planImport, previewAccountsCsv } from '../../import/csv';
import {
  CSV_BOM,
  DAILY_HEADER,
  ENTRIES_HEADER,
  WEEKLY_HEADER,
  csvField,
  dailyToCsv,
  entriesToCsv,
  formatCentsDecimal,
  neutralizeFormula,
  weeklyToCsv,
} from '../csv';

/**
 * Leitor RFC 4180 INDEPENDENTE do gerador (separador `;`, linhas CRLF, aspas dobradas, CR/LF preservados
 * dentro de aspas). Não normaliza nada: o que sai é o que uma planilha leria.
 */
function readCsv(csv: string): string[][] {
  const text = csv.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ';') {
      record.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
    } else field += c;
  }
  expect(quoted, 'aspas não fechadas').toBe(false);
  expect(field === '' && record.length === 0, 'o arquivo termina em CRLF').toBe(true);
  return records;
}
const parse = readCsv;
const e = (id: string, over: Partial<CashEntry> = {}): CashEntry => ({
  id,
  direction: 'out',
  amountCents: '12345',
  dueDate: '2026-12-01',
  description: `Conta ${id}`,
  category: '',
  origin: 'manual',
  sourceKey: `manual:${id}`,
  state: 'scheduled',
  ...over,
});

describe('neutralizeFormula — injeção de fórmula (OWASP CSV Injection)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+55 11 99999', "'+55 11 99999"],
    ['-5% desconto', "'-5% desconto"],
    ['@SUM(A1:A9)', "'@SUM(A1:A9)"],
    ['\t=cmd', "'\t=cmd"],
    ['\r=cmd', "'\r=cmd"],
    ['  =cmd', "'  =cmd"], // espaços à esquerda não protegem
    [' =cmd', "' =cmd"], // espaço sem quebra também
    ['=HYPERLINK("http://x";"y")', "'=HYPERLINK(\"http://x\";\"y\")"],
  ])('prefixa apóstrofo em %j', (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it.each(['Aluguel', '', '5% desconto', 'a-b', 'a=b', 'x@y.com', '2026-12-01', "'=já escapado", 'Café – promoção'])('mantém texto legítimo %j', (input) => {
    expect(neutralizeFormula(input)).toBe(input);
  });
});

describe('csvField — escape', () => {
  it('aspas, ponto e vírgula, quebras de linha e CR envolvem o campo e dobram as aspas', () => {
    expect(csvField('simples')).toBe('simples');
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvField('linha1\nlinha2')).toBe('"linha1\nlinha2"');
    expect(csvField('a\rb')).toBe('"a\rb"');
    expect(csvField('vírgula, ok')).toBe('vírgula, ok'); // vírgula não é delimitador aqui
  });

  it('neutraliza E escapa: fórmula com aspas e ponto e vírgula', () => {
    expect(csvField('=HYPERLINK("x";"y")')).toBe('"\'=HYPERLINK(""x"";""y"")"');
  });
});

describe('formatCentsDecimal — dinheiro sem ambiguidade, sem float', () => {
  it.each([
    [123456n, '1234,56'],
    [5n, '0,05'],
    [0n, '0,00'],
    [100n, '1,00'],
    [-70000n, '-700,00'],
    [-1n, '-0,01'],
    [10n ** 20n + 7n, '1000000000000000000,07'],
  ])('%s → %s', (cents, text) => {
    expect(formatCentsDecimal(cents)).toBe(text);
  });
});

describe('CSV de lançamentos (formato do importador de contas)', () => {
  it('BOM UTF-8, separador ;, CRLF, cabeçalho fixo e valor decimal com vírgula (à mão)', () => {
    const { csv, rowCount } = entriesToCsv([e('a', { amountCents: '150000', category: 'Fixas', description: 'Aluguel', dueDate: '2026-12-31' }), e('b', { direction: 'in', amountCents: '50', description: 'Troco' })]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(ENTRIES_HEADER).toEqual(['tipo', 'descricao', 'valor', 'vencimento', 'categoria', 'identificador_externo', 'referencia_venda']);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('tipo;descricao;valor;vencimento;categoria;identificador_externo;referencia_venda');
    expect(lines[1]).toBe('pagar;Aluguel;1500,00;2026-12-31;Fixas;manual:a;');
    expect(lines[2]).toBe('receber;Troco;0,50;2026-12-01;;manual:b;');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(rowCount).toBe(2);
  });

  it('só exporta AGENDADOS (liquidado não entra) e informa quantos ficaram de fora', () => {
    const out = entriesToCsv([e('a'), e('b', { state: 'settled', settledAt: '2026-12-01' }), e('c')]);
    expect(out.rowCount).toBe(2);
    expect(out.skippedSettled).toBe(1);
    expect(parse(out.csv).slice(1).map((r) => r[1])).toEqual(['Conta a', 'Conta c']);
  });

  it('identificador externo: csv:external volta ao id original; csv:hash vai vazio; demais levam a chave de origem; referência de venda acompanha', () => {
    const { csv } = entriesToCsv([
      e('1', { origin: 'csv', sourceKey: 'csv:external:R-77', saleReference: 'V-9', direction: 'in' }),
      e('2', { origin: 'csv', sourceKey: 'csv:hash:abc123' }),
      e('3', { origin: 'recurring', sourceKey: 'rec:r1:2026-12-01' }),
    ]);
    const rows = parse(csv).slice(1);
    expect(rows.map((r) => [r[5], r[6]])).toEqual([
      ['R-77', 'V-9'],
      ['', ''],
      ['rec:r1:2026-12-01', ''],
    ]);
  });

  it('a descrição com fórmula é neutralizada; "-5% desconto" continua legível; texto livre com ; " e quebra faz a volta íntegra', () => {
    const tricky = ['=1+1', '+cmd', '-5% desconto', '@x', 'a;b', 'diz "oi"', 'duas\nlinhas', '\t=x'];
    const { csv } = entriesToCsv(tricky.map((d, i) => e(`t${i}`, { description: d, category: d })));
    const rows = parse(csv).slice(1);
    expect(rows).toHaveLength(tricky.length);
    rows.forEach((row, i) => {
      expect(row).toHaveLength(7); // nenhuma célula quebrou o número de colunas
      expect(row[1]).toBe(neutralizeFormula(tricky[i] as string));
      expect(row[4]).toBe(neutralizeFormula(tricky[i] as string));
      expect(/^[\s ]*[=+\-@\t\r]/.test(row[1] as string)).toBe(false); // nenhuma célula de texto inicia fórmula
    });
    expect(rows[2]?.[1]).toBe("'-5% desconto");
  });

  it('propriedade (PRNG determinístico): 300 textos adversariais → nunca iniciam fórmula, nunca quebram colunas/linhas, voltam iguais ao neutralizado', () => {
    let seed = 4242;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const alphabet = ['=', '+', '-', '@', '\t', '\r', '\n', ' ', ';', '"', "'", 'a', 'Z', '1', ',', 'ç', ' '];
    const texts: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      const len = next(12);
      texts.push(Array.from({ length: len }, () => alphabet[next(alphabet.length)] as string).join(''));
    }
    // descrição obrigatória no importador, mas o GERADOR deve se comportar bem com qualquer texto
    const { csv } = entriesToCsv(texts.map((t, i) => e(`p${i}`, { description: t, category: t })));
    const raw = readCsv(csv);
    expect(raw).toHaveLength(texts.length + 1);
    raw.slice(1).forEach((fields, i) => {
      expect(fields).toHaveLength(7);
      expect(fields[1]).toBe(neutralizeFormula(texts[i] as string));
      expect(fields[4]).toBe(neutralizeFormula(texts[i] as string));
      expect(/^[\s\u00a0]*[=+\-@\t\r]/.test(fields[1] as string), JSON.stringify(texts[i])).toBe(false);
    });
  });

  it('CSV exportado corresponde ao FILTRO: só as linhas do período/categoria entram', () => {
    const list = [e('a', { dueDate: '2026-12-01', category: 'X' }), e('b', { dueDate: '2026-12-05', category: 'Y' }), e('c', { dueDate: '2026-12-10', category: 'X' }), e('d', { dueDate: '2027-01-01', category: 'X' })];
    const filtered = applyFilter(list, { ...EMPTY_FILTER, from: '2026-12-02', to: '2026-12-31', category: 'X' });
    const { csv, rowCount } = entriesToCsv(filtered);
    expect(rowCount).toBe(1);
    expect(parse(csv).slice(1).map((r) => r[1])).toEqual(['Conta c']);
    expect(csv).not.toContain('Conta a');
    expect(csv).not.toContain('Conta d');
  });

  it('lista vazia gera só o cabeçalho (sem linhas)', () => {
    const out = entriesToCsv([]);
    expect(out.rowCount).toBe(0);
    expect(out.csv).toBe(`${CSV_BOM}${ENTRIES_HEADER.join(';')}\r\n`);
  });
});

describe('ida e volta com o IMPORTADOR de contas existente (ADR-0008 D12)', () => {
  const settings: CashSettings = { baseDate: '2026-11-30', openingBalanceCents: '500000', minimumBalanceCents: '10000' };
  const csvOrigin = (id: string, desc: string, cents: string, date: string, dir: 'in' | 'out' = 'out'): CashEntry =>
    e(id, { origin: 'csv', sourceKey: `csv:external:${id}`, description: desc, amountCents: cents, dueDate: date, direction: dir });

  it('lançamentos de origem csv (id externo): o arquivo é aceito SEM erro e reimportar NÃO duplica nem muda o saldo', () => {
    const stored = [csvOrigin('F-1', 'Fornecedor', '120050', '2026-12-03'), csvOrigin('F-2', 'Cliente ABC', '300000', '2026-12-10', 'in')];
    const { csv } = entriesToCsv(stored);
    const preview = previewAccountsCsv(csv);
    expect(preview.fatalError).toBeNull();
    expect(preview.invalid).toEqual([]);
    expect(preview.valid).toHaveLength(2);
    const plan = planImport(preview, stored.map((s) => s.sourceKey));
    expect(plan.summary).toEqual({ created: 0, ignored: 2, errors: 0 });
    // mesmo valor/data/descrição na volta
    expect(preview.valid.map((v) => [v.entry.amountCents, v.entry.dueDate, v.entry.description, v.entry.direction])).toEqual([
      ['120050', '2026-12-03', 'Fornecedor', 'out'],
      ['300000', '2026-12-10', 'Cliente ABC', 'in'],
    ]);
    expect(project(settings, [...stored, ...plan.toCreate])).toEqual(project(settings, stored));
  });

  it('csv sem id externo (chave por hash): reimportar também não duplica quando a descrição não precisa de neutralização', () => {
    // importa uma vez para obter a chave real do importador
    const first = previewAccountsCsv('tipo;descricao;valor;vencimento\npagar;Luz;230,10;03/12/2026');
    const stored = first.valid.map((v) => v.entry);
    expect(stored[0]?.sourceKey).toMatch(/^csv:hash:/);
    const { csv } = entriesToCsv(stored);
    const plan = planImport(previewAccountsCsv(csv), stored.map((s) => s.sourceKey));
    expect(plan.summary).toEqual({ created: 0, ignored: 1, errors: 0 });
  });

  it('LIMITAÇÃO real: lançamento manual/recorrente reimportado NO MESMO banco vira um lançamento novo (chave diferente) — documentado no ADR-0008 D12', () => {
    const stored = [e('m1', { description: 'Aluguel', amountCents: '150000' }), e('r1', { origin: 'recurring', sourceKey: 'rec:r:2026-12-01', description: 'Seguro' })];
    const { csv } = entriesToCsv(stored);
    const preview = previewAccountsCsv(csv);
    expect(preview.invalid).toEqual([]); // o arquivo é aceito
    const plan = planImport(preview, stored.map((s) => s.sourceKey));
    expect(plan.summary.created).toBe(2); // mas não reconhece os originais
    // a 2ª reimportação do MESMO arquivo, já no banco, não duplica de novo
    const again = planImport(preview, [...stored.map((s) => s.sourceKey), ...plan.toCreate.map((c) => c.sourceKey)]);
    expect(again.summary.created).toBe(0);
  });

  it('LIMITAÇÃO real: descrição neutralizada ("-5% desconto") volta com o apóstrofo e, sem id externo, vira outro lançamento', () => {
    const first = previewAccountsCsv('tipo;descricao;valor;vencimento\npagar;"-5% desconto";10,00;03/12/2026');
    const stored = first.valid.map((v) => v.entry);
    expect(stored[0]?.description).toBe('-5% desconto');
    const { csv } = entriesToCsv(stored);
    const back = previewAccountsCsv(csv);
    expect(back.valid[0]?.entry.description).toBe("'-5% desconto");
    expect(planImport(back, stored.map((s) => s.sourceKey)).summary.created).toBe(1);
  });
});

describe('CSV da projeção diária e semanal (leitura/análise, não reimportável)', () => {
  const settings: CashSettings = { baseDate: '2026-11-12', openingBalanceCents: '500000', minimumBalanceCents: '100000' };
  const entries = [e('a', { amountCents: '30000', dueDate: '2026-11-13' }), e('b', { direction: 'in', amountCents: '100000', dueDate: '2026-11-14' }), e('g', { amountCents: '700000', dueDate: '2026-12-31' }), e('h', { direction: 'in', amountCents: '800000', dueDate: '2027-01-01' })];

  it('semanal: cabeçalho fixo, 13 linhas, valores em reais com vírgula e em centavos, pior dia e risco (à mão)', () => {
    const { weekly } = projectWeekly(settings, entries);
    const csv = weeklyToCsv(weekly.weeks);
    expect(WEEKLY_HEADER).toEqual(['semana', 'inicio', 'fim', 'dias', 'parcial', 'abertura', 'abertura_centavos', 'entradas', 'entradas_centavos', 'saidas', 'saidas_centavos', 'saldo_final', 'saldo_final_centavos', 'pior_saldo', 'pior_saldo_centavos', 'pior_dia', 'risco', 'ids_lancamentos']);
    const rows = parse(csv);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(rows[0]).toEqual([...WEEKLY_HEADER]);
    expect(rows).toHaveLength(14);
    // semana 1 (13–15/11, parcial): 5.000,00 + 1.000,00 − 300,00 = 5.700,00; pior dia 13/11 = 4.700,00
    expect(rows[1]).toEqual(['1', '2026-11-13', '2026-11-15', '3', 'sim', '5000,00', '500000', '1000,00', '100000', '300,00', '30000', '5700,00', '570000', '4700,00', '470000', '2026-11-13', 'ok', 'a | b']);
    // semana 8 (28/12–03/01): abertura 5.700,00 − 7.000,00 em 31/12 = −1.300,00 (pior dia) e fecha em 6.700,00
    expect(rows[8]).toEqual(['8', '2026-12-28', '2027-01-03', '7', 'não', '5700,00', '570000', '8000,00', '800000', '7000,00', '700000', '6700,00', '670000', '-1300,00', '-130000', '2026-12-31', 'negative', 'g | h']);
  });

  it('diário: 30 linhas do mesmo motor; fechamento = abertura + entradas − saídas em centavos', () => {
    const result = project(settings, entries);
    const rows = parse(dailyToCsv(result.points));
    expect(rows[0]).toEqual([...DAILY_HEADER]);
    expect(rows).toHaveLength(31);
    expect(rows[1]).toEqual(['2026-11-13', '5000,00', '500000', '0,00', '0', '300,00', '30000', '4700,00', '470000', 'ok', '0,00', '0', 'a']);
    for (const r of rows.slice(1)) {
      expect(BigInt(r[2] as string) + BigInt(r[4] as string) - BigInt(r[6] as string)).toBe(BigInt(r[8] as string));
    }
  });

  it('dois lançamentos no mesmo dia: ids separados por " | " no diário e a conta fecha (à mão: 5.000,00 − 300,00 − 200,00 = 4.500,00)', () => {
    const two = [e('x1', { amountCents: '30000', dueDate: '2026-11-13' }), e('x2', { amountCents: '20000', dueDate: '2026-11-13' })];
    const rows = parse(dailyToCsv(project(settings, two).points));
    expect(rows[1]?.[12]).toBe('x1 | x2');
    expect(rows[1]?.slice(5, 9)).toEqual(['500,00', '50000', '4500,00', '450000']);
  });

  it('coluna numérica negativa é NÚMERO (não texto): fica sem apóstrofo e as colunas de texto livre ficam neutralizadas', () => {
    const { weekly } = projectWeekly(settings, [e('=cmd', { amountCents: '900000', dueDate: '2026-11-13' })]);
    const rows = parse(weeklyToCsv(weekly.weeks));
    expect(rows[1]?.[11]).toBe('-4000,00'); // 5.000,00 − 9.000,00: número legítimo
    expect(rows[1]?.[17]).toBe("'=cmd"); // id com "=" no início: texto, neutralizado
  });

  it('semanas vazias geram só o cabeçalho', () => {
    expect(weeklyToCsv([])).toBe(`${CSV_BOM}${WEEKLY_HEADER.join(';')}\r\n`);
    expect(dailyToCsv([])).toBe(`${CSV_BOM}${DAILY_HEADER.join(';')}\r\n`);
  });
});
