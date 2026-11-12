import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { createSalesDemo } from '../../demo/salesDemo';
import { createRepository } from '../../storage/repository';
import type { Repository } from '../../storage/repository';

let repo: Repository;
beforeEach(() => {
  window.location.hash = '';
  repo = createRepository({ factory: new IDBFactory(), dbName: 'cf-sales-ui', newId: (() => { let n = 0; return () => `m-${(n += 1)}`; })() });
});

const SH = 'identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria';
const AH = 'tipo;descricao;valor;vencimento;categoria;identificador_externo;referencia_venda';
const salesFile = (rows: string[], name = 'vendas.csv') => new File([[SH, ...rows].join('\n')], name, { type: 'text/csv' });
const accountsFile = (rows: string[], name = 'contas.csv') => new File([[AH, ...rows].join('\n')], name, { type: 'text/csv' });
type User = ReturnType<typeof userEvent.setup>;

/** Dados próprios (não a demo): data-base 11/11/2026, saldo R$ 3.000,00, mínimo R$ 1.000,00, sem lançamentos. */
async function start(): Promise<User> {
  await repo.saveSettings({ baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' });
  const user = userEvent.setup();
  render(<App repository={repo} />);
  await screen.findByRole('heading', { level: 1, name: 'Visão geral' });
  return user;
}
const goTo = (user: User, name: string) => user.click(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('button', { name }));
const goSales = async (user: User) => {
  await goTo(user, 'Vendas e recebimentos');
  await screen.findByRole('heading', { level: 1, name: 'Vendas e recebimentos' });
};

async function importSales(user: User, rows: string[]) {
  await goSales(user);
  await user.upload(screen.getByTestId('sales-csv-input'), salesFile(rows));
  await user.click(await screen.findByRole('button', { name: /^importar \d+ venda/i }));
  await screen.findByText(/importação de vendas concluída/i);
}
async function importAccounts(user: User, rows: string[]) {
  await goTo(user, 'Movimentações');
  await screen.findByRole('heading', { level: 1, name: 'Movimentações' });
  await user.upload(screen.getByTestId('csv-input'), accountsFile(rows));
  await user.click(await screen.findByRole('button', { name: /^importar \d+ lançamento/i }));
  await screen.findByText(/importação concluída/i);
}
const row = (externalId: string) => screen.getByRole('table', { name: 'Recebimentos previstos líquidos' }).querySelector(`tr[data-sale="${externalId}"]`) as HTMLElement;
async function projectedBalance(user: User): Promise<string> {
  await goTo(user, 'Visão geral');
  const label = await screen.findByText(/^Saldo projetado em \d{2}\/\d{2}\/\d{4}$/);
  return label.parentElement!.querySelector('.cf-stat__value')!.textContent!;
}

describe('estrutura e estado vazio', () => {
  it('três áreas separadas e tituladas; sem vendas mostra orientação, não números inventados', async () => {
    const user = await start();
    await goSales(user);
    for (const name of ['Faturamento bruto', 'Recebimentos previstos líquidos', 'Saldo projetado']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText(/nenhuma venda importada/i)).toBeInTheDocument();
    expect(screen.getByText(/faturamento bruto não é dinheiro disponível/i)).toBeInTheDocument();
  });
});

describe('venda ≠ recebimento; taxa e prazo mudam data e valor do caixa', () => {
  it('importar venda não altera o saldo; mudar taxa/prazo muda a data e o valor do repasse e o saldo projetado', async () => {
    const user = await start();
    expect(await projectedBalance(user)).toBe('R$ 3.000,00');
    await importSales(user, ['V-1;12/11/2026;1.000,00;crédito;Salão']);
    // faturamento aparece; recebimento padrão: crédito 3,99% D+30 → líquido R$ 960,10 em 12/12/2026 (fora do horizonte)
    expect(screen.getByText('Faturamento bruto importado').parentElement).toHaveTextContent('R$ 1.000,00');
    expect(row('V-1')).toHaveTextContent('12/12/2026');
    expect(row('V-1')).toHaveTextContent('R$ 960,10');
    expect(await projectedBalance(user)).toBe('R$ 3.000,00'); // venda bruta não aumenta o saldo

    await goSales(user);
    await user.clear(screen.getByLabelText('Taxa de Crédito (%)'));
    await user.type(screen.getByLabelText('Taxa de Crédito (%)'), '2,50');
    await user.clear(screen.getByLabelText('Prazo de Crédito (dias)'));
    await user.type(screen.getByLabelText('Prazo de Crédito (dias)'), '10');
    await user.click(screen.getByRole('button', { name: 'Salvar regras' }));
    await waitFor(() => expect(row('V-1')).toHaveTextContent('22/11/2026'));
    expect(row('V-1')).toHaveTextContent('R$ 975,00'); // 100000 − 2,5% = 97500
    expect(await projectedBalance(user)).toBe('R$ 3.975,00'); // o caixa mudou, não só o rótulo
    expect((await repo.sales.getRules()).credit).toMatchObject({ feeBps: 250, lagDays: 10 });
  });

  it('regra inválida é recusada com mensagem e nada muda', async () => {
    const user = await start();
    await goSales(user);
    await user.clear(screen.getByLabelText('Taxa de Pix (%)'));
    await user.type(screen.getByLabelText('Taxa de Pix (%)'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Salvar regras' }));
    expect(await screen.findByText(/taxa de pix inválida/i)).toBeInTheDocument();
    expect((await repo.sales.getRules()).pix.feeBps).toBe(99);
  });
});

describe('repasses históricos', () => {
  it('repasses até a data-base ficam ocultos por padrão e podem ser mostrados', async () => {
    const user = await start();
    await importSales(user, ['OLD;05/11/2026;100,00;pix;', 'NEW;12/11/2026;100,00;pix;']);
    expect(row('NEW')).toBeTruthy();
    expect(row('OLD')).toBeNull();
    await user.click(screen.getByRole('button', { name: /mostrar 1 repasse\(s\) já no saldo inicial/i }));
    expect(row('OLD')).toHaveTextContent('Já no saldo inicial');
    expect(row('OLD').querySelector('[data-col="counts"]')).toHaveTextContent('Não');
  });
});

describe('importação de vendas', () => {
  it('prévia mostra erro por linha; reimportar o mesmo arquivo não duplica faturamento', async () => {
    const user = await start();
    await goSales(user);
    await user.upload(screen.getByTestId('sales-csv-input'), salesFile(['V-1;12/11/2026;100,00;pix;', ';12/11/2026;50,00;pix;', 'V-3;32/13/2026;5,00;pix;']));
    const preview = await screen.findByRole('region', { name: /prévia da importação de vendas/i });
    expect(within(preview).getByText(/1 a importar/)).toBeInTheDocument();
    expect(within(preview).getByText(/2 com erro/)).toBeInTheDocument();
    expect(within(preview).getByRole('table', { name: 'Linhas com erro' })).toHaveTextContent(/identificador da venda obrigatório/i);
    expect(await repo.sales.listSales()).toEqual([]); // nada gravado antes de confirmar
    await user.click(within(preview).getByRole('button', { name: /importar 1 venda/i }));
    await screen.findByText(/importação de vendas concluída: 1 criada/i);
    await user.upload(screen.getByTestId('sales-csv-input'), salesFile(['V-1;12/11/2026;100,00;pix;']));
    expect(await screen.findByText(/nada novo para importar/i)).toBeInTheDocument();
    expect(await repo.sales.listSales()).toHaveLength(1);
    expect(screen.getByText('Faturamento bruto importado').parentElement).toHaveTextContent('R$ 100,00');
  });

  it('mesma venda com valor diferente é conflito explícito, sem sobrescrever o faturamento', async () => {
    const user = await start();
    await importSales(user, ['V-1;12/11/2026;100,00;pix;']);
    await user.upload(screen.getByTestId('sales-csv-input'), salesFile(['V-1;12/11/2026;999,00;pix;']));
    const preview = await screen.findByRole('region', { name: /prévia da importação de vendas/i });
    expect(within(preview).getByRole('table', { name: 'Linhas com erro' })).toHaveTextContent(/já importada com dados diferentes/i);
    expect((await repo.sales.listSales())[0]?.grossCents).toBe('10000');
  });
});

describe('conciliação entre CSV de contas e CSV de vendas (PEND-S02-001)', () => {
  const SALE = ['V-1;12/11/2026;1.000,00;crédito;'];
  // regra de teste: crédito 2,5% D+10 → líquido R$ 975,00 em 22/11/2026
  async function setRules(user: User) {
    await goSales(user);
    await user.clear(screen.getByLabelText('Taxa de Crédito (%)'));
    await user.type(screen.getByLabelText('Taxa de Crédito (%)'), '2,50');
    await user.clear(screen.getByLabelText('Prazo de Crédito (dias)'));
    await user.type(screen.getByLabelText('Prazo de Crédito (dias)'), '10');
    await user.click(screen.getByRole('button', { name: 'Salvar regras' }));
    await waitFor(() => expect((screen.getByLabelText('Taxa de Crédito (%)') as HTMLInputElement).value).toBe('2,50'));
    await waitFor(async () => expect((await repo.sales.getRules()).credit.lagDays).toBe(10));
  }
  const WITH_REF = ['receber;Repasse crédito V-1;975,00;22/11/2026;;R-1;V-1'];

  it('contas→vendas e vendas→contas: mesmo caixa (R$ 3.975,00, nunca 4.950), mesma situação "Conciliado"', async () => {
    const a = await start();
    await setRules(a);
    await importAccounts(a, WITH_REF);
    await importSales(a, SALE);
    expect(row('V-1')).toHaveTextContent('Conciliado');
    expect(row('V-1').querySelector('[data-col="counts"]')).toHaveTextContent('Não'); // não entra no saldo: vale a conta importada
    expect(await projectedBalance(a)).toBe('R$ 3.975,00');
  });

  it('vendas→contas (ordem inversa) dá o mesmo resultado', async () => {
    const user = await start();
    await setRules(user);
    await importSales(user, SALE);
    expect(row('V-1')).toHaveTextContent('Derivado (estimativa)');
    expect(await projectedBalance(user)).toBe('R$ 3.975,00'); // só o derivado
    await importAccounts(user, WITH_REF);
    await goSales(user);
    expect(row('V-1')).toHaveTextContent('Conciliado');
    expect(await projectedBalance(user)).toBe('R$ 3.975,00'); // a conta substitui o derivado
  });

  it('reimportar contas e vendas não duplica nada', async () => {
    const user = await start();
    await setRules(user);
    await importAccounts(user, WITH_REF);
    await importSales(user, SALE);
    await user.upload(screen.getByTestId('sales-csv-input'), salesFile(SALE));
    expect(await screen.findByText(/nada novo para importar/i)).toBeInTheDocument();
    await goTo(user, 'Movimentações');
    await user.upload(screen.getByTestId('csv-input'), accountsFile(WITH_REF));
    expect(await screen.findByText(/nada novo para importar/i)).toBeInTheDocument();
    expect(await repo.listEntries()).toHaveLength(1);
    expect(await repo.sales.listSales()).toHaveLength(1);
    expect(await projectedBalance(user)).toBe('R$ 3.975,00');
  });

  it('conta sem referência com valor/data parecidos: PENDENTE, só a importada entra; o app avisa e exige decisão', async () => {
    const user = await start();
    await setRules(user);
    await importAccounts(user, ['receber;Repasse maquininha;975,00;22/11/2026;;R-1;']);
    await importSales(user, SALE);
    expect(row('V-1')).toHaveTextContent('Conciliação pendente');
    expect(screen.getByText(/1 recebível\(is\) com conciliação pendente/i)).toBeInTheDocument();
    expect(await projectedBalance(user)).toBe('R$ 3.975,00'); // não soma os dois
  });

  it('resolver como "mesmo repasse" concilia; como "independente" o derivado passa a contar (R$ 4.950,00)', async () => {
    const user = await start();
    await setRules(user);
    await importAccounts(user, ['receber;Repasse maquininha;975,00;22/11/2026;;R-1;']);
    await importSales(user, SALE);
    await user.click(screen.getByRole('button', { name: 'Vincular a V-1' }));
    await waitFor(() => expect(row('V-1')).toHaveTextContent('Conciliado'));
    expect(await projectedBalance(user)).toBe('R$ 3.975,00');
    expect(await repo.sales.listDecisions()).toHaveLength(1);

    // desfaz a decisão e escolhe o outro caminho
    await goSales(user);
    await user.click(screen.getByRole('button', { name: 'Desfazer decisão' }));
    await waitFor(() => expect(row('V-1')).toHaveTextContent('Conciliação pendente'));
    await user.click(screen.getByRole('button', { name: 'Conta independente de vendas' }));
    await waitFor(() => expect(row('V-1')).toHaveTextContent('Derivado (estimativa)'));
    expect(await projectedBalance(user)).toBe('R$ 4.950,00'); // decisão explícita: dois recebimentos distintos
  });

  it('lote (A|B) e parcelas são sinalizados como NÃO suportados, sem fingir conciliação', async () => {
    const user = await start();
    await setRules(user);
    await importAccounts(user, ['receber;Repasse lote;1.500,00;22/11/2026;;R-1;V-1|V-2']);
    await importSales(user, [...SALE, 'V-2;12/11/2026;500,00;pix;']);
    expect(row('V-1')).toHaveTextContent('Lote — não suportado');
    expect(row('V-2')).toHaveTextContent('Lote — não suportado');
    expect(screen.getByText(/parcelas e lotes não são suportados/i)).toBeInTheDocument();
  });
});

describe('previsão: média, série curta e hipótese manual', () => {
  it('série curta avisa e não inventa precisão; menos de 7 dias com venda não gera baseline', async () => {
    const user = await start();
    await importSales(user, ['A;10/11/2026;100,00;pix;', 'B;11/11/2026;100,00;pix;']);
    expect(screen.getByText(/histórico insuficiente: 2 dias com vendas/i)).toBeInTheDocument();
    expect(screen.queryByText(/Média histórica \(baseline não validado\)/)).not.toBeInTheDocument();
  });

  it('vendas fictícias da demonstração: média R$ 520,71/dia (R$ 14.580,00 / 28), sem aviso de série curta', async () => {
    const user = await start();
    await importSales(user, createSalesDemo().csv.split('\n').slice(1));
    expect(screen.getByText('Média diária de vendas').parentElement).toHaveTextContent('R$ 520,71');
    expect(screen.getByText('Faturamento bruto importado').parentElement).toHaveTextContent('R$ 14.580,00');
    expect(screen.getByText(/Média histórica \(baseline não validado\)/)).toBeInTheDocument();
    expect(screen.queryByText(/série curta/i)).not.toBeInTheDocument();
  });

  it('projeção manual: sempre rotulada como hipótese e fora do saldo projetado', async () => {
    const user = await start();
    await goSales(user);
    await user.type(screen.getByLabelText('Faturamento diário esperado (R$)'), '500,00');
    await user.clear(screen.getByLabelText('Dias'));
    await user.type(screen.getByLabelText('Dias'), '3');
    await user.click(screen.getByRole('button', { name: 'Projetar hipótese' }));
    const table = await screen.findByRole('table', { name: /hipótese manual de faturamento/i });
    expect(within(table).getAllByText(/hipótese manual — não é previsão validada/i).length).toBe(3);
    expect(within(table).getByText('12/11/2026')).toBeInTheDocument();
    expect(screen.getByText(/não entra no saldo projetado/i)).toBeInTheDocument();
    expect(await projectedBalance(user)).toBe('R$ 3.000,00');
  });

  it('valor negativo na hipótese manual é recusado', async () => {
    const user = await start();
    await goSales(user);
    await user.type(screen.getByLabelText('Faturamento diário esperado (R$)'), '-5,00');
    await user.click(screen.getByRole('button', { name: 'Projetar hipótese' }));
    expect(await screen.findByText(/valor não pode ser negativo/i)).toBeInTheDocument();
  });
});

describe('explicação de cada risco', () => {
  it('cada risco abre os lançamentos considerados, a origem e as hipóteses/exclusões', async () => {
    const user = userEvent.setup();
    render(<App repository={repo} />);
    await user.click(await screen.findByRole('button', { name: /explorar demonstração/i }));
    await screen.findByRole('heading', { level: 1, name: 'Visão geral' });
    const section = screen.getByRole('region', { name: /por que há risco/i });
    const first = within(section).getByText(/12\/11\/2026 · abaixo do mínimo/i);
    const negative = within(section).getByText(/14\/11\/2026 · saldo negativo/i);
    expect(first).toBeInTheDocument();
    await user.click(negative);
    const details = negative.closest('details')!;
    expect(details).toHaveTextContent('Aluguel fictício');
    expect(details).toHaveTextContent('Saldo de abertura');
    expect(details).toHaveTextContent('-R$ 700,00');
    expect(details).toHaveTextContent('Déficit para o mínimo: R$ 1.700,00');
    expect(section).toHaveTextContent(/nenhuma previsão manual ou hipótese entra neste saldo/i); // vale para todas as datas
  });

  it('repasse derivado aparece como estimativa e repasse pendente como "não incluído"', async () => {
    const user = await start();
    await importAccounts(user, ['pagar;Fornecedor;3.500,00;12/11/2026;;P-1;', 'receber;Repasse sem ref;100,00;13/11/2026;;R-1;']);
    await importSales(user, ['V-1;13/11/2026;100,00;pix;']);
    await goTo(user, 'Visão geral');
    const section = await screen.findByRole('region', { name: /por que há risco/i });
    await user.click(within(section).getByText(/12\/11\/2026 · /));
    expect(section).toHaveTextContent('Fornecedor');
    expect(section).toHaveTextContent(/não incluídos no saldo/i);
    expect(section).toHaveTextContent(/V-1.*conciliação pendente/i);
  });
});
