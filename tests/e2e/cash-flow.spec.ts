import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'docs/evidencias/capturas';
const CSV_HEADER = 'tipo;descricao;valor;vencimento;categoria;identificador_externo';
const csv = (rows: string[], name = 'contas.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from(`${CSV_HEADER}\n${rows.join('\n')}`, 'utf-8') });

/** Saldos esperados do contrato demo-s01.md (referência independente do app). */
const EXPECTED: Array<[string, string, string]> = [
  ['2026-11-12', '12/11/2026', 'R$ 500,00'],
  ['2026-11-13', '13/11/2026', 'R$ 1.300,00'],
  ['2026-11-14', '14/11/2026', '-R$ 700,00'],
  ['2026-11-15', '15/11/2026', 'R$ 3.300,00'],
];

async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explorar demonstração' }).click();
  await expect(page.getByText('Saldo informado em 11/11/2026')).toBeVisible();
}
async function nav(page: Page, name: 'Visão geral' | 'Movimentações' | 'Calendário') {
  const toggle = page.getByRole('button', { name: 'Abrir menu' });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name }).click();
}
const hasHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const tableRow = (page: Page, iso: string) => page.locator(`tr[data-date="${iso}"]`);

test.describe('primeiro acesso e demonstração', () => {
  test('onboarding sem dados; nada é carregado sem clique; demo mostra saldos calculados e o déficit de R$ 1.700', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /seu caixa, sem surpresas/i })).toBeVisible();
    await expect(page.getByText('Dados fictícios', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/e2e-onboarding.png` });

    await page.getByRole('button', { name: 'Explorar demonstração' }).click();
    await expect(page.getByText('Dados fictícios', { exact: true })).toBeVisible();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Saldo projetado negativo em 14/11/2026');
    await expect(alert).toContainText('R$ 1.700,00');
    await expect(page.getByText('Saldo informado em 11/11/2026')).toBeVisible();
    await expect(page.getByText('R$ 3.000,00', { exact: true })).toBeVisible();
    await expect(page.getByText('Menor saldo projetado')).toBeVisible();
  });

  test('dashboard, gráfico, tabela e calendário exibem os MESMOS saldos do contrato', async ({ page }) => {
    await loadDemo(page);
    await page.getByRole('button', { name: /mostrar tabela de valores/i }).click();
    const chart = page.getByRole('group', { name: /gráfico do saldo projetado/i });
    await chart.focus();
    for (const [index, [iso, br, balance]] of EXPECTED.entries()) {
      // tabela
      await expect(tableRow(page, iso)).toContainText(balance);
      // gráfico (tooltip por teclado)
      await page.keyboard.press('ArrowRight');
      const tip = page.locator('.cf-chart__tip');
      await expect(tip).toContainText(br);
      await expect(tip).toContainText(balance);
      // calendário
      await expect(page.getByRole('button', { name: new RegExp(`^${br.replace(/\//g, '\\/')}, saldo ${balance.replace(/[$]/g, '\\$')}`) })).toBeVisible();
      expect(index).toBeLessThan(4);
    }
    await expect(tableRow(page, '2026-12-11')).toContainText('R$ 3.300,00');
    await expect(page.locator('tbody tr[data-date]')).toHaveCount(30);
    await expect(tableRow(page, '2026-11-14')).toContainText('Saldo negativo');
    await expect(tableRow(page, '2026-11-12')).toContainText('Abaixo do mínimo');
    await expect(page.locator('rect.cf-chart__mark--neg')).toHaveCount(1);
    await expect(page.locator('circle.cf-chart__mark--warn')).toHaveCount(1);
  });

  test('dados persistem após recarregar a página', async ({ page }) => {
    await loadDemo(page);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Saldo projetado negativo em 14/11/2026');
    await expect(page.getByText('Dados fictícios', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Explorar demonstração' })).toHaveCount(0);
    // a vista também sobrevive ao recarregar (hash)
    await nav(page, 'Movimentações');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Movimentações' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Lançamentos' }).locator('tbody tr')).toHaveCount(4);
  });
});

test.describe('edição recalcula', () => {
  test('editar o aluguel remove o saldo negativo; cadastrar conta grande cria novo risco', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Movimentações');
    await page.getByRole('button', { name: 'Editar Aluguel fictício' }).click();
    await page.getByLabel(/^Valor/).fill('1.000,00');
    await page.getByRole('button', { name: 'Salvar lançamento' }).click();
    await expect(page.getByText('Lançamento atualizado.')).toBeVisible();
    await nav(page, 'Visão geral');
    await expect(page.getByText(/Saldo projetado negativo/)).toHaveCount(0);
    await page.getByRole('button', { name: /mostrar tabela de valores/i }).click();
    await expect(tableRow(page, '2026-11-14')).toContainText('R$ 300,00');

    await nav(page, 'Movimentações');
    await page.getByRole('button', { name: 'Adicionar lançamento' }).click();
    await page.getByLabel(/^Descrição/).fill('Reforma fictícia');
    await page.getByLabel(/^Valor/).fill('5.000,00');
    await page.getByLabel(/^Vencimento/).fill('2026-11-25');
    await page.getByRole('button', { name: 'Salvar lançamento' }).click();
    await expect(page.getByText('Lançamento adicionado.')).toBeVisible();
    await nav(page, 'Visão geral');
    await page.getByRole('button', { name: /mostrar tabela de valores/i }).click();
    // 14/11 = R$ 300; 15/11 +R$ 4.000 = R$ 4.300; 25/11 -R$ 5.000 = -R$ 700 (cálculo independente)
    await expect(tableRow(page, '2026-11-25')).toContainText('-R$ 700,00');
    await expect(page.getByRole('alert')).toContainText('Saldo projetado negativo em 25/11/2026');
  });

  test('alterar saldo inicial recalcula os indicadores', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Movimentações');
    await page.getByRole('button', { name: 'Editar saldos' }).click();
    await page.getByLabel(/^Saldo inicial/).fill('9.000,00');
    await page.getByRole('button', { name: 'Salvar saldos' }).click();
    await nav(page, 'Visão geral');
    await expect(page.getByText('R$ 9.000,00', { exact: true })).toBeVisible();
    await expect(page.getByText(/Saldo projetado negativo/)).toHaveCount(0);
  });

  test('excluir e apagar tudo pedem confirmação; cancelar não apaga', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Movimentações');
    const rows = page.getByRole('table', { name: 'Lançamentos' }).locator('tbody tr');
    await page.getByRole('button', { name: 'Excluir Aluguel fictício' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(rows).toHaveCount(4);

    await page.getByRole('button', { name: 'Excluir Aluguel fictício' }).click();
    await dialog.getByRole('button', { name: 'Excluir' }).click();
    await expect(rows).toHaveCount(3);

    await page.getByRole('button', { name: 'Apagar todos os dados' }).click();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(rows).toHaveCount(3);
    await page.getByRole('button', { name: 'Apagar todos os dados' }).click();
    await dialog.getByRole('button', { name: 'Apagar tudo' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /seu caixa, sem surpresas/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /seu caixa, sem surpresas/i })).toBeVisible();
  });

  test('carregar a demonstração sobre dados existentes pede confirmação', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Movimentações');
    await page.getByRole('button', { name: 'Adicionar lançamento' }).click();
    await page.getByLabel(/^Descrição/).fill('Minha conta');
    await page.getByLabel(/^Valor/).fill('10,00');
    await page.getByLabel(/^Vencimento/).fill('2026-11-20');
    await page.getByRole('button', { name: 'Salvar lançamento' }).click();
    const rows = page.getByRole('table', { name: 'Lançamentos' }).locator('tbody tr');
    await expect(rows).toHaveCount(5);
    await page.getByRole('button', { name: 'Carregar demonstração' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click();
    await expect(rows).toHaveCount(5);
    await page.getByRole('button', { name: 'Carregar demonstração' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /substituir e carregar/i }).click();
    await nav(page, 'Movimentações');
    await expect(rows).toHaveCount(4);
  });
});

test.describe('importação CSV', () => {
  async function startEmpty(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Começar com meus dados' }).click();
    await page.getByLabel(/^Data-base/).fill('2026-11-11');
    await page.getByLabel(/^Saldo inicial/).fill('1.000,00');
    await page.getByLabel(/^Saldo mínimo/).fill('0');
    await page.getByRole('button', { name: 'Salvar saldos' }).click();
    await expect(page.getByText(/nenhum risco detectado/i)).toBeVisible();
    await nav(page, 'Movimentações');
  }
  const rows = [
    'pagar;Fornecedor fictício;100,00;2026-11-12;Insumos;F-1',
    'receber;Venda fictícia;50,00;13/11/2026;;V-1',
    'pagar;;10,00;2026-11-14;;', // linha 4 inválida
  ];

  test('prévia com erro por linha; reimportar o mesmo CSV não altera o saldo', async ({ page }) => {
    await startEmpty(page);
    await page.getByTestId('csv-input').setInputFiles(csv(rows));
    await expect(page.getByText('Prévia da importação')).toBeVisible();
    await expect(page.getByText('2 a importar')).toBeVisible();
    await expect(page.getByRole('table', { name: /linhas com erro/i })).toContainText('Descrição obrigatória');
    await expect(page.getByRole('table', { name: /linhas com erro/i }).locator('tbody tr th')).toHaveText('4');
    await expect(page.getByRole('table', { name: 'Lançamentos' })).toHaveCount(0); // nada gravado antes de confirmar
    await page.screenshot({ path: `${SHOTS}/e2e-importacao-previa.png` });

    await page.getByRole('button', { name: 'Importar 2 lançamento(s)' }).click();
    await expect(page.getByText(/2 criado\(s\)/)).toBeVisible();
    const lancamentos = page.getByRole('table', { name: 'Lançamentos' }).locator('tbody tr');
    await expect(lancamentos).toHaveCount(2);

    const balanceAt = async () => {
      await nav(page, 'Visão geral');
      await page.getByRole('button', { name: /mostrar tabela de valores/i }).click();
      const text = await tableRow(page, '2026-11-13').innerText();
      await nav(page, 'Movimentações');
      return text;
    };
    const first = await balanceAt();
    expect(first).toContain('R$ 950,00'); // 1.000 - 100 + 50

    await page.getByTestId('csv-input').setInputFiles(csv(rows));
    await expect(page.getByText('0 a importar')).toBeVisible();
    await expect(page.getByText('2 já importado(s) ou duplicado(s)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(lancamentos).toHaveCount(2);
    expect(await balanceAt()).toBe(first);

    // a importação sobrevive ao recarregar
    await page.reload();
    await expect(page.getByRole('table', { name: 'Lançamentos' }).locator('tbody tr')).toHaveCount(2);
  });

  test('CSV com cabeçalho inválido é recusado sem gravar', async ({ page }) => {
    await startEmpty(page);
    await page.getByTestId('csv-input').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('coluna_errada\n1') });
    await expect(page.getByText(/colunas obrigatórias ausentes/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar', exact: true })).toBeDisabled();
  });

  test('SHA-256 do importador funciona com ou sem contexto seguro (sem depender de crypto.subtle)', async ({ page }, info) => {
    await startEmpty(page);
    const env = await page.evaluate(() => ({ secure: window.isSecureContext, subtle: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined' }));
    info.annotations.push({ type: 'contexto', description: `isSecureContext=${env.secure}; crypto.subtle=${env.subtle}; baseURL=${String(info.project.use.baseURL)}` });
    if (process.env.E2E_EXPECT_INSECURE === '1') {
      expect(env.secure).toBe(false);
      expect(env.subtle).toBe(false);
    }
    // linhas sem identificador externo usam o hash SHA-256 puro
    await page.getByTestId('csv-input').setInputFiles(csv(['pagar;Sem identificador;10,00;2026-11-12;;']));
    await page.getByRole('button', { name: 'Importar 1 lançamento(s)' }).click();
    await expect(page.getByText(/1 criado\(s\)/)).toBeVisible();
    await page.getByTestId('csv-input').setInputFiles(csv(['pagar;Sem identificador;10,00;2026-11-12;;']));
    await expect(page.getByText('0 a importar')).toBeVisible();
  });
});

test.describe('navegação, teclado e acessibilidade básica', () => {
  test('três vistas e calendário com atalho para a data crítica', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Calendário');
    await expect(page.getByRole('heading', { level: 1, name: 'Calendário' })).toBeVisible();
    await page.getByRole('button', { name: /ir para a próxima data crítica/i }).click();
    await expect(page.getByRole('button', { name: /^12\/11\/2026, saldo R\$ 500,00/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /^14\/11\/2026/ }).click();
    await expect(page.getByText(/faltam R\$ 1\.700,00 para o mínimo/)).toBeVisible();
    await expect(page.getByText(/A pagar: Aluguel fictício/)).toBeVisible();
    await nav(page, 'Movimentações');
    await expect(page.getByRole('heading', { level: 1, name: 'Movimentações' })).toBeVisible();
    // só existem as três vistas
    const items = page.getByRole('navigation', { name: 'Principal' }).getByRole('button');
    await expect(items).toHaveCount(3);
  });

  test('calendário: a data-base é clicável e mostra o saldo informado; dias anteriores ficam inativos', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Calendário');
    const base = page.getByRole('button', { name: /^11\/11\/2026, data-base, saldo informado R\$ 3\.000,00/ });
    await expect(base).toBeVisible();
    await base.click();
    await expect(base).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/Saldo informado ao fim do dia:/)).toContainText('R$ 3.000,00');
    await expect(page.getByText(/conferido por você, não projetado/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^10\/11\/2026/ })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/e2e-calendario-data-base.png` });
  });

  test('foco visível, nomes acessíveis e alvos de toque >= 44px', async ({ page }, info) => {
    await loadDemo(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      return { tag: el.tagName, style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);

    for (const view of ['Visão geral', 'Movimentações', 'Calendário'] as const) {
      await nav(page, view);
      const problems = await page.evaluate(() => {
        const bad: string[] = [];
        document.querySelectorAll('button, input:not([type=file]), select, [role=button]').forEach((el) => {
          const rect = el.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
          if (!visible) return;
          const name = el.getAttribute('aria-label') || (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || '';
          if (!name) bad.push(`sem nome: ${el.outerHTML.slice(0, 80)}`);
          if (rect.height < 43.5) bad.push(`alvo ${Math.round(rect.height)}px: ${name}`);
        });
        return bad;
      });
      info.annotations.push({ type: `a11y-${view}`, description: problems.length ? problems.join(' | ') : 'ok' });
      expect(problems, `vista ${view}`).toEqual([]);
    }
  });

  test('prefers-reduced-motion desativa transições', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/');
    const duration = await page.getByRole('button', { name: 'Explorar demonstração' }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
    await ctx.close();
  });
});

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

test.describe('responsividade (390×844, 768×1024, 1440×900)', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: sem rolagem horizontal; capturas das três vistas`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      await loadDemo(page);
      for (const [view, slug] of [['Visão geral', 'visao-geral'], ['Movimentações', 'movimentacoes'], ['Calendário', 'calendario']] as const) {
        await nav(page, view);
        await expect(page.getByRole('heading', { level: 1, name: view })).toBeVisible();
        expect(await hasHorizontalScroll(page), `${vp.name}/${view}`).toBe(false);
        await page.screenshot({ path: `${SHOTS}/${vp.name}-${slug}.png`, fullPage: true });
      }
      if (vp.width < 1024) {
        // menu em gaveta: abre, Escape fecha e devolve o foco
        await page.getByRole('button', { name: 'Abrir menu' }).click();
        await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: 'Visão geral' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeFocused();
      }
      // zoom 200% = metade da largura em CSS px, respeitando o piso de 320px do WCAG 1.4.10 (reflow).
      // Em 390px, 200% daria 195px (< 320px): limitação conhecida, registrada em docs/evidencias/s01-visual.md.
      await page.setViewportSize({ width: Math.max(320, Math.round(vp.width / 2)), height: vp.height });
      for (const view of ['Visão geral', 'Movimentações', 'Calendário'] as const) {
        await nav(page, view);
        expect(await hasHorizontalScroll(page), `${vp.name} zoom/reflow ${view}`).toBe(false);
      }
      await ctx.close();
    });
  }

  test('estados: sem dados (onboarding), sem risco, abaixo do mínimo e negativo', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Começar com meus dados' }).click();
    await page.screenshot({ path: `${SHOTS}/estado-sem-saldos.png` });
    await page.getByLabel(/^Data-base/).fill('2026-11-11');
    await page.getByLabel(/^Saldo inicial/).fill('500,00');
    await page.getByLabel(/^Saldo mínimo/).fill('1.000,00');
    await page.getByRole('button', { name: 'Salvar saldos' }).click();
    await expect(page.getByText('Risco de ficar abaixo do mínimo em 12/11/2026').first()).toBeVisible();
    await expect(page.getByText(/Déficit para o mínimo: R\$ 500,00/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/estado-abaixo-minimo.png` });
    await page.getByRole('button', { name: 'Movimentações' }).click();
    await page.getByRole('button', { name: 'Editar saldos' }).click();
    await page.getByLabel(/^Saldo inicial/).fill('5.000,00');
    await page.getByRole('button', { name: 'Salvar saldos' }).click();
    await page.getByRole('button', { name: 'Visão geral' }).click();
    await expect(page.getByText(/nenhum risco detectado/i)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/estado-sem-risco.png` });
    await ctx.close();
  });
});
