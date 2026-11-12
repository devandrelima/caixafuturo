import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'docs/evidencias/capturas';
const SALES_HEADER = 'identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria';
const salesCsv = (rows: string[]) => ({ name: 'vendas.csv', mimeType: 'text/csv', buffer: Buffer.from([SALES_HEADER, ...rows].join('\n'), 'utf-8') });

type ViewName = 'Visão geral' | 'Movimentações' | 'Vendas e recebimentos' | 'Previsões' | 'Calendário';
async function nav(page: Page, name: ViewName) {
  const toggle = page.getByRole('button', { name: 'Abrir menu' });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name }).click();
}
const hasHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explorar demonstração' }).click();
  await expect(page.getByText('Saldo informado em 11/11/2026')).toBeVisible();
}
async function loadHistory(page: Page) {
  await nav(page, 'Previsões');
  await expect(page.getByRole('heading', { level: 1, name: 'Previsões' })).toBeVisible();
  await page.getByRole('button', { name: 'Carregar histórico fictício de 12 semanas' }).click();
  await expect(page.getByText(/histórico fictício de 12 semanas carregado: 249 venda/i)).toBeVisible();
}
const forecastRow = (page: Page, tableName: RegExp, index = 0) => page.getByRole('table', { name: tableName }).locator('tbody tr').nth(index);
const rowCells = (row: ReturnType<typeof forecastRow>) => row.locator('td').allInnerTexts();

test.describe('Sprint 3 — previsões, erro medido e faixas', () => {
  test('sem histórico: aviso "dados insuficientes", nenhum número de previsão; demo oferece o histórico fictício', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Previsões');
    await expect(page.getByText('Dados insuficientes: nenhuma previsão foi gerada')).toBeVisible();
    await expect(page.getByRole('table', { name: /Faturamento bruto previsto/ })).toHaveCount(0);
    await expect(page.getByRole('img', { name: /Gráfico de faturamento/ })).toHaveCount(0);
    await expect(page.getByLabel('Modelo', { exact: true })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/e2e-s03-insuficiente.png`, fullPage: true });
  });

  test('histórico de 12 semanas: modelo de menor erro, método, janela, erro e faixa; troca de modelo e horizonte; persiste ao recarregar', async ({ page }) => {
    await loadDemo(page);
    await loadHistory(page);

    // padrão = menor erro medido (decisão do usuário), com a janela de treino e a avaliação visíveis
    await expect(page.getByLabel('Modelo', { exact: true })).toHaveValue('seasonal_weekday_mean');
    await expect(page.getByText('20/08 a 11/11')).toBeVisible();
    await expect(page.getByText('84 dias (1 sem venda)')).toBeVisible();
    await expect(page.getByText('6 janelas', { exact: true })).toBeVisible();
    await expect(page.getByText('Dados fictícios com padrão artificial')).toBeVisible();
    await expect(page.getByText(/não é dinheiro disponível, não vira recebimento e não altera o saldo projetado/i)).toBeVisible();

    // quinta 12/11 = 130 + 90 + 160 = R$ 380,00 (conta à mão); faixa dos erros passados em volta
    const table = /Faturamento bruto previsto, modelo Sazonal/;
    await expect(forecastRow(page, table)).toContainText('12/11/2026');
    expect(await rowCells(forecastRow(page, table))).toEqual(['R$ 378,47', 'R$ 380,00', 'R$ 404,40']);

    // média móvel: 3.645,00 / 7 = R$ 520,71, faixa dos dias realmente ocorridos
    await page.getByLabel('Modelo', { exact: true }).selectOption('moving_average_7');
    expect(await rowCells(forecastRow(page, /Faturamento bruto previsto, modelo Média móvel/))).toEqual(['R$ 303,00', 'R$ 520,71', 'R$ 920,00']);

    // horizonte 28 dias: Holt-Winters só tem 3 janelas ⇒ sem erro medido e SEM faixa
    await page.getByLabel('Horizonte', { exact: true }).selectOption('28');
    await page.getByLabel('Modelo', { exact: true }).selectOption('holt_winters_additive');
    await expect(page.getByText('Faixa indisponível')).toBeVisible();
    await expect(page.getByText('Não medida')).toBeVisible();
    expect(await rowCells(forecastRow(page, /Faturamento bruto previsto, modelo Holt-Winters/))).toEqual(['—', expect.stringMatching(/^R\$ /), '—']);
    await page.screenshot({ path: `${SHOTS}/e2e-s03-sem-faixa.png`, fullPage: true });

    // recarregar: o histórico persiste no IndexedDB e a tela volta a calcular
    await page.reload();
    await nav(page, 'Previsões');
    await expect(page.getByLabel('Modelo', { exact: true })).toHaveValue('seasonal_weekday_mean');
    await expect(page.getByText('6 janelas', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/e2e-s03-previsoes.png`, fullPage: true });
  });

  test('previsto versus realizado (retrospectivo) e sazonalidade com amostra, outlier e lacuna', async ({ page }) => {
    await loadDemo(page);
    await loadHistory(page);
    await expect(page.getByText(/Previsão retrospectiva: o que o modelo teria previsto usando só os dados até a data de corte/)).toBeVisible();
    await expect(page.getByRole('table', { name: /Previsto versus realizado por janela/ }).locator('tbody tr')).toHaveCount(6);
    await page.getByLabel('Ver dia a dia a janela').selectOption('0');
    await expect(page.getByRole('table', { name: /Dia a dia da janela com corte em 30\/09\/2026/ }).locator('tbody tr')).toHaveCount(7);

    await expect(page.getByText('Padrão semanal detectado')).toBeVisible();
    await expect(page.getByText(/12\/09\/2026: R\$ 2\.566,80, bem fora do usual/)).toBeVisible();
    await expect(page.getByText(/28\/09\/2026: dia sem venda registrada, tratado como R\$ 0/)).toBeVisible();
    await expect(page.getByText(/Período do mês exige ao menos 3 meses/)).toBeVisible();
  });

  test('dados próprios curtos (5 dias de venda): nenhuma estimativa; orienta a importar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Começar com meus dados' }).click();
    await page.getByLabel(/^Data-base/).fill('2026-11-11');
    await page.getByLabel(/^Saldo inicial/).fill('3.000,00');
    await page.getByLabel(/^Saldo mínimo/).fill('1.000,00');
    await page.getByRole('button', { name: 'Salvar saldos' }).click();
    await nav(page, 'Vendas e recebimentos');
    await page.getByTestId('sales-csv-input').setInputFiles(
      salesCsv(['V1;05/11/2026;100,00;pix;', 'V2;06/11/2026;120,00;pix;', 'V3;07/11/2026;90,00;pix;', 'V4;08/11/2026;110,00;pix;', 'V5;09/11/2026;130,00;pix;']),
    );
    await page.getByRole('button', { name: /^Importar \d+ venda/ }).click();
    await expect(page.getByText(/importação de vendas concluída/i)).toBeVisible();
    await nav(page, 'Previsões');
    await expect(page.getByText('Dados insuficientes: nenhuma previsão foi gerada')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /5 dias com venda; são necessários ao menos 7/ }).first()).toBeVisible();
    await expect(page.getByRole('table', { name: /Faturamento bruto previsto/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Importar vendas' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Carregar histórico fictício/ })).toHaveCount(0); // só na demonstração
  });

  test('regressão S01/S02: a demo continua 12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 e a previsão não entra no saldo', async ({ page }) => {
    await loadDemo(page);
    const lowest = page.getByText(/^Saldo projetado em/).locator('..').locator('.cf-stat__value');
    const before = await lowest.innerText();
    await loadHistory(page);
    await page.getByLabel('Horizonte', { exact: true }).selectOption('14');
    await page.getByLabel('Modelo', { exact: true }).selectOption('naive_last');
    await nav(page, 'Visão geral');
    // o saldo projetado muda só pelos repasses das vendas (S02); trocar modelo/horizonte nunca o altera
    const afterHistory = await lowest.innerText();
    await nav(page, 'Previsões');
    await page.getByLabel('Horizonte', { exact: true }).selectOption('28');
    await page.getByLabel('Modelo', { exact: true }).selectOption('moving_average_7');
    await nav(page, 'Visão geral');
    expect(await lowest.innerText()).toBe(afterHistory);
    expect(before).toMatch(/^R\$ /);
  });

  test('teclado: troca de modelo e abertura da tabela sem mouse', async ({ page }) => {
    await loadDemo(page);
    await loadHistory(page);
    const model = page.getByLabel('Modelo', { exact: true });
    await model.focus();
    await page.keyboard.press('ArrowUp'); // sazonal → média móvel (próxima opção anterior)
    await expect(model).toHaveValue('moving_average_7');
    const summary = page.locator('summary', { hasText: 'Tabela de valores da previsão' });
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary.locator('..')).not.toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(summary.locator('..')).toHaveAttribute('open', '');
  });

  const VIEWPORTS = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const;

  for (const vp of VIEWPORTS) {
    test(`${vp.name}: sem rolagem horizontal, sem erro de console, alvos ≥ 44px, nomes acessíveis e capturas`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      await loadDemo(page);
      await nav(page, 'Previsões');
      expect(await hasHorizontalScroll(page), `${vp.name} previsões vazia`).toBe(false);
      await loadHistory(page);
      for (const h of ['Previsão de faturamento bruto', 'Comparação de modelos (backtesting)', 'Previsto versus realizado', 'Sazonalidade', 'O que esta tela mostra e o que não mostra']) {
        await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
      }
      expect(await hasHorizontalScroll(page), `${vp.name} previsões`).toBe(false);
      // o gráfico cabe no cartão
      const fits = await page.evaluate(() => {
        const svg = document.querySelector('.cf-chart svg') as SVGElement;
        const card = svg.closest('.cf-card') as HTMLElement;
        return svg.getBoundingClientRect().width <= card.getBoundingClientRect().width;
      });
      expect(fits).toBe(true);
      // nenhuma tabela da vista Previsões precisa rolar na horizontal (os números principais ficam à vista)
      const scrolling = await page.evaluate(() =>
        [...document.querySelectorAll('.cf-table-wrap')].filter((w) => w.scrollWidth > w.clientWidth + 1).map((w) => w.querySelector('table')?.getAttribute('aria-label')),
      );
      expect(scrolling, `${vp.name} tabelas com rolagem interna`).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/${vp.name}-previsoes.png`, fullPage: true });
      const problems = await page.evaluate(() => {
        const bad: string[] = [];
        document.querySelectorAll('button, input:not([type=file]), select, summary').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || getComputedStyle(el).visibility === 'hidden') return;
          const name = el.getAttribute('aria-label') || (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || '';
          if (!name) bad.push(`sem nome: ${el.outerHTML.slice(0, 80)}`);
          if (rect.height < 43.5) bad.push(`alvo ${Math.round(rect.height)}px: ${name}`);
        });
        return bad;
      });
      expect(problems).toEqual([]);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }
});
