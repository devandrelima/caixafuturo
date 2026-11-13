import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { createAdvancedDemoAdjustments, createAdvancedDemoBase } from '../../demo/advancedDemo';
import { HIRING_PREMISE } from '../../domain/scenarios/hiring';
import type { Adjustment } from '../../domain/scenarios/types';
import { ScenarioPanel } from '../ScenarioPanel';

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
type User = ReturnType<typeof userEvent.setup>;

function Harness({ initial = [] as Adjustment[] }: { initial?: Adjustment[] }) {
  const [adjustments, setAdjustments] = useState<Adjustment[]>(initial);
  const base = useState(() => createAdvancedDemoBase())[0];
  return <ScenarioPanel snapshot={base} adjustments={adjustments} onChange={setAdjustments} />;
}

const table = () => screen.getByRole('table', { name: /Saldo por dia/ });
const cell = (date: string, label: string) => table().querySelector(`[data-date="${date}"] [data-label="${label}"]`) as HTMLElement;
const setDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const form = (name: string) => screen.getByRole('form', { name });
const created = () => screen.getByRole('table', { name: 'Lançamentos hipotéticos criados' });

async function addInstallmentPurchase(user: User) {
  await user.type(screen.getByLabelText('O que será comprado'), 'Forno combinado');
  await user.type(screen.getByLabelText('Valor da compra (R$)'), '6.000,00');
  await user.selectOptions(screen.getByLabelText('Forma de pagamento'), 'installments');
  setDate('Data da primeira parcela', '2026-11-25');
  await user.type(screen.getByLabelText('Número de parcelas'), '3');
  await user.type(screen.getByLabelText('Juros ao mês (%)'), '2');
}

describe('Decisões avançadas: painéis dentro do Simulador', () => {
  it('há quatro painéis recolhíveis, rotulados como hipótese, sem menu novo e sem texto de execução real', () => {
    render(<Harness />);
    const region = screen.getByRole('region', { name: 'Decisões avançadas (hipóteses)' });
    const titles = [...region.querySelectorAll('details > summary')].map((s) => s.querySelector('span')?.textContent);
    expect(titles).toEqual(['Compra de equipamento', 'Contratação', 'Vencimento de fornecedor', 'Antecipação de recebimento']);
    expect(region).toHaveTextContent('Custos e datas aparecem em texto antes de qualquer gráfico ou tabela');
    expect(region).toHaveTextContent('nada é pago, contratado, renegociado ou solicitado');
    expect(region.querySelectorAll('details.cf-hypo')).toHaveLength(4);
    const buttons = screen.getAllByRole('button').map((b) => `${b.textContent} ${b.getAttribute('aria-label') ?? ''}`);
    expect(buttons.join(' | ')).not.toMatch(/executar|transferir|antecipar|contratar|pagar|confirmar|aplicar|comprar/i);
    expect(buttons.join(' | ')).toContain('Adicionar hipótese de compra');
    expect(buttons.join(' | ')).toContain('Adicionar hipótese de contratação');
    expect(buttons.join(' | ')).toContain('Adicionar hipótese de novo vencimento');
    expect(buttons.join(' | ')).toContain('Simular antecipação');
  });

  it('a premissa trabalhista é permanente na contratação', () => {
    render(<Harness />);
    expect(within(form('Hipótese de contratação')).getByText(HIRING_PREMISE)).toBeInTheDocument();
  });
});

describe('Compra de equipamento (F23)', () => {
  it('mostra principal, encargos e total em TEXTO antes de adicionar; depois cria as parcelas só na Alternativa', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await addInstallmentPurchase(user);
    // prévia em texto, ainda sem hipótese ativa: R$ 6.000 em 3× a 2%: 2.080,53 + 2.080,53 + 2.080,52
    expect(form('Hipótese de compra de equipamento')).toHaveTextContent('principal R$ 6.000,00 + encargos R$ 241,58 = total R$ 6.241,58');
    expect(form('Hipótese de compra de equipamento')).toHaveTextContent('3 parcelas, de 25/11/2026 a 25/01/2027, de R$ 2.080,53');
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
    expect(screen.getByText('Nenhuma hipótese ativa')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de compra' }));
    expect(screen.getByRole('list', { name: 'Hipóteses ativas' })).toHaveTextContent('Hipótese de compra: "Forno combinado" (R$ 6.000,00) em 3 parcelas a partir de 25/11/2026, juros de 2% ao mês');
    // lançamentos criados em texto/tabela, rotulados como hipótese
    const rows = within(created()).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('25/11/2026'),
      expect.stringContaining('25/12/2026'),
      expect.stringContaining('25/01/2027'),
    ]);
    expect(created()).toHaveTextContent('-R$ 2.080,53');
    expect(created()).toHaveTextContent('-R$ 2.080,52');
    expect(within(created()).getAllByText('Hipótese')).toHaveLength(3);
    // saldo à mão: base 24/11 = R$ 3.180,30 → 25/11 −2.080,53 = R$ 1.099,77 (e o Original não muda)
    expect(cell('2026-11-24', 'Alternativa (hipótese)')).toHaveTextContent('R$ 3.180,30');
    expect(cell('2026-11-25', 'Alternativa (hipótese)')).toHaveTextContent('R$ 1.099,77');
    expect(cell('2026-11-25', 'Original')).toHaveTextContent('R$ 3.180,30');
    expect(cell('2026-11-25', 'Diferença')).toHaveTextContent('-R$ 2.080,53');
  });

  it('valida: descrição, valor, data, parcelas (2 a 60) e juros acima do máximo; nada é adicionado', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Forma de pagamento'), 'installments');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de compra' }));
    const f = form('Hipótese de compra de equipamento');
    expect(f).toHaveTextContent('Diga o que está sendo comprado.');
    expect(f).toHaveTextContent('Valor obrigatório.');
    expect(f).toHaveTextContent('Informe a data da primeira parcela.');
    expect(f).toHaveTextContent('Informe de 2 a 60 parcelas.');
    await user.type(screen.getByLabelText('Juros ao mês (%)'), '25');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de compra' }));
    expect(f).toHaveTextContent('O percentual máximo é 20%.');
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
  });

  it('o número de parcelas só vale de 2 a 60 (1 e 61 são recusados na própria tela, 60 passa)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await addInstallmentPurchase(user);
    const count = screen.getByLabelText('Número de parcelas');
    for (const bad of ['1', '61', '0', '999']) {
      await user.clear(count);
      await user.type(count, bad);
      await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de compra' }));
      expect(form('Hipótese de compra de equipamento'), bad).toHaveTextContent('Informe de 2 a 60 parcelas.');
      expect(screen.queryByRole('list', { name: 'Hipóteses ativas' }), bad).toBeNull();
    }
    await user.clear(count);
    await user.type(count, '60');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de compra' }));
    expect(screen.getByRole('list', { name: 'Hipóteses ativas' })).toHaveTextContent('em 60 parcelas');
  });

  it('parcelas depois do horizonte (90 dias, até 09/02/2027) ganham o selo "Fora do horizonte"; as de dentro, não', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await addInstallmentPurchase(user);
    setDate('Data da primeira parcela', '2027-01-25'); // 25/01 (dentro) · 25/02 e 25/03 (fora)
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de compra' }));
    const rows = within(created()).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent?.includes('Fora do horizonte'))).toEqual([false, true, true]);
  });

  it('à vista: sem campos de parcela; adiada: encargo único informado entra no total', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText('Número de parcelas')).toBeNull();
    await user.type(screen.getByLabelText('O que será comprado'), 'Câmara fria');
    await user.type(screen.getByLabelText('Valor da compra (R$)'), '5.000,00');
    await user.selectOptions(screen.getByLabelText('Forma de pagamento'), 'deferred');
    setDate('Data do pagamento', '2026-12-05');
    await user.type(screen.getByLabelText('Encargo único (%)'), '2');
    expect(form('Hipótese de compra de equipamento')).toHaveTextContent('principal R$ 5.000,00 + encargos R$ 100,00 = total R$ 5.100,00; 1 pagamento de R$ 5.100,00 em 05/12/2026');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de compra' }));
    expect(cell('2026-12-05', 'Diferença')).toHaveTextContent('-R$ 5.100,00');
  });
});

describe('Contratação (F24)', () => {
  async function fillHiring(user: User, { charges = '60', fixed = '200,00' } = {}) {
    await user.type(screen.getByLabelText('Função (cargo)'), 'Auxiliar de cozinha');
    await user.type(screen.getByLabelText('Custo mensal informado (R$)'), '1.800,00');
    if (charges) await user.type(screen.getByLabelText('Encargos informados (%) — opcional'), charges);
    if (fixed) await user.type(screen.getByLabelText('Outros custos mensais fixos (R$) — opcional'), fixed);
    await user.type(screen.getByLabelText('Dia do pagamento (1 a 31)'), '5');
    setDate('Data inicial', '2026-12-01');
  }

  it('custo mensal em texto antes; custos só aparecem depois da data inicial (05/12), nunca antes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await fillHiring(user);
    expect(form('Hipótese de contratação')).toHaveTextContent('R$ 1.800,00 + encargos R$ 1.080,00 + outros custos R$ 200,00 = R$ 3.080,00 por mês, pago todo dia 5 a partir de 01/12/2026. Nada é contratado.');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de contratação' }));
    expect(cell('2026-12-04', 'Diferença')).toHaveTextContent('R$ 0,00');
    expect(cell('2026-12-05', 'Diferença')).toHaveTextContent('-R$ 3.080,00');
    expect(screen.queryByText(/hipótese incompleta — não foram informados/)).toBeNull(); // o texto de ajuda do campo também diz "hipótese incompleta"; o ALERTA não aparece
    expect(screen.getAllByText(HIRING_PREMISE.slice(0, 40), { exact: false }).length).toBeGreaterThan(1); // no painel e nas premissas
  });

  it('encargos e custos fixos em branco: a hipótese é sinalizada como incompleta, na prévia e no alerta', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await fillHiring(user, { charges: '', fixed: '' });
    expect(form('Hipótese de contratação')).toHaveTextContent('Hipótese incompleta: faltam encargos e outros custos fixos.');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de contratação' }));
    expect(screen.getByText('Atenção nesta hipótese').parentElement).toHaveTextContent(/hipótese incompleta — não foram informados: encargos \(%\) e outros custos mensais fixos/);
  });

  it('valida campos obrigatórios e a data final antes da inicial', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de contratação' }));
    const f = form('Hipótese de contratação');
    for (const text of ['Diga a função ou o cargo (hipotético).', 'Valor obrigatório.', 'Informe o dia do pagamento, de 1 a 31.', 'Informe a data inicial.']) expect(f).toHaveTextContent(text);
    setDate('Data inicial', '2026-12-10');
    setDate('Data final — opcional', '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de contratação' }));
    expect(f).toHaveTextContent('A data final não pode ser antes da data inicial.');
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
  });
});

describe('Vencimento de fornecedor (F25)', () => {
  it('só a data muda: trilha "de → para" em texto, valor igual, saldo à mão', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Conta a pagar'), 'cen-despesa-02');
    setDate('Nova data de vencimento', '2026-11-24');
    expect(form('Hipótese de novo vencimento')).toHaveTextContent('de 17/11/2026 para 24/11/2026; o valor R$ 1.500,00 não muda. Nada é renegociado nem comunicado ao fornecedor.');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de novo vencimento' }));
    expect(screen.getByRole('list', { name: 'Mudanças em lançamentos existentes' })).toHaveTextContent('Aluguel fictício: data de 17/11/2026 para 24/11/2026');
    expect(screen.queryByRole('table', { name: 'Lançamentos hipotéticos criados' })).toBeNull();
    // base 17/11 = R$ 2.060,10 → sem o aluguel de R$ 1.500 fica R$ 3.560,10; em 24/11 a saída chega e volta ao da base
    expect(cell('2026-11-17', 'Alternativa (hipótese)')).toHaveTextContent('R$ 3.560,10');
    expect(cell('2026-11-17', 'Diferença')).toHaveTextContent('+R$ 1.500,00');
    expect(cell('2026-11-24', 'Diferença')).toHaveTextContent('R$ 0,00');
  });

  it('valida a escolha e recusa a mesma data', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de novo vencimento' }));
    expect(form('Hipótese de novo vencimento')).toHaveTextContent('Escolha a conta a pagar.');
    expect(form('Hipótese de novo vencimento')).toHaveTextContent('Informe a nova data de vencimento.');
    await user.selectOptions(screen.getByLabelText('Conta a pagar'), 'cen-despesa-02');
    setDate('Nova data de vencimento', '2026-11-17');
    await user.click(screen.getByRole('button', { name: 'Adicionar hipótese de novo vencimento' }));
    expect(form('Hipótese de novo vencimento')).toHaveTextContent('A nova data é igual à atual: escolha outra.');
  });
});

describe('Antecipação de recebíveis (F26)', () => {
  async function fillAdvance(user: User, date = '2026-11-13', rate = '2') {
    await user.selectOptions(screen.getByLabelText('Recebimento a antecipar'), 'cen-rcv-02');
    setDate('Data da antecipação', date);
    await user.type(screen.getByLabelText('Taxa informada ao mês (%)'), rate);
  }

  it('mostra custo e valor líquido em texto antes; o futuro SAI e o líquido ENTRA (sem duplicar)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await fillAdvance(user);
    // R$ 1.920,20 de 18/11 antecipados 5 dias a 2% a.m.: custo R$ 6,40, líquido R$ 1.913,80
    expect(form('Hipótese de antecipação de recebimento')).toHaveTextContent('R$ 1.920,20 previstos para 18/11/2026 viram R$ 1.913,80 líquidos em 13/11/2026 (5 dias antes, taxa informada de 2% ao mês): custo R$ 6,40.');
    expect(form('Hipótese de antecipação de recebimento')).toHaveTextContent('nunca os dois');
    await user.click(screen.getByRole('button', { name: 'Simular antecipação' }));
    expect(created()).toHaveTextContent('+R$ 1.913,80');
    expect(screen.getByRole('list', { name: 'Mudanças em lançamentos existentes' })).toHaveTextContent('retirado da data original (18/11/2026)');
    // saldos à mão: 13/11 base R$ 800,00 → +1.913,80 = R$ 2.713,80; do vencimento (18/11) em diante a diferença é só o custo
    expect(cell('2026-11-13', 'Alternativa (hipótese)')).toHaveTextContent('R$ 2.713,80');
    expect(cell('2026-11-17', 'Diferença')).toHaveTextContent('+R$ 1.913,80');
    expect(cell('2026-11-18', 'Diferença')).toHaveTextContent('-R$ 6,40');
    expect(cell('2026-12-10', 'Diferença')).toHaveTextContent('-R$ 6,40');
  });

  it('data fora do intervalo e taxa vazia ou acima do máximo são recusadas, sem adicionar nada', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Simular antecipação' }));
    const f = form('Hipótese de antecipação de recebimento');
    expect(f).toHaveTextContent('Escolha o recebimento que seria antecipado.');
    expect(f).toHaveTextContent('Informe a data da antecipação.');
    expect(f).toHaveTextContent('Informe um percentual como 80 ou 80,5 (use vírgula).');
    await fillAdvance(user, '2026-11-18', '25');
    await user.click(screen.getByRole('button', { name: 'Simular antecipação' }));
    expect(f).toHaveTextContent('A data precisa ser depois de 11/11/2026 (data-base) e antes do vencimento (18/11/2026).');
    expect(f).toHaveTextContent('O percentual máximo é 20%.');
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
  });

  it('a taxa não tem valor padrão (campo vazio) e o exemplo é rotulado como ilustrativo, não como taxa de mercado', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Taxa informada ao mês (%)')).toHaveValue('');
    expect(screen.getByText(/Exemplo ilustrativo, que não é taxa de mercado/)).toBeInTheDocument();
  });

  it('atraso (S05) e antecipação no mesmo recebimento nunca somam: o primeiro vence e o conflito é avisado', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ id: 'h0', kind: 'delay_receipt', entryId: 'cen-rcv-02', days: 2 }]} />);
    await fillAdvance(user);
    await user.click(screen.getByRole('button', { name: 'Simular antecipação' }));
    const alert = screen.getByText('Atenção nesta hipótese').parentElement as HTMLElement;
    expect(alert).toHaveTextContent(/já alterado por/);
    expect(alert).toHaveTextContent(/não foi criado/);
    expect(screen.queryByRole('table', { name: 'Lançamentos hipotéticos criados' })).toBeNull();
    expect(cell('2026-11-18', 'Diferença')).toHaveTextContent('-R$ 1.920,20'); // só o atraso valeu
  });
});

describe('Comparação com as quatro decisões e o atraso da S05', () => {
  it('na mesma Alternativa: saldos conferem com o modelo independente; Original e base não mudam', () => {
    const base = createAdvancedDemoBase();
    const before = json(base);
    render(<Harness initial={createAdvancedDemoAdjustments()} />);
    expect(cell('2026-11-13', 'Alternativa (hipótese)')).toHaveTextContent('R$ 2.713,80');
    expect(cell('2026-11-25', 'Alternativa (hipótese)')).toHaveTextContent('R$ 1.093,37');
    expect(cell('2026-12-25', 'Alternativa (hipótese)')).toHaveTextContent('-R$ 267,16');
    expect(cell('2027-02-05', 'Diferença')).toHaveTextContent('-R$ 15.487,98');
    expect(cell('2026-11-25', 'Original')).toHaveTextContent('R$ 3.180,30');
    expect(screen.getByRole('list', { name: 'Hipóteses ativas' }).querySelectorAll('li')).toHaveLength(5);
    // os quatro tipos têm hipótese explícita na comparação (premissas em texto) e um selo de hipótese
    const text = screen.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' });
    for (const piece of ['Hipótese: compra de "Forno combinado"', 'Hipótese: contratação de "Auxiliar de cozinha"', 'Hipótese: o vencimento de "Aluguel fictício"', 'é antecipado para 13/11/2026', 'passa a cair em 17/11/2026']) {
      expect(text).toHaveTextContent(piece);
    }
    expect(json(base)).toBe(before);
  });

  it('o painel de premissas já vem ABERTO quando há hipótese (custos e datas visíveis sem clicar), e fechado sem hipótese', () => {
    const { unmount } = render(<Harness initial={createAdvancedDemoAdjustments()} />);
    expect(screen.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' }).querySelector('details')).toHaveAttribute('open');
    unmount();
    render(<Harness />);
    const premises = screen.getByText(/Premissas desta hipótese/).closest('details');
    expect(premises).not.toHaveAttribute('open');
  });

  it('o texto de custos e datas vem ANTES do resumo e da tabela no documento', () => {
    render(<Harness initial={createAdvancedDemoAdjustments()} />);
    const text = screen.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' });
    const summary = screen.getByRole('region', { name: 'Resumo do Original' });
    expect(text.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Remover tira só aquela hipótese; Voltar ao original remove todas e o Original segue idêntico', async () => {
    const user = userEvent.setup();
    render(<Harness initial={createAdvancedDemoAdjustments()} />);
    const originalBefore = [...table().querySelectorAll('tbody tr')].map((tr) => tr.querySelector('[data-label="Original"]')?.textContent);
    await user.click(screen.getByRole('button', { name: /Remover hipótese: Hipótese de antecipação/ }));
    expect(screen.getByRole('list', { name: 'Hipóteses ativas' }).querySelectorAll('li')).toHaveLength(4);
    expect(cell('2026-11-13', 'Diferença')).toHaveTextContent('R$ 0,00');
    await user.click(screen.getByRole('button', { name: 'Voltar ao original' }));
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Custos, datas e mudanças desta hipótese' })).toBeNull();
    expect(screen.getByText(/Você está vendo o Original, com todos os seus dados intactos/)).toBeInTheDocument();
    expect([...table().querySelectorAll('tbody tr')].map((tr) => tr.querySelector('[data-label="Original"]')?.textContent)).toEqual(originalBefore);
  });

  it('nenhum botão ou texto da Alternativa sugere executar pagamento, contratação, antecipação ou compra', () => {
    render(<Harness initial={createAdvancedDemoAdjustments()} />);
    const buttons = screen.getAllByRole('button').map((b) => `${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).join(' | ');
    expect(buttons).not.toMatch(/executar|transferir|antecipar|contratar|pagar|confirmar|aplicar|comprar/i);
    const region = screen.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' });
    expect(region.textContent).not.toMatch(/\b(pague agora|contrate agora|antecipe agora|confirme a compra)\b/i);
    expect(region).toHaveTextContent(/Nenhum pagamento é feito/);
    expect(region).toHaveTextContent(/Nada é contratado/);
    expect(region).toHaveTextContent(/nada foi solicitado ou contratado/);
    expect(region).toHaveTextContent(/Nada é renegociado, solicitado ou comunicado/);
  });
});
