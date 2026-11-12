import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { createForecastDemo } from '../../demo/forecastDemo';
import { createSalesDemo } from '../../demo/salesDemo';
import { runBacktest } from '../../domain/forecast/backtest';
import { createRepository } from '../../storage/repository';
import type { Repository } from '../../storage/repository';
import { ForecastPanel, formatPercentBps, pickDefaultModel } from '../ForecastPanel';

const BASE = '2026-11-11';
const history = createForecastDemo().sales;
const short = createSalesDemo().sales; // 28 dias: dá previsão, mas não 4 janelas de backtesting

function panel(overrides: Partial<React.ComponentProps<typeof ForecastPanel>> = {}) {
  const props = { sales: history, baseDate: BASE, demoMode: false, busy: false, onLoadDemoHistory: vi.fn(), onGoSales: vi.fn(), ...overrides };
  render(<ForecastPanel {...props} />);
  return props;
}
const forecastTable = (name: RegExp) => screen.getByRole('table', { name });
const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent);

describe('pickDefaultModel e formatação', () => {
  it('padrão = modelo de menor erro medido; sem medição = média móvel; sem nada elegível = null', () => {
    expect(pickDefaultModel(runBacktest(history, { asOf: BASE, horizonDays: 7 }))).toBe('seasonal_weekday_mean');
    expect(pickDefaultModel(runBacktest(short, { asOf: BASE, horizonDays: 7 }))).toBe('moving_average_7');
    expect(pickDefaultModel(runBacktest([], { asOf: BASE, horizonDays: 7 }))).toBeNull();
  });
  it('percentual em pt-BR a partir de pontos-base', () => {
    expect(formatPercentBps(156)).toBe('1,6%');
    expect(formatPercentBps(10000)).toBe('100,0%');
  });
});

describe('com histórico suficiente (12 semanas fictícias)', () => {
  it('abre no modelo de menor erro, com método, janela, erro e faixa; faturamento bruto, nunca caixa', () => {
    panel({ demoMode: true });
    expect(screen.getByRole('heading', { level: 2, name: 'Previsão de faturamento bruto' })).toBeInTheDocument();
    expect(screen.getByLabelText('Modelo')).toHaveValue('seasonal_weekday_mean');
    expect(screen.getAllByText('Menor erro no período avaliado').length).toBeGreaterThan(0);
    expect(screen.getByText('modelo padrão')).toBeInTheDocument();
    // janela de treino e avaliação
    expect(screen.getByText('20/08 a 11/11')).toBeInTheDocument();
    expect(screen.getByText('84 dias (1 sem venda)')).toBeInTheDocument();
    expect(screen.getByText('6 janelas')).toBeInTheDocument();
    // limites claros
    expect(screen.getByText(/não é dinheiro disponível, não vira recebimento e não altera o saldo projetado/i)).toBeInTheDocument();
    expect(screen.getByText('Dados fictícios com padrão artificial')).toBeInTheDocument();
    expect(screen.getByText(/Não é intervalo de confiança nem promete/i)).toBeInTheDocument();
  });

  it('sazonal: primeiro dia previsto quinta 12/11 = R$ 380,00 (130 + 90 + 160); faixa dos erros passados em torno dele', () => {
    panel();
    const table = forecastTable(/Faturamento bruto previsto, modelo Sazonal por dia da semana/);
    const first = bodyRows(table)[0] as HTMLElement;
    expect(within(first).getByRole('rowheader')).toHaveTextContent('12/11/2026');
    // faixa = percentis 10 e 90 dos erros: −R$ 1,53 e +R$ 24,40 (conferidos no domínio)
    expect(cells(first)).toEqual(['R$ 378,47', 'R$ 380,00', 'R$ 404,40']);
    expect(bodyRows(table)).toHaveLength(7);
  });

  it('trocar para média móvel: central R$ 520,71 (3.645,00 / 7) e faixa R$ 303,00 a R$ 920,00 (dias realmente ocorridos)', async () => {
    const user = userEvent.setup();
    panel();
    await user.selectOptions(screen.getByLabelText('Modelo'), 'moving_average_7');
    const table = forecastTable(/Faturamento bruto previsto, modelo Média móvel de 7 dias/);
    expect(cells(bodyRows(table)[0] as HTMLElement)).toEqual(['R$ 303,00', 'R$ 520,71', 'R$ 920,00']);
    expect(screen.queryByText('modelo padrão')).not.toBeInTheDocument(); // escolha manual não é o padrão
  });

  it('ingênuo: central R$ 325,00 (quarta 11/11 = 110 + 75 + 140), faixa R$ 303,00 a R$ 920,00 e sem aviso de viés', async () => {
    const user = userEvent.setup();
    panel();
    await user.selectOptions(screen.getByLabelText('Modelo'), 'naive_last');
    const first = bodyRows(forecastTable(/Faturamento bruto previsto, modelo Ingênuo/))[0] as HTMLElement;
    expect(cells(first)).toEqual(['R$ 303,00', 'R$ 325,00', 'R$ 920,00']);
    expect(screen.queryByText(/a previsão central fica fora da faixa/)).not.toBeInTheDocument();
  });

  it('erro quase sempre para o mesmo lado (sazonal a 28 dias: piso do erro +R$ 2,85): a central fica FORA da faixa e a tela avisa, sem "corrigir" em silêncio', async () => {
    const user = userEvent.setup();
    panel();
    await user.selectOptions(screen.getByLabelText('Horizonte'), '28');
    expect(screen.getByLabelText('Modelo')).toHaveValue('seasonal_weekday_mean');
    const first = bodyRows(forecastTable(/Faturamento bruto previsto, modelo Sazonal/))[0] as HTMLElement;
    expect(cells(first)).toEqual(['R$ 382,85', 'R$ 380,00', 'R$ 419,10']); // central < conservadora
    expect(screen.getByText(/Em alguns dias a previsão central fica fora da faixa/)).toBeInTheDocument();
  });

  it('comparação: tabela com MAE, WAPE e viés por modelo; todos medidos nas mesmas janelas; "menor erro" sem dizer "melhor"', () => {
    panel();
    const table = screen.getByRole('table', { name: 'Erro de cada modelo no período avaliado' });
    const rows = bodyRows(table);
    expect(rows).toHaveLength(4);
    expect(within(rows[2] as HTMLElement).getByRole('rowheader')).toHaveTextContent('Sazonal por dia da semana (selecionado)');
    expect(cells(rows[2] as HTMLElement)[1]).toBe('1,6%'); // WAPE do sazonal
    expect(screen.getByText(/Erro medido em 6 janelas semanais \(42 previsões do dia comparadas com o realizado\)/)).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/melhor modelo|mais preciso|modelo vencedor|garantid/i);
    expect(text).not.toMatch(/\b9[05]\s?%\s*(de )?(confiança|probabilidade)/i);
  });

  it('previsto versus realizado: uma linha por janela (retrospectivo) e dia a dia da janela escolhida, com erro com sinal', async () => {
    const user = userEvent.setup();
    panel();
    expect(screen.getByText(/Previsão retrospectiva: o que o modelo teria previsto usando só os dados até a data de corte/)).toBeInTheDocument();
    const folds = screen.getByRole('table', { name: /Previsto versus realizado por janela, modelo Sazonal/ });
    expect(bodyRows(folds)).toHaveLength(6);
    const picker = screen.getByLabelText('Ver dia a dia a janela');
    expect(picker).toHaveValue('5'); // última janela por padrão
    const lastDay = screen.getByRole('table', { name: /Dia a dia da janela com corte em 04\/11\/2026/ });
    expect(bodyRows(lastDay)).toHaveLength(7);
    await user.selectOptions(picker, '0');
    expect(screen.getByRole('table', { name: /Dia a dia da janela com corte em 30\/09\/2026/ })).toBeInTheDocument();
  });

  it('dia sem venda aparece sinalizado no dia a dia (lacuna de 28/09 entra no treino, não em silêncio)', () => {
    panel();
    // o dia a dia mostra só janelas comparáveis; a lacuna é avisada no cabeçalho e na sazonalidade
    expect(screen.getByText('84 dias (1 sem venda)')).toBeInTheDocument();
    expect(screen.getByText(/28\/09\/2026: dia sem venda registrada, tratado como R\$ 0/)).toBeInTheDocument();
  });

  it('sazonalidade: padrão semanal detectado, índices por dia (segunda primeiro), outlier listado e período do mês com dados insuficientes', () => {
    panel();
    const card = screen.getByRole('heading', { name: 'Sazonalidade' }).closest('section') as HTMLElement;
    expect(within(card).getByText('Padrão semanal detectado')).toBeInTheDocument();
    const table = within(card).getByRole('table', { name: 'Índice sazonal por dia da semana' });
    const rows = bodyRows(table);
    expect(within(rows[0] as HTMLElement).getByRole('rowheader')).toHaveTextContent('segunda-feira');
    expect(within(rows[6] as HTMLElement).getByRole('rowheader')).toHaveTextContent('domingo');
    expect(cells(rows[0] as HTMLElement)[2]).toBe('67,4%');
    expect(within(card).getByText(/12\/09\/2026: R\$ 2\.566,80, bem fora do usual/)).toBeInTheDocument();
    expect(within(card).getByText('Dados insuficientes')).toBeInTheDocument();
    expect(within(card).getByText(/Período do mês exige ao menos 3 meses/)).toBeInTheDocument();
    expect(within(card).getByText(/não uma probabilidade nem um teste estatístico/)).toBeInTheDocument();
  });

  it('horizonte de 28 dias: Holt-Winters fica "sem erro medido" e sem faixa (nenhum número de erro inventado)', async () => {
    const user = userEvent.setup();
    panel();
    await user.selectOptions(screen.getByLabelText('Horizonte'), '28');
    expect(screen.getByRole('option', { name: 'Holt-Winters aditivo (semanal) (sem erro medido)' })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Modelo'), 'holt_winters_additive');
    expect(screen.getByText('Faixa indisponível')).toBeInTheDocument();
    expect(screen.getAllByText(/elegível em só 3 dobras de backtesting \(mínimo 4\)/).length).toBeGreaterThan(0);
    const first = bodyRows(forecastTable(/Faturamento bruto previsto, modelo Holt-Winters/))[0] as HTMLElement;
    expect(cells(first)[0]).toBe('—');
    expect(cells(first)[2]).toBe('—');
    expect(screen.getByText('Não medida')).toBeInTheDocument();
    expect(screen.getByText(/Sem comparação disponível/)).toBeInTheDocument();
  });

  it('o gráfico tem descrição acessível e legenda textual; controles com nome e tabela equivalente', () => {
    panel();
    const chart = screen.getByRole('img', { name: /Gráfico de faturamento bruto: linha cinza com o realizado dos últimos 28 dias/ });
    expect(chart).toBeInTheDocument();
    expect(chart.getAttribute('aria-label')).toMatch(/faixa dos erros passados/);
    const legend = screen.getByRole('list', { name: 'Legenda do gráfico' });
    expect(within(legend).getByText(/Linha cinza contínua: faturamento realizado/)).toBeInTheDocument();
    expect(within(legend).getByText(/Linha dourada com losangos: previsão central/)).toBeInTheDocument();
    expect(within(legend).getByText(/Área clara entre linhas pontilhadas: faixa dos erros passados/)).toBeInTheDocument();
  });
});

describe('dados insuficientes: aviso em vez de estimativa', () => {
  it('sem vendas: nenhuma previsão, nenhum número; fora da demo oferece importar', async () => {
    const user = userEvent.setup();
    const props = panel({ sales: [] });
    expect(screen.getByText('Dados insuficientes: nenhuma previsão foi gerada')).toBeInTheDocument();
    expect(screen.getByLabelText('Modelo')).toBeDisabled();
    expect(screen.queryByRole('table', { name: /Faturamento bruto previsto/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Gráfico de faturamento/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^R\$ /)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Importar vendas' }));
    expect(props.onGoSales).toHaveBeenCalledTimes(1);
  });

  it('na demonstração oferece carregar o histórico fictício de 12 semanas', async () => {
    const user = userEvent.setup();
    const props = panel({ sales: [], demoMode: true });
    await user.click(screen.getByRole('button', { name: 'Carregar histórico fictício de 12 semanas' }));
    expect(props.onLoadDemoHistory).toHaveBeenCalledTimes(1);
  });

  it('28 dias (demo da S02): há previsão simples com aviso "sem erro medido" e NENHUMA faixa; o padrão é a média móvel', () => {
    panel({ sales: short });
    expect(screen.getByLabelText('Modelo')).toHaveValue('moving_average_7');
    expect(screen.getAllByText('Sem erro medido').length).toBeGreaterThan(0);
    expect(screen.getByText('Dados insuficientes para medir o erro')).toBeInTheDocument();
    expect(screen.getByText('Faixa indisponível')).toBeInTheDocument();
    const first = bodyRows(forecastTable(/Faturamento bruto previsto, modelo Média móvel/))[0] as HTMLElement;
    expect(cells(first)).toEqual(['—', 'R$ 520,71', '—']);
    expect(screen.getByText('Não medida')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(2);
    // Holt-Winters e sazonal indisponíveis (motivo à vista), e o campo não deixa escolhê-los
    expect(screen.getByRole('option', { name: 'Holt-Winters aditivo (semanal) (indisponível)' })).toBeDisabled();
    expect(screen.getAllByText(/Holt-Winters exige ao menos 42 dias de série/).length).toBeGreaterThan(0);
  });

  it('realizado total R$ 0 no período avaliado: WAPE "indefinido" (denominador zero), nunca 0%; MAE segue calculado', () => {
    // 28 dias de vendas e data-base 28 dias depois: todas as janelas avaliadas caem em dias sem venda (R$ 0)
    panel({ sales: short, baseDate: '2026-12-09' });
    expect(screen.getByLabelText('Modelo')).toHaveValue('naive_last'); // menor erro absoluto: último dia R$ 325,00 < média R$ 520,71
    const stat = screen.getByText('Erro relativo (WAPE)').parentElement as HTMLElement;
    expect(within(stat).getByText('indefinido')).toBeInTheDocument();
    expect(within(stat).getByText(/denominador zero/)).toBeInTheDocument();
    expect(within(stat).queryByText('0,0%')).not.toBeInTheDocument();
    const rows = bodyRows(screen.getByRole('table', { name: 'Erro de cada modelo no período avaliado' }));
    // ingênuo: erro só na janela de origem 28 dias: 7 × R$ 325,00 / 28 dias = R$ 81,25; média móvel: 7 × R$ 520,71 / 28 = R$ 130,18
    expect(cells(rows[0] as HTMLElement).slice(0, 2)).toEqual(['R$ 81,25', 'indefinido']);
    expect(cells(rows[1] as HTMLElement).slice(0, 2)).toEqual(['R$ 130,18', 'indefinido']);
  });

  it('a seleção do usuário cai no padrão quando o modelo deixa de estar disponível (horizonte maior)', async () => {
    const user = userEvent.setup();
    panel({ sales: short });
    await user.selectOptions(screen.getByLabelText('Horizonte'), '28');
    // 28 dias de histórico não cobrem 28 dias de horizonte: nenhuma dobra, previsão final ainda existe
    expect(screen.getByLabelText('Modelo')).toHaveValue('moving_average_7');
    expect(screen.getAllByText(/são necessários ao menos 56 dias \(28 de treino \+ horizonte de 28\)/).length).toBeGreaterThan(0);
  });
});

describe('dentro do aplicativo', () => {
  let repo: Repository;
  beforeEach(() => {
    window.location.hash = '';
    repo = createRepository({ factory: new IDBFactory(), dbName: 'cf-forecast-ui', newId: (() => { let n = 0; return () => `f-${(n += 1)}`; })() });
  });

  it('menu "Previsões" só existe agora; demo → Previsões avisa; carregar histórico grava e persiste sem duplicar; trocar modelo/horizonte NÃO altera o saldo projetado', async () => {
    const user = userEvent.setup();
    render(<App repository={repo} />);
    await user.click(await screen.findByRole('button', { name: /explorar demonstração/i }));
    await screen.findByRole('heading', { level: 1, name: 'Visão geral' });

    const nav = within(screen.getByRole('navigation', { name: 'Principal' }));
    expect(nav.getAllByRole('button').map((b) => b.textContent)).toEqual(['Visão geral', 'Movimentações', 'Vendas e recebimentos', 'Previsões', 'Calendário']);

    await user.click(nav.getByRole('button', { name: 'Previsões' }));
    await screen.findByRole('heading', { level: 1, name: 'Previsões' });
    expect(screen.getByText('Dados insuficientes: nenhuma previsão foi gerada')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Carregar histórico fictício de 12 semanas' }));
    await screen.findByText(/Histórico fictício de 12 semanas carregado: 249 venda\(s\) criada\(s\)/);
    expect(await repo.sales.listSales()).toHaveLength(249);
    expect(screen.getByLabelText('Modelo')).toHaveValue('seasonal_weekday_mean');
    expect(screen.getByText('6 janelas')).toBeInTheDocument();

    // carregar também as vendas fictícias da S02 não duplica (mesmos ids e valores)
    await user.click(nav.getByRole('button', { name: 'Vendas e recebimentos' }));
    await screen.findByRole('heading', { level: 1, name: 'Vendas e recebimentos' });
    await user.click(screen.getByRole('button', { name: 'Carregar vendas fictícias' }));
    await screen.findByText(/Vendas fictícias carregadas: 0 criada\(s\), 84 já existiam\./);
    expect(await repo.sales.listSales()).toHaveLength(249);

    // o saldo projetado vem só do motor financeiro (contas + repasses das vendas, S02): a previsão não entra
    const balance = async () => {
      await user.click(nav.getByRole('button', { name: 'Visão geral' }));
      await screen.findByRole('heading', { level: 1, name: 'Visão geral' });
      return (await screen.findByText(/^Saldo projetado em \d{2}\/\d{2}\/\d{4}$/)).parentElement!.querySelector('.cf-stat__value')!.textContent;
    };
    const before = await balance();
    expect(before).toMatch(/^-?R\$ /);
    await user.click(nav.getByRole('button', { name: 'Previsões' }));
    await user.selectOptions(await screen.findByLabelText('Horizonte'), '28');
    await user.selectOptions(screen.getByLabelText('Modelo'), 'naive_last');
    expect(await balance()).toBe(before);

    // reabrir em um aplicativo novo: o histórico persistiu
    document.body.innerHTML = '';
    render(<App repository={repo} />);
    await waitFor(async () => expect(await repo.sales.listSales()).toHaveLength(249));
  });

  it('Previsões sem saldo configurado pede os saldos primeiro (sem previsão solta)', async () => {
    const user = userEvent.setup();
    render(<App repository={repo} />);
    await user.click(await screen.findByRole('button', { name: /começar com meus dados/i }));
    await user.click(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('button', { name: 'Previsões' }));
    await screen.findByRole('heading', { level: 1, name: 'Previsões' });
    expect(screen.getByText(/informando seus saldos/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Modelo')).not.toBeInTheDocument();
  });
});
