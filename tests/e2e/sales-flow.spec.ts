import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

const SHOTS = 'docs/evidencias/capturas';
const SALES_HEADER = 'identificador_venda;data_venda;valor_bruto;meio_pagamento;categoria';
const ACCOUNTS_HEADER = 'tipo;descricao;valor;vencimento;categoria;identificador_externo;referencia_venda';
const salesCsv = (rows: string[], name = 'vendas.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from([SALES_HEADER, ...rows].join('\n'), 'utf-8') });
const accountsCsv = (rows: string[], name = 'contas.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from([ACCOUNTS_HEADER, ...rows].join('\n'), 'utf-8') });

type ViewName = 'Visão geral' | 'Movimentações' | 'Vendas e recebimentos' | 'Previsões' | 'Calendário' | 'Simulador';
async function nav(page: Page, name: ViewName) {
  const toggle = page.getByRole('button', { name: 'Abrir menu' });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name }).click();
}
const hasHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** Dados próprios: data-base 11/11/2026, saldo R$ 3.000,00, mínimo R$ 1.000,00, sem lançamentos. */
async function startOwn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Começar com meus dados' }).click();
  await page.getByLabel(/^Data-base/).fill('2026-11-11');
  await page.getByLabel(/^Saldo inicial/).fill('3.000,00');
  await page.getByLabel(/^Saldo mínimo/).fill('1.000,00');
  await page.getByRole('button', { name: 'Salvar saldos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Visão geral' })).toBeVisible();
}
async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explorar demonstração' }).click();
  await expect(page.getByText('Saldo informado em 11/11/2026')).toBeVisible();
}
async function setCreditRule(page: Page, feePct: string, lagDays: string) {
  await nav(page, 'Vendas e recebimentos');
  await page.getByLabel('Taxa de Crédito (%)').fill(feePct);
  await page.getByLabel('Prazo de Crédito (dias)').fill(lagDays);
  await page.getByRole('button', { name: 'Salvar regras' }).click();
  await expect(page.getByText(/regras de repasse salvas/i)).toBeVisible();
}
async function importSales(page: Page, rows: string[]) {
  await nav(page, 'Vendas e recebimentos');
  await page.getByTestId('sales-csv-input').setInputFiles(salesCsv(rows));
  await page.getByRole('button', { name: /^Importar \d+ venda/ }).click();
  await expect(page.getByText(/importação de vendas concluída/i)).toBeVisible();
}
async function importAccounts(page: Page, rows: string[]) {
  await nav(page, 'Movimentações');
  await page.getByTestId('csv-input').setInputFiles(accountsCsv(rows));
  await page.getByRole('button', { name: /^Importar \d+ lançamento/ }).click();
  await expect(page.getByText(/importação concluída: \d+ criado/i)).toBeVisible();
}
/** Saldo de fechamento de cada um dos 30 dias, lido da tabela do app (mesmos números do motor). */
async function closings(page: Page): Promise<Record<string, string>> {
  await nav(page, 'Visão geral');
  const toggle = page.getByRole('button', { name: /mostrar tabela de valores/i });
  if (await toggle.isVisible()) await toggle.click();
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    document.querySelectorAll('tbody tr[data-date]').forEach((tr) => {
      out[(tr as HTMLElement).dataset.date as string] = (tr.querySelectorAll('td')[3] as HTMLElement).innerText;
    });
    return out;
  });
}
const saleRow = (page: Page, id: string) => page.getByRole('table', { name: 'Recebimentos previstos líquidos' }).locator(`tr[data-sale="${id}"]`);

test.describe('venda ≠ recebimento; taxa e prazo mudam o caixa', () => {
  test('venda bruta não aumenta o saldo; mudar taxa/prazo muda data e valor do caixa (cálculo independente)', async ({ page }) => {
    await startOwn(page);
    await importSales(page, ['V-1;12/11/2026;1.000,00;crédito;Salão']);
    // padrão ilustrativo: crédito 3,99% D+30 → R$ 1.000,00 − R$ 39,90 = R$ 960,10 em 12/12/2026 (fora dos 30 dias)
    await expect(saleRow(page, 'V-1')).toContainText('12/12/2026');
    await expect(saleRow(page, 'V-1')).toContainText('R$ 960,10');
    let c = await closings(page);
    expect(c['2026-11-12']).toBe('R$ 3.000,00'); // dia da venda: nada entra
    expect(c['2026-12-11']).toBe('R$ 3.000,00');

    await setCreditRule(page, '2,50', '10'); // R$ 1.000,00 − R$ 25,00 = R$ 975,00 em 22/11/2026
    await expect(saleRow(page, 'V-1')).toContainText('22/11/2026');
    await expect(saleRow(page, 'V-1')).toContainText('R$ 975,00');
    c = await closings(page);
    expect(c['2026-11-21']).toBe('R$ 3.000,00');
    expect(c['2026-11-22']).toBe('R$ 3.975,00');
    expect(c['2026-12-11']).toBe('R$ 3.975,00');
    await nav(page, 'Vendas e recebimentos');
    await page.screenshot({ path: `${SHOTS}/e2e-s02-vendas-regras.png`, fullPage: true });
  });

  test('regra inválida mostra erro e não altera o caixa', async ({ page }) => {
    await startOwn(page);
    await nav(page, 'Vendas e recebimentos');
    await page.getByLabel('Taxa de Pix (%)').fill('120');
    await page.getByRole('button', { name: 'Salvar regras' }).click();
    await expect(page.getByText(/taxa de pix inválida/i)).toBeVisible();
    await page.getByLabel('Taxa de Pix (%)').fill('1,99');
    await page.getByLabel('Taxa de Débito (%)').fill('99');
    await page.getByLabel('Comissão de Débito (%)').fill('2');
    await page.getByRole('button', { name: 'Salvar regras' }).click();
    await expect(page.getByText(/passam de 100%/)).toBeVisible();
  });
});

test.describe('conciliação entre CSV de contas e CSV de vendas (PEND-S02-001)', () => {
  const SALE = ['V-1;12/11/2026;1.000,00;crédito;Salão', 'V-2;13/11/2026;200,00;pix;Salão'];
  const ACCOUNTS = ['receber;Repasse crédito V-1;975,00;22/11/2026;;R-1;V-1', 'pagar;Aluguel;1.000,00;14/11/2026;;P-1;'];

  async function scenario(browser: Browser, order: 'contas-primeiro' | 'vendas-primeiro') {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await startOwn(page);
    await setCreditRule(page, '2,50', '10');
    if (order === 'contas-primeiro') {
      await importAccounts(page, ACCOUNTS);
      await importSales(page, SALE);
    } else {
      await importSales(page, SALE);
      await importAccounts(page, ACCOUNTS);
    }
    return { ctx, page };
  }

  test('contas→vendas e vendas→contas: caixa idêntico, sem dupla contagem; reimportar não muda nada', async ({ browser }) => {
    const a = await scenario(browser, 'contas-primeiro');
    const b = await scenario(browser, 'vendas-primeiro');
    const ca = await closings(a.page);
    const cb = await closings(b.page);
    expect(cb).toEqual(ca);
    // cálculo independente: 3.000 − 1.000 (aluguel 14/11) + 200 (Pix V-2, taxa 0,99% = R$ 1,98 → R$ 198,02 em 13/11) + 975 (V-1 em 22/11)
    expect(ca['2026-11-12']).toBe('R$ 3.000,00');
    expect(ca['2026-11-13']).toBe('R$ 3.198,02');
    expect(ca['2026-11-14']).toBe('R$ 2.198,02');
    expect(ca['2026-11-21']).toBe('R$ 2.198,02');
    expect(ca['2026-11-22']).toBe('R$ 3.173,02'); // uma única disponibilidade de R$ 975,00 (não 1.950,00)
    expect(ca['2026-12-11']).toBe('R$ 3.173,02');

    await nav(a.page, 'Vendas e recebimentos');
    await expect(saleRow(a.page, 'V-1')).toContainText('Conciliado');
    await expect(saleRow(a.page, 'V-1').locator('[data-col="counts"]')).toHaveText('Não');
    await expect(saleRow(a.page, 'V-2')).toContainText('Derivado (estimativa)');
    await a.page.screenshot({ path: `${SHOTS}/e2e-s02-conciliado.png`, fullPage: true });

    // reimportação de ambos os arquivos
    await a.page.getByTestId('sales-csv-input').setInputFiles(salesCsv(SALE));
    await expect(a.page.getByText('0 a importar')).toBeVisible();
    await expect(a.page.getByText(/nada novo para importar/i)).toBeVisible();
    await a.page.getByRole('button', { name: 'Cancelar' }).click();
    await nav(a.page, 'Movimentações');
    await a.page.getByTestId('csv-input').setInputFiles(accountsCsv(ACCOUNTS));
    await expect(a.page.getByText(/nada novo para importar/i)).toBeVisible();
    await a.page.getByRole('button', { name: 'Cancelar' }).click();
    expect(await closings(a.page)).toEqual(ca);
    await a.page.reload();
    expect(await closings(a.page)).toEqual(ca); // persiste após recarregar
    await a.ctx.close();
    await b.ctx.close();
  });

  test('conta sem referência: PENDENTE, só a importada soma; decisão explícita muda o caixa e pode ser desfeita', async ({ page }) => {
    await startOwn(page);
    await setCreditRule(page, '2,50', '10');
    await importAccounts(page, ['receber;Repasse maquininha;975,00;22/11/2026;;R-1;']);
    await importSales(page, ['V-1;12/11/2026;1.000,00;crédito;Salão']);
    await expect(saleRow(page, 'V-1')).toContainText('Conciliação pendente');
    await expect(page.getByText(/1 recebível\(is\) com conciliação pendente/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/e2e-s02-pendente.png`, fullPage: true });
    expect((await closings(page))['2026-11-22']).toBe('R$ 3.975,00'); // sem somar os dois

    await nav(page, 'Vendas e recebimentos');
    await page.getByRole('button', { name: 'Conta independente de vendas' }).click();
    await expect(saleRow(page, 'V-1')).toContainText('Derivado (estimativa)');
    expect((await closings(page))['2026-11-22']).toBe('R$ 4.950,00'); // escolha explícita: dois recebimentos distintos

    await nav(page, 'Vendas e recebimentos');
    await page.getByRole('button', { name: 'Desfazer decisão' }).click();
    await expect(saleRow(page, 'V-1')).toContainText('Conciliação pendente');
    await page.getByRole('button', { name: 'Vincular a V-1' }).click();
    await expect(saleRow(page, 'V-1')).toContainText('Conciliado');
    expect((await closings(page))['2026-11-22']).toBe('R$ 3.975,00');
    await page.reload();
    expect((await closings(page))['2026-11-22']).toBe('R$ 3.975,00');
  });

  test('referência enviada depois (reimportação do arquivo de contas atualizado) concilia sem duplicar a conta', async ({ page }) => {
    await startOwn(page);
    await setCreditRule(page, '2,50', '10');
    await importAccounts(page, ['receber;Repasse crédito V-1;975,00;22/11/2026;;R-1;']);
    await importSales(page, ['V-1;12/11/2026;1.000,00;crédito;Salão']);
    await expect(saleRow(page, 'V-1')).toContainText('Conciliação pendente');
    await nav(page, 'Movimentações');
    await page.getByTestId('csv-input').setInputFiles(accountsCsv(['receber;Repasse crédito V-1;975,00;22/11/2026;;R-1;V-1']));
    await expect(page.getByText('1 referência(s) de venda a atualizar')).toBeVisible();
    await page.getByRole('button', { name: 'Atualizar referências de venda' }).click();
    await expect(page.getByText(/1 referência\(s\) de venda atualizada/)).toBeVisible();
    await expect(page.getByRole('table', { name: 'Lançamentos' }).locator('tbody tr')).toHaveCount(1);
    await nav(page, 'Vendas e recebimentos');
    await expect(saleRow(page, 'V-1')).toContainText('Conciliado');
    expect((await closings(page))['2026-11-22']).toBe('R$ 3.975,00');
  });

  test('lote e parcelas são sinalizados como não suportados (limitação visível na UI)', async ({ page }) => {
    await startOwn(page);
    await setCreditRule(page, '2,50', '10');
    await importAccounts(page, ['receber;Repasse do lote;1.100,00;22/11/2026;;R-1;V-1|V-2']);
    await importSales(page, SALE);
    await expect(saleRow(page, 'V-1')).toContainText('Lote — não suportado');
    await expect(saleRow(page, 'V-2')).toContainText('Lote — não suportado');
    await expect(page.getByText(/parcelas e lotes não são suportados/i)).toBeVisible();
    expect((await closings(page))['2026-11-22']).toBe('R$ 4.100,00'); // só o lote importado (1.100,00) soma
  });
});

test.describe('demonstração com vendas fictícias, previsão e explicação de riscos', () => {
  test('S01 preservada; vendas fictícias geram pendências; decidir muda o caixa por conta calculada à mão', async ({ page }) => {
    await loadDemo(page);
    let c = await closings(page);
    expect([c['2026-11-12'], c['2026-11-13'], c['2026-11-14'], c['2026-11-15']]).toEqual(['R$ 500,00', 'R$ 1.300,00', '-R$ 700,00', 'R$ 3.300,00']); // demo da S01 intacta

    await nav(page, 'Vendas e recebimentos');
    await page.getByRole('button', { name: 'Carregar vendas fictícias' }).click();
    await expect(page.getByText(/vendas fictícias carregadas: 84 criada/i)).toBeVisible();
    await expect(page.getByText('Faturamento bruto importado').locator('..')).toContainText('R$ 14.580,00');
    await expect(page.getByText('Média diária de vendas').locator('..')).toContainText('R$ 520,71');
    await expect(page.getByText(/6 recebível\(is\) com conciliação pendente/)).toBeVisible();
    await expect(page.getByText(/série curta/i)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/e2e-s02-demo-vendas.png`, fullPage: true });
    // enquanto houver pendência, só as contas importadas entram: a projeção da S01 não muda
    c = await closings(page);
    expect([c['2026-11-12'], c['2026-11-13'], c['2026-11-14'], c['2026-11-15']]).toEqual(['R$ 500,00', 'R$ 1.300,00', '-R$ 700,00', 'R$ 3.300,00']);

    await nav(page, 'Vendas e recebimentos');
    const independents = page.getByRole('button', { name: 'Conta independente de vendas' });
    await expect(independents).toHaveCount(2);
    await independents.first().click();
    await expect(independents).toHaveCount(1);
    await independents.first().click();
    await expect(page.getByText(/conciliação pendente/i).first()).toBeHidden();
    c = await closings(page);
    expect(c['2026-11-12']).toBe('R$ 573,51'); // 500,00 + débito de quarta (R$ 75,00 − 1,99% = R$ 73,51)
    expect(c['2026-11-14']).toBe('-R$ 472,87'); // −700,00 + 73,51 + crédito de 15/10 (R$ 160,00 − R$ 6,38 = R$ 153,62) = −472,87
  });

  test('série curta avisa; hipótese manual é rotulada e não entra no saldo', async ({ page }) => {
    await startOwn(page);
    const days = Array.from({ length: 10 }, (_, i) => `S${i};${String(i + 2).padStart(2, '0')}/11/2026;100,00;pix;`);
    await importSales(page, days);
    await expect(page.getByText(/série curta: 10 dias de histórico/i)).toBeVisible();
    await expect(page.getByText('Média histórica (baseline não validado)')).toBeVisible();
    await page.getByLabel('Faturamento diário esperado (R$)').fill('500,00');
    await page.getByLabel('Dias', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Projetar hipótese' }).click();
    const table = page.getByRole('table', { name: 'Hipótese manual de faturamento' });
    await expect(table.getByText('Hipótese manual — não é previsão validada')).toHaveCount(3);
    await expect(page.getByText('Isto é uma hipótese, não uma previsão')).toBeVisible();
    const c = await closings(page);
    expect(c['2026-11-12']).toBe('R$ 3.000,00');
  });

  test('cada risco revela lançamentos, origem e hipóteses', async ({ page }) => {
    await loadDemo(page);
    const section = page.getByRole('region', { name: /por que há risco/i });
    await section.getByText('14/11/2026 · Saldo negativo').click();
    const details = section.locator('details[data-date="2026-11-14"]');
    await expect(details).toContainText('Aluguel fictício');
    await expect(details).toContainText('Demonstração fictícia');
    await expect(details).toContainText('Saldo de abertura R$ 1.300,00');
    await expect(details).toContainText('Saldo de fechamento -R$ 700,00');
    await expect(details).toContainText('Déficit para o mínimo: R$ 1.700,00');
    await expect(section).toContainText('Nenhuma previsão manual ou hipótese entra neste saldo');
    await page.screenshot({ path: `${SHOTS}/e2e-s02-explicacao-risco.png`, fullPage: true });
  });
});

test.describe('responsividade e acessibilidade da vista Vendas e recebimentos', () => {
  const VIEWPORTS = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ] as const;

  for (const vp of VIEWPORTS) {
    test(`${vp.name}: sem rolagem horizontal, sem erro de console, alvos ≥ 44px e capturas`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      await loadDemo(page);
      await nav(page, 'Vendas e recebimentos');
      await expect(page.getByRole('heading', { level: 1, name: 'Vendas e recebimentos' })).toBeVisible();
      await page.getByRole('button', { name: 'Carregar vendas fictícias' }).click();
      await expect(page.getByText(/vendas fictícias carregadas/i)).toBeVisible();
      for (const h of ['Faturamento bruto', 'Recebimentos previstos líquidos', 'Saldo projetado']) {
        await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
      }
      expect(await hasHorizontalScroll(page), `${vp.name} vendas`).toBe(false);
      await page.screenshot({ path: `${SHOTS}/${vp.name}-vendas.png`, fullPage: true });
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
      await nav(page, 'Visão geral');
      expect(await hasHorizontalScroll(page), `${vp.name} visão geral com explicação`).toBe(false);
      await page.screenshot({ path: `${SHOTS}/${vp.name}-visao-geral-s02.png`, fullPage: true });
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test('teclado: resolução de pendência e abertura da explicação de risco funcionam sem mouse', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Vendas e recebimentos');
    await page.getByRole('button', { name: 'Carregar vendas fictícias' }).click();
    const target = page.getByRole('button', { name: 'Conta independente de vendas' }).first();
    await target.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Conta independente de vendas' })).toHaveCount(1);
    await nav(page, 'Visão geral');
    const summary = page.getByRole('region', { name: /por que há risco/i }).locator('summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary.locator('..')).toHaveAttribute('open', '');
  });
});
