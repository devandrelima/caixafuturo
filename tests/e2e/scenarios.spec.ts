import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'docs/evidencias/capturas';
type ViewName = 'Visão geral' | 'Movimentações' | 'Vendas e recebimentos' | 'Previsões' | 'Calendário' | 'Simulador';

async function nav(page: Page, name: ViewName) {
  const toggle = page.getByRole('button', { name: 'Abrir menu' });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name }).click();
}
async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explorar demonstração' }).click();
  await expect(page.getByText('Saldo informado em 11/11/2026')).toBeVisible();
}
const consoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
};
/** Conteúdo completo do IndexedDB do app (todas as stores), para provar que a simulação não gravou nada. */
const dumpDb = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('caixafuturo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames].sort();
          const out: Record<string, unknown> = {};
          let pending = names.length;
          if (pending === 0) return resolve('{}');
          for (const name of names) {
            const all = db.transaction(name).objectStore(name).getAll();
            all.onerror = () => reject(all.error);
            all.onsuccess = () => {
              out[name] = all.result;
              pending -= 1;
              if (pending === 0) {
                db.close();
                resolve(JSON.stringify(out));
              }
            };
          }
        };
      }),
  );
const table = (page: Page) => page.getByRole('table', { name: /Saldo por dia/ });
const cell = (page: Page, date: string, label: string) => table(page).locator(`tr[data-date="${date}"] [data-label="${label}"]`);
const compareCard = (page: Page) => page.locator('section.cf-card').filter({ has: page.getByRole('heading', { name: /Original × Alternativa/ }) });

async function addDelay(page: Page, entryId: string, days: string) {
  await page.getByLabel('Recebimento', { exact: true }).selectOption(entryId);
  await page.getByLabel('Atraso (dias corridos)', { exact: true }).fill(days);
  await page.getByRole('button', { name: 'Adicionar atraso' }).click();
}

test.describe('Sprint 5 — simulador de cenários', () => {
  test('atraso de recebível: só a Alternativa muda; a conta à mão confere; o banco fica idêntico; Voltar ao original não perde nada', async ({ page }) => {
    const errors = consoleErrors(page);
    await loadDemo(page);
    const dbBefore = await dumpDb(page);
    await nav(page, 'Simulador');
    await expect(page.getByRole('heading', { level: 1, name: 'Simulador' })).toBeVisible();
    await expect(page.getByText('Tudo aqui é hipótese')).toBeVisible();
    await expect(page.getByText('Nenhuma hipótese ativa')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar ao original' })).toBeDisabled();
    const originalBefore = await table(page).locator('[data-label="Original"]').allInnerTexts();

    // R$ 4.000,00 de 15/11 atrasam 2 dias (→ 17/11). Conta à mão (demo S01): 15/11 e 16/11 ficam em −R$ 700,00; 17/11 volta a R$ 3.300,00.
    await addDelay(page, 'demo-receita-02', '2');
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' })).toContainText('em 2 dias');
    await expect(cell(page, '2026-11-15', 'Original')).toContainText('R$ 3.300,00');
    await expect(cell(page, '2026-11-15', 'Alternativa (hipótese)')).toContainText('-R$ 700,00');
    await expect(cell(page, '2026-11-15', 'Diferença')).toHaveText('-R$ 4.000,00');
    await expect(cell(page, '2026-11-16', 'Diferença')).toHaveText('-R$ 4.000,00');
    await expect(cell(page, '2026-11-17', 'Diferença')).toHaveText('R$ 0,00');
    await expect(page.getByText(/Conferido: nos 30 dias, Original \+ Diferença = Alternativa/)).toBeVisible();
    expect(await table(page).locator('[data-label="Original"]').allInnerTexts()).toEqual(originalBefore); // o Original não mudou
    expect(await dumpDb(page)).toBe(dbBefore); // nada foi gravado

    // o painel real segue com os números da S01
    await nav(page, 'Visão geral');
    await expect(page.getByRole('alert').filter({ hasText: 'R$ 1.700,00' })).toBeVisible();
    await nav(page, 'Simulador'); // hipóteses duram a sessão
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' })).toBeVisible();

    await page.getByRole('button', { name: 'Voltar ao original' }).click();
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' })).toHaveCount(0);
    await expect(page.getByText(/Você está vendo o Original, com todos os seus dados intactos/)).toBeVisible();
    await expect(cell(page, '2026-11-15', 'Diferença')).toHaveText('R$ 0,00');
    expect(await table(page).locator('[data-label="Original"]').allInnerTexts()).toEqual(originalBefore);
    expect(await dumpDb(page)).toBe(dbBefore);
    expect(errors).toEqual([]);
  });

  test('recarregar a página descarta as hipóteses e os dados reais seguem intactos', async ({ page }) => {
    await loadDemo(page);
    const dbBefore = await dumpDb(page);
    await nav(page, 'Simulador');
    await addDelay(page, 'demo-receita-02', '5');
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Simulador' })).toBeVisible();
    await expect(page.getByText('Nenhuma hipótese ativa')).toBeVisible();
    expect(await dumpDb(page)).toBe(dbBefore);
  });

  test('variação de despesas (Aluguel a 110%): diferença −R$ 200,00 a partir de 14/11; trocar a hipótese muda a Alternativa, não o Original', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Simulador');
    const originalBefore = await table(page).locator('[data-label="Original"]').allInnerTexts();
    await page.getByLabel('Categoria de despesa', { exact: true }).selectOption({ label: 'Aluguel' });
    await page.getByLabel('Despesas ficam em (%)', { exact: true }).fill('110');
    await page.getByRole('button', { name: 'Adicionar variação de despesas' }).click();
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' })).toContainText('Despesas de "Aluguel"');
    await expect(cell(page, '2026-11-13', 'Diferença')).toHaveText('R$ 0,00');
    await expect(cell(page, '2026-11-14', 'Diferença')).toHaveText('-R$ 200,00');
    await expect(cell(page, '2026-11-14', 'Alternativa (hipótese)')).toContainText('-R$ 900,00'); // −700 − 200
    await expect(cell(page, '2026-11-15', 'Alternativa (hipótese)')).toContainText('R$ 3.100,00'); // 3.300 − 200
    // trocar a hipótese: remove e coloca fornecedores a 50% (R$ 2.500 → 1.250 em 12/11: +R$ 1.250,00)
    await page.getByRole('button', { name: /Remover hipótese: Despesas de "Aluguel"/ }).click();
    await page.getByLabel('Categoria de despesa', { exact: true }).selectOption({ label: 'Fornecedores' });
    await page.getByLabel('Despesas ficam em (%)', { exact: true }).fill('50');
    await page.getByRole('button', { name: 'Adicionar variação de despesas' }).click();
    await expect(cell(page, '2026-11-12', 'Diferença')).toHaveText('+R$ 1.250,00');
    await expect(cell(page, '2026-11-14', 'Diferença')).toHaveText('+R$ 1.250,00');
    expect(await table(page).locator('[data-label="Original"]').allInnerTexts()).toEqual(originalBefore);
  });

  test('vendas fictícias: variar repasses a 70% reduz o caixa só na Alternativa; "só dias com diferença" filtra sem mudar saldos', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Vendas e recebimentos');
    await page.getByRole('button', { name: 'Carregar vendas fictícias' }).click();
    await expect(page.getByText(/vendas fictícias carregadas: 84 criada/i)).toBeVisible();
    await nav(page, 'Simulador');
    const dbBefore = await dumpDb(page);
    const originalBefore = await table(page).locator('[data-label="Original"]').allInnerTexts();
    await page.getByLabel('Vendas ficam em (%)', { exact: true }).fill('70');
    await page.getByRole('button', { name: 'Adicionar variação de vendas' }).click();
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' })).toContainText('Repasses de vendas');
    const diffs = await table(page).locator('[data-label="Diferença"]').allInnerTexts();
    expect(diffs.some((d) => d.startsWith('-R$'))).toBe(true);
    expect(diffs.every((d) => d.startsWith('-R$') || d === 'R$ 0,00')).toBe(true); // vendas menores nunca melhoram o caixa
    expect(await table(page).locator('[data-label="Original"]').allInnerTexts()).toEqual(originalBefore);
    const changed = await table(page).locator('tr[data-changed="true"]').count();
    await page.getByRole('button', { name: 'Só os dias com diferença' }).click();
    await expect(table(page).locator('tbody tr')).toHaveCount(changed);
    expect(await dumpDb(page)).toBe(dbBefore);
    await expect(page.getByText(/previsão de faturamento não são simuladas/)).toBeAttached();
  });

  test('erros de preenchimento aparecem em texto e não criam hipótese', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Simulador');
    await page.getByRole('button', { name: 'Adicionar atraso' }).click();
    await expect(page.getByText('Escolha o recebimento que vai atrasar.')).toBeVisible();
    await page.getByLabel('Vendas ficam em (%)', { exact: true }).fill('abc');
    await page.getByRole('button', { name: 'Adicionar variação de vendas' }).click();
    await expect(page.getByText('Informe um percentual como 80 ou 80,5 (use vírgula).')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' })).toHaveCount(0);
  });

  const viewports = [
    { tag: '390x844', width: 390, height: 844, narrow: true },
    { tag: '768x1024', width: 768, height: 1024, narrow: false },
    { tag: '1440x900', width: 1440, height: 900, narrow: false },
  ] as const;
  for (const vp of viewports) {
    test(`responsivo ${vp.tag}: ${vp.narrow ? 'abas Original/Alternativa + diferença' : 'colunas lado a lado'}, sem rolagem horizontal, alvos ≥ 44 px e nomes acessíveis`, async ({ page }) => {
      const errors = consoleErrors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loadDemo(page);
      await nav(page, 'Simulador');
      await addDelay(page, 'demo-receita-02', '2');
      await expect(cell(page, '2026-11-15', 'Diferença')).toHaveText('-R$ 4.000,00');

      if (vp.narrow) {
        const tabs = page.getByRole('tablist', { name: /Escolha o que ver/ });
        await expect(tabs.getByRole('tab', { name: 'Original' })).toHaveAttribute('aria-selected', 'true');
        await expect(tabs.getByRole('tab', { name: 'Alternativa (hipótese)' })).toBeVisible();
        await expect(table(page).getByRole('columnheader', { name: 'Alternativa (hipótese)' })).toHaveCount(0);
        await expect(cell(page, '2026-11-15', 'Original')).toContainText('R$ 3.300,00');
        await expect(cell(page, '2026-11-15', 'Diferença')).toBeVisible();
        await compareCard(page).screenshot({ path: `${SHOTS}/e2e-s05-comparacao-aba-original-${vp.tag}.png` });
        await tabs.getByRole('tab', { name: 'Alternativa (hipótese)' }).click();
        await expect(table(page).getByRole('columnheader', { name: 'Original' })).toHaveCount(0);
        await expect(cell(page, '2026-11-15', 'Alternativa (hipótese)')).toContainText('-R$ 700,00');
        await expect(cell(page, '2026-11-15', 'Diferença')).toBeVisible();
        await compareCard(page).screenshot({ path: `${SHOTS}/e2e-s05-comparacao-aba-alternativa-${vp.tag}.png` });
      } else {
        await expect(page.getByRole('tablist')).toHaveCount(0);
        await expect(table(page).getByRole('columnheader', { name: 'Original' })).toBeVisible();
        await expect(table(page).getByRole('columnheader', { name: 'Alternativa (hipótese)' })).toBeVisible();
        await expect(table(page).getByRole('columnheader', { name: 'Diferença' })).toBeVisible();
        await compareCard(page).screenshot({ path: `${SHOTS}/e2e-s05-comparacao-${vp.tag}.png` });
      }
      await page.screenshot({ path: `${SHOTS}/e2e-s05-simulador-${vp.tag}.png`, fullPage: true });

      const m = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wraps: [...document.querySelectorAll('.cf-table-wrap')].map((e) => ({ name: e.querySelector('table')?.getAttribute('aria-label'), over: e.scrollWidth - e.clientWidth })),
        smallTargets: [...document.querySelectorAll('main button, main select, main input, main summary')]
          .filter((el) => (el as HTMLElement).offsetParent !== null && (el as HTMLInputElement).type !== 'file')
          .map((el) => ({ text: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height) }))
          .filter((x) => x.h < 44),
        unnamed: [...document.querySelectorAll('main button, main select, main input')].filter(
          (el) => (el as HTMLInputElement).type !== 'file' && !(el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.length || (el.textContent ?? '').trim()),
        ).length,
      }));
      expect(m.page, 'rolagem horizontal da página').toBe(0);
      for (const wrap of m.wraps) expect(wrap.over, `tabela ${wrap.name}`).toBe(0);
      expect(m.smallTargets, 'alvos < 44px').toEqual([]);
      expect(m.unnamed, 'controles sem nome').toBe(0);
      expect(errors).toEqual([]);
    });
  }
});
