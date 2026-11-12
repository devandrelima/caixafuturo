import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { createRepository, StorageError } from '../../storage/repository';
import type { Repository } from '../../storage/repository';

let repo: Repository;
let factory: IDBFactory;
let counter = 0;

beforeEach(() => {
  window.location.hash = '';
  factory = new IDBFactory();
  counter = 0;
  repo = createRepository({ factory, dbName: 'cf-app', newId: () => `m-${(counter += 1)}` });
});

const CSV_HEADER = 'tipo;descricao;valor;vencimento;categoria;identificador_externo';
const csvFile = (body: string, name = 'contas.csv') => new File([`${CSV_HEADER}\n${body}`], name, { type: 'text/csv' });

async function loadDemo(user = userEvent.setup()) {
  render(<App repository={repo} />);
  await user.click(await screen.findByRole('button', { name: /explorar demonstração/i }));
  await screen.findByRole('heading', { level: 1, name: 'Visão geral' });
  return user;
}
const goTo = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('button', { name }));

describe('primeiro acesso e demonstração', () => {
  it('sem dados mostra o onboarding e não carrega nada sozinho', async () => {
    render(<App repository={repo} />);
    expect(await screen.findByRole('heading', { level: 1, name: /seu caixa, sem surpresas/i })).toBeInTheDocument();
    expect(await repo.listEntries()).toEqual([]);
    expect(await repo.getSettings()).toBeNull();
  });

  it('"Explorar demonstração" persiste a fixture e o motor calcula: 14/11 = -R$ 700 e déficit R$ 1.700', async () => {
    await loadDemo();
    expect(screen.getByText('Dados fictícios')).toBeInTheDocument();
    expect(await repo.getDatasetKind()).toBe('demo');
    expect(await repo.listEntries()).toHaveLength(4);
    expect(screen.getByRole('alert')).toHaveTextContent('Saldo projetado negativo em 14/11/2026');
    expect(screen.getByRole('alert')).toHaveTextContent('R$ 1.700,00');
    expect(screen.getByText('Saldo informado em 11/11/2026')).toBeInTheDocument();
  });

  it('dados permanecem após recarregar (nova montagem do App, mesmo banco)', async () => {
    const user = await loadDemo();
    expect(user).toBeTruthy();
    document.body.innerHTML = '';
    const reopened = createRepository({ factory, dbName: 'cf-app' });
    render(<App repository={reopened} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo projetado negativo em 14/11/2026');
    expect(screen.queryByRole('button', { name: /explorar demonstração/i })).toBeNull();
    expect(screen.getByText('Dados fictícios')).toBeInTheDocument();
  });

  it('com dados existentes, carregar a demonstração exige confirmação; cancelar preserva', async () => {
    const user = await loadDemo();
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Adicionar lançamento' }));
    await user.type(screen.getByLabelText(/^Descrição/), 'Conta minha');
    await user.type(screen.getByLabelText(/^Valor/), '10,00');
    await user.type(screen.getByLabelText(/^Vencimento/), '2026-11-20');
    await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    await screen.findByText('Lançamento adicionado.');
    await user.click(screen.getByRole('button', { name: 'Carregar demonstração' }));
    const dialog = await screen.findByRole('alertdialog', { name: /substituir seus dados/i });
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await repo.listEntries()).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Carregar demonstração' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /substituir e carregar/i }));
    await waitFor(async () => expect(await repo.listEntries()).toHaveLength(4));
  });

  it('apagar tudo exige confirmação e volta ao onboarding', async () => {
    const user = await loadDemo();
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Apagar todos os dados' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(await repo.listEntries()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Apagar todos os dados' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Apagar tudo' }));
    expect(await screen.findByRole('heading', { level: 1, name: /seu caixa, sem surpresas/i })).toBeInTheDocument();
    expect(await repo.listEntries()).toEqual([]);
    expect(await repo.getSettings()).toBeNull();
  });
});

describe('edição recalcula a projeção', () => {
  it('editar o valor do aluguel remove o saldo negativo imediatamente', async () => {
    const user = await loadDemo();
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Editar Aluguel fictício' }));
    const amount = screen.getByLabelText(/^Valor/);
    await user.clear(amount);
    await user.type(amount, '1.000,00');
    await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    await screen.findByText('Lançamento atualizado.');
    await goTo(user, 'Visão geral');
    expect(screen.queryByText(/Saldo projetado negativo/)).toBeNull();
    expect(screen.getAllByText(/Risco de ficar abaixo do mínimo em 12\/11\/2026/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /mostrar tabela de valores/i }));
    const row = document.querySelector('tr[data-date="2026-11-14"]') as HTMLElement;
    expect(within(row).getByText('R$ 300,00')).toBeInTheDocument();
  });

  it('alterar saldo inicial e mínimo recalcula', async () => {
    const user = await loadDemo();
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Editar saldos' }));
    const opening = screen.getByLabelText(/^Saldo inicial/);
    await user.clear(opening);
    await user.type(opening, '9.000,00');
    await user.click(screen.getByRole('button', { name: 'Salvar saldos' }));
    await screen.findByText('Saldos salvos.');
    await goTo(user, 'Visão geral');
    expect(screen.getByText('R$ 9.000,00')).toBeInTheDocument();
    expect(screen.queryByText(/Saldo projetado negativo/)).toBeNull();
  });

  it('cadastrar uma conta manual grande cria um novo risco', async () => {
    const user = await loadDemo();
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Adicionar lançamento' }));
    await user.type(screen.getByLabelText(/^Descrição/), 'Reforma');
    await user.type(screen.getByLabelText(/^Valor/), '5.000,00');
    await user.type(screen.getByLabelText(/^Vencimento/), '2026-11-25');
    await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    await screen.findByText('Lançamento adicionado.');
    await goTo(user, 'Visão geral');
    await user.click(screen.getByRole('button', { name: /mostrar tabela de valores/i }));
    const row = document.querySelector('tr[data-date="2026-11-25"]') as HTMLElement;
    expect(within(row).getByText('-R$ 1.700,00')).toBeInTheDocument();
  });

  it('excluir pede confirmação, cancelar mantém e confirmar remove o efeito', async () => {
    const user = await loadDemo();
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Excluir Aluguel fictício' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(await repo.listEntries()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Excluir Aluguel fictício' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }));
    await screen.findByText('Lançamento excluído.');
    expect(await repo.listEntries()).toHaveLength(3);
    await goTo(user, 'Visão geral');
    expect(screen.queryByText(/Saldo projetado negativo/)).toBeNull();
  });

  it('validação por campo: valor inválido não grava', async () => {
    const user = await loadDemo();
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Adicionar lançamento' }));
    await user.type(screen.getByLabelText(/^Valor/), 'abc');
    await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    expect(screen.getByText('Informe a descrição.')).toBeInTheDocument();
    expect(screen.getByText(/valor inválido/i)).toBeInTheDocument();
    expect(screen.getByText('Informe um vencimento válido.')).toBeInTheDocument();
    expect(await repo.listEntries()).toHaveLength(4);
  });
});

describe('começar com meus dados', () => {
  it('pede saldos, salva e mostra o painel sem alerta', async () => {
    const user = userEvent.setup();
    render(<App repository={repo} />);
    await user.click(await screen.findByRole('button', { name: /começar com meus dados/i }));
    await screen.findByRole('heading', { name: /comece informando seus saldos/i });
    await user.clear(screen.getByLabelText(/^Data-base/));
    await user.type(screen.getByLabelText(/^Data-base/), '2026-11-11');
    await user.type(screen.getByLabelText(/^Saldo inicial/), '2.000,00');
    await user.type(screen.getByLabelText(/^Saldo mínimo/), '500,00');
    await user.click(screen.getByRole('button', { name: 'Salvar saldos' }));
    expect(await screen.findByText(/nenhum risco detectado/i)).toBeInTheDocument();
    expect(await repo.getSettings()).toEqual({ baseDate: '2026-11-11', openingBalanceCents: '200000', minimumBalanceCents: '50000' });
    expect(screen.queryByText('Dados fictícios')).toBeNull();
  });
});

describe('importação CSV', () => {
  const body = [
    'pagar;Fornecedor;100,00;2026-11-12;Insumos;F-1',
    'receber;Venda;50,00;13/11/2026;;V-1',
    'pagar;;10,00;2026-11-14;;', // linha 4: sem descrição
  ].join('\n');

  async function start() {
    const user = userEvent.setup();
    render(<App repository={repo} />);
    await user.click(await screen.findByRole('button', { name: /começar com meus dados/i }));
    await user.type(await screen.findByLabelText(/^Saldo inicial/), '1.000,00');
    await user.type(screen.getByLabelText(/^Saldo mínimo/), '0');
    await user.clear(screen.getByLabelText(/^Data-base/));
    await user.type(screen.getByLabelText(/^Data-base/), '2026-11-11');
    await user.click(screen.getByRole('button', { name: 'Salvar saldos' }));
    await screen.findByText(/nenhum risco/i);
    await goTo(user, 'Movimentações');
    return user;
  }

  it('prévia mostra erro por linha; nada é gravado até confirmar; reimportar não duplica', async () => {
    const user = await start();
    await user.upload(screen.getByTestId('csv-input'), csvFile(body));
    expect(await screen.findByText('Prévia da importação')).toBeInTheDocument();
    expect(screen.getByText('2 a importar')).toBeInTheDocument();
    expect(screen.getByText('1 com erro')).toBeInTheDocument();
    const errors = screen.getByRole('table', { name: /linhas com erro/i });
    expect(within(errors).getByText('4')).toBeInTheDocument();
    expect(within(errors).getByText(/descrição obrigatória/i)).toBeInTheDocument();
    expect(await repo.listEntries()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Importar 2 lançamento(s)' }));
    expect(await screen.findByText(/2 criado\(s\)/)).toBeInTheDocument();
    expect(await repo.listEntries()).toHaveLength(2);

    await user.upload(screen.getByTestId('csv-input'), csvFile(body));
    expect(await screen.findByText('0 a importar')).toBeInTheDocument();
    expect(screen.getByText('2 já importado(s) ou duplicado(s)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await repo.listEntries()).toHaveLength(2);

    await goTo(user, 'Visão geral');
    await user.click(screen.getByRole('button', { name: /mostrar tabela de valores/i }));
    const last = document.querySelector('tr[data-date="2026-11-13"]') as HTMLElement;
    expect(within(last).getByText('R$ 950,00')).toBeInTheDocument(); // 1000 - 100 + 50
  });

  it('arquivo ilegível mostra erro fatal e não permite importar', async () => {
    const user = await start();
    await user.upload(screen.getByTestId('csv-input'), new File(['coluna_errada\n1'], 'x.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/colunas obrigatórias ausentes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled();
  });

  it('CSV em Windows-1252 (acentos) é decodificado', async () => {
    const user = await start();
    const bytes = Uint8Array.from([...new TextEncoder().encode(`${CSV_HEADER}\npagar;Caf`), 0xe9, ...new TextEncoder().encode(';10,00;2026-11-12;;K1')]);
    await user.upload(screen.getByTestId('csv-input'), new File([bytes], 'latin1.csv', { type: 'text/csv' }));
    await user.click(await screen.findByRole('button', { name: 'Importar 1 lançamento(s)' }));
    await screen.findByText(/1 criado\(s\)/);
    expect((await repo.listEntries())[0]?.description).toBe('Café');
  });
});

describe('falhas de armazenamento não viram sucesso', () => {
  it('erro ao salvar mostra alerta e nenhuma mensagem de sucesso', async () => {
    const user = await loadDemo();
    vi.spyOn(repo, 'addEntry').mockRejectedValueOnce(new StorageError('quota', 'Sem espaço de armazenamento no navegador.'));
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Adicionar lançamento' }));
    await user.type(screen.getByLabelText(/^Descrição/), 'X');
    await user.type(screen.getByLabelText(/^Valor/), '1,00');
    await user.type(screen.getByLabelText(/^Vencimento/), '2026-11-20');
    await user.click(screen.getByRole('button', { name: 'Salvar lançamento' }));
    expect(await screen.findByText('Sem espaço de armazenamento no navegador.')).toBeInTheDocument();
    expect(screen.queryByText('Lançamento adicionado.')).toBeNull();
    expect(await repo.listEntries()).toHaveLength(4);
  });

  it('armazenamento indisponível na abertura mostra erro com nova tentativa', async () => {
    const broken = createRepository({ factory: null });
    render(<App repository={broken} />);
    expect(await screen.findByText(/não foi possível abrir o armazenamento/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('falha ao carregar a demonstração é informada no onboarding', async () => {
    vi.spyOn(repo, 'replaceAll').mockRejectedValueOnce(new StorageError('write_failed', 'Não foi possível salvar. Nada foi alterado; tente novamente.'));
    const user = userEvent.setup();
    render(<App repository={repo} />);
    await user.click(await screen.findByRole('button', { name: /explorar demonstração/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nada foi alterado');
    expect(screen.queryByText('Dados fictícios')).toBeNull();
  });
});

describe('calendário e navegação', () => {
  it('três vistas, hash na URL e atalho para a data crítica', async () => {
    const user = await loadDemo();
    await goTo(user, 'Calendário');
    expect(window.location.hash).toBe('#calendario');
    expect(await screen.findByRole('heading', { level: 1, name: 'Calendário' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ir para a próxima data crítica/i }));
    expect(screen.getByRole('button', { name: /12\/11\/2026, saldo R\$ 500,00/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /14\/11\/2026/ }));
    expect(screen.getByText(/faltam R\$ 1\.700,00 para o mínimo/)).toBeInTheDocument();
    expect(screen.getByText(/A pagar: Aluguel fictício/)).toBeInTheDocument();
  });

  it('abre direto na vista indicada pelo hash (recarregar a rota)', async () => {
    await loadDemo();
    document.body.innerHTML = '';
    window.location.hash = '#movimentacoes';
    render(<App repository={createRepository({ factory, dbName: 'cf-app' })} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Movimentações' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Lançamentos' })).toBeInTheDocument();
  });
});

describe('simulador (S05): hipóteses não tocam nos dados reais', () => {
  it('atrasar R$ 4.000 de 15/11 por 2 dias: só a Alternativa muda, o IndexedDB fica idêntico e o painel real segue igual', async () => {
    const user = await loadDemo();
    const entriesBefore = JSON.stringify(await repo.listEntries());
    const settingsBefore = JSON.stringify(await repo.getSettings());
    await goTo(user, 'Simulador');
    expect(await screen.findByRole('heading', { level: 1, name: 'Simulador' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#simulador');

    await user.selectOptions(screen.getByLabelText('Recebimento'), 'demo-receita-02');
    await user.type(screen.getByLabelText('Atraso (dias corridos)'), '2');
    await user.click(screen.getByRole('button', { name: 'Adicionar atraso' }));

    const table = screen.getByRole('table', { name: /Saldo por dia/ });
    const row = (d: string) => table.querySelector(`[data-date="${d}"]`) as HTMLElement;
    expect(row('2026-11-15').querySelector('[data-label="Original"]')).toHaveTextContent('R$ 3.300,00');
    expect(row('2026-11-15').querySelector('[data-label="Alternativa (hipótese)"]')).toHaveTextContent('-R$ 700,00');
    expect(row('2026-11-15').querySelector('[data-label="Diferença"]')).toHaveTextContent('-R$ 4.000,00');
    expect(row('2026-11-16').querySelector('[data-label="Diferença"]')).toHaveTextContent('-R$ 4.000,00');
    expect(row('2026-11-17').querySelector('[data-label="Diferença"]')).toHaveTextContent('R$ 0,00');

    expect(JSON.stringify(await repo.listEntries())).toBe(entriesBefore);
    expect(JSON.stringify(await repo.getSettings())).toBe(settingsBefore);

    // o painel real continua com os números originais
    await goTo(user, 'Visão geral');
    expect(await screen.findByRole('alert')).toHaveTextContent('R$ 1.700,00');
    expect(document.querySelector('[data-hypothetical]')).toBeNull();
    expect(screen.queryByText(/Alternativa/)).toBeNull();
    expect(screen.getByText(/Nenhuma previsão manual ou hipótese entra neste saldo/)).toBeInTheDocument();

    // as hipóteses duram a sessão: voltar ao Simulador as mantém; recarregar (nova montagem) as descarta
    await goTo(user, 'Simulador');
    expect(screen.getByRole('list', { name: 'Hipóteses ativas' })).toBeInTheDocument();
    document.body.innerHTML = '';
    window.location.hash = '#simulador';
    render(<App repository={createRepository({ factory, dbName: 'cf-app' })} />);
    await screen.findByRole('heading', { level: 1, name: 'Simulador' });
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
    expect(JSON.stringify(await repo.listEntries())).toBe(entriesBefore);
  });

  it('"Voltar ao original" devolve o simulador ao estado inicial sem perder nada dos dados', async () => {
    const user = await loadDemo();
    const entriesBefore = JSON.stringify(await repo.listEntries());
    await goTo(user, 'Simulador');
    await user.selectOptions(screen.getByLabelText('Categoria de despesa'), 'c:Aluguel');
    await user.type(screen.getByLabelText('Despesas ficam em (%)'), '110');
    await user.click(screen.getByRole('button', { name: 'Adicionar variação de despesas' }));
    const table = screen.getByRole('table', { name: /Saldo por dia/ });
    // aluguel de R$ 2.000,00 em 14/11 → R$ 2.200,00: diferença −R$ 200,00 a partir de 14/11
    expect(table.querySelector('[data-date="2026-11-14"] [data-label="Diferença"]')).toHaveTextContent('-R$ 200,00');
    await user.click(screen.getByRole('button', { name: 'Voltar ao original' }));
    expect(table.querySelector('[data-date="2026-11-14"] [data-label="Diferença"]')).toHaveTextContent('R$ 0,00');
    expect(screen.getByText(/Você está vendo o Original/)).toBeInTheDocument();
    expect(JSON.stringify(await repo.listEntries())).toBe(entriesBefore);
  });

  it('a base do simulador inclui recorrências calculadas e repasses derivados de venda (os mesmos lançamentos do motor)', async () => {
    const user = await loadDemo();
    await goTo(user, 'Calendário');
    await user.click(screen.getByRole('button', { name: 'Carregar recorrências fictícias' }));
    await screen.findByRole('table', { name: 'Regras de recorrência' });
    await goTo(user, 'Vendas e recebimentos');
    await user.click(screen.getByRole('button', { name: 'Carregar vendas fictícias' }));
    await screen.findByText(/vendas fictícias carregadas: 84 criada/i);
    await goTo(user, 'Simulador');
    const select = screen.getByLabelText('Recebimento');
    expect(within(select).getByRole('option', { name: /Contrato de eventos fictício.*Recorrente/ })).toBeInTheDocument(); // ocorrência calculada (não gravada)
    expect(within(select).getAllByRole('option', { name: /Repasse estimado da venda.*Venda/ }).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Vendas ficam em (%)'), '70');
    await user.click(screen.getByRole('button', { name: 'Adicionar variação de vendas' }));
    const diffs = [...screen.getByRole('table', { name: /Saldo por dia/ }).querySelectorAll('[data-label="Diferença"]')].map((c) => c.textContent ?? '');
    expect(diffs.some((d) => d.startsWith('-R$'))).toBe(true);
    expect(diffs.every((d) => d.startsWith('-R$') || d === 'R$ 0,00')).toBe(true);
  });

  it('carregar a demonstração de novo descarta hipóteses antigas (a base mudou)', async () => {
    const user = await loadDemo();
    await goTo(user, 'Simulador');
    await user.type(screen.getByLabelText('Vendas ficam em (%)'), '70');
    await user.click(screen.getByRole('button', { name: 'Adicionar variação de vendas' }));
    expect(screen.getByRole('list', { name: 'Hipóteses ativas' })).toBeInTheDocument();
    await goTo(user, 'Movimentações');
    await user.click(screen.getByRole('button', { name: 'Carregar demonstração' }));
    await user.click(await screen.findByRole('button', { name: 'Substituir e carregar' }));
    await screen.findByRole('heading', { level: 1, name: 'Visão geral' });
    await goTo(user, 'Simulador');
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
  });
});
