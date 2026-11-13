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
/** Conteúdo completo do IndexedDB (todas as stores): prova que nenhuma decisão avançada gravou algo. */
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
const panel = (page: Page, title: string) => page.locator('details.cf-advanced__panel').filter({ has: page.locator('summary', { hasText: title }) });
const openPanel = async (page: Page, title: string) => {
  const details = panel(page, title);
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  return details;
};
const dataLabelled = (page: Page, text: string) => page.getByLabel(text, { exact: true });

async function addCashPurchase(page: Page) {
  await openPanel(page, 'Compra de equipamento');
  await dataLabelled(page, 'O que será comprado').fill('Forno combinado');
  await dataLabelled(page, 'Valor da compra (R$)').fill('1.000,00');
  await dataLabelled(page, 'Data do pagamento').fill('2026-11-20');
  await page.getByRole('button', { name: 'Adicionar hipótese de compra' }).click();
}
async function addHiring(page: Page, { charges = '70', fixed = '300,00' } = {}) {
  await openPanel(page, 'Contratação');
  await dataLabelled(page, 'Função (cargo)').fill('Auxiliar de cozinha');
  await dataLabelled(page, 'Custo mensal informado (R$)').fill('2.000,00');
  await dataLabelled(page, 'Encargos informados (%) — opcional').fill(charges);
  await dataLabelled(page, 'Outros custos mensais fixos (R$) — opcional').fill(fixed);
  await dataLabelled(page, 'Dia do pagamento (1 a 31)').fill('5');
  await dataLabelled(page, 'Data inicial').fill('2026-11-20');
  await page.getByRole('button', { name: 'Adicionar hipótese de contratação' }).click();
}
async function addVendorShift(page: Page, entryId: string, newDate: string) {
  await openPanel(page, 'Vencimento de fornecedor');
  await dataLabelled(page, 'Conta a pagar').selectOption(entryId);
  await dataLabelled(page, 'Nova data de vencimento').fill(newDate);
  await page.getByRole('button', { name: 'Adicionar hipótese de novo vencimento' }).click();
}
async function addAdvance(page: Page, entryId: string, date: string, rate: string) {
  await openPanel(page, 'Antecipação de recebimento');
  await dataLabelled(page, 'Recebimento a antecipar').selectOption(entryId);
  await dataLabelled(page, 'Data da antecipação').fill(date);
  await dataLabelled(page, 'Taxa informada ao mês (%)').fill(rate);
  await page.getByRole('button', { name: 'Simular antecipação' }).click();
}

test.describe('Sprint 6 — simulações avançadas (hipóteses, sem ação financeira real)', () => {
  test('compra à vista: custo em texto antes; só a Alternativa muda; o banco fica idêntico', async ({ page }) => {
    const errors = consoleErrors(page);
    await loadDemo(page);
    const dbBefore = await dumpDb(page);
    await nav(page, 'Simulador');
    await openPanel(page, 'Compra de equipamento');
    await dataLabelled(page, 'O que será comprado').fill('Forno combinado');
    await dataLabelled(page, 'Valor da compra (R$)').fill('1.000,00');
    await dataLabelled(page, 'Data do pagamento').fill('2026-11-20');
    await expect(page.getByRole('form', { name: 'Hipótese de compra de equipamento' })).toContainText('principal R$ 1.000,00 + encargos R$ 0,00 = total R$ 1.000,00; 1 pagamento de R$ 1.000,00 em 20/11/2026');
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' })).toHaveCount(0); // a prévia em texto veio antes de qualquer hipótese
    await page.getByRole('button', { name: 'Adicionar hipótese de compra' }).click();
    // à mão (demo S01): a base fecha 15/11 em R$ 3.300,00 e fica assim até 11/12; a compra de R$ 1.000 em 20/11 leva a R$ 2.300,00
    await expect(cell(page, '2026-11-19', 'Alternativa (hipótese)')).toContainText('R$ 3.300,00');
    await expect(cell(page, '2026-11-20', 'Alternativa (hipótese)')).toContainText('R$ 2.300,00');
    await expect(cell(page, '2026-11-20', 'Original')).toContainText('R$ 3.300,00');
    await expect(cell(page, '2026-11-20', 'Diferença')).toHaveText('-R$ 1.000,00');
    await expect(page.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' })).toContainText('Nenhum pagamento é feito');
    expect(await dumpDb(page)).toBe(dbBefore);
    expect(errors).toEqual([]);
  });

  test('compra parcelada: principal + encargos fecham; parcelas fora do horizonte são ditas', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Simulador');
    await openPanel(page, 'Compra de equipamento');
    await dataLabelled(page, 'O que será comprado').fill('Forno combinado');
    await dataLabelled(page, 'Valor da compra (R$)').fill('10.000,00');
    await dataLabelled(page, 'Forma de pagamento').selectOption('installments');
    await dataLabelled(page, 'Data da primeira parcela').fill('2026-11-16');
    await dataLabelled(page, 'Número de parcelas').fill('3');
    await dataLabelled(page, 'Juros ao mês (%)').fill('2');
    // à mão: PMT = R$ 3.467,55; 3.467,55 + 3.467,55 + 3.467,54 = R$ 10.402,64 (encargos R$ 402,64)
    await expect(page.getByRole('form', { name: 'Hipótese de compra de equipamento' })).toContainText('principal R$ 10.000,00 + encargos R$ 402,64 = total R$ 10.402,64');
    await page.getByRole('button', { name: 'Adicionar hipótese de compra' }).click();
    const created = page.getByRole('table', { name: 'Lançamentos hipotéticos criados' });
    await expect(created.locator('tbody tr')).toHaveCount(3);
    await expect(created).toContainText('-R$ 3.467,54');
    await expect(created.getByText('Fora do horizonte')).toHaveCount(2); // 16/12 e 16/01 passam de 30 dias
    await expect(page.getByText(/2 parcela\(s\) \(R\$ 6\.935,09\) vence\(m\) depois do horizonte/).first()).toBeVisible();
    await expect(cell(page, '2026-11-16', 'Alternativa (hipótese)')).toContainText('-R$ 167,55'); // 3.300 − 3.467,55
  });

  test('contratação: nenhum custo antes da data inicial; premissa trabalhista visível; hipótese incompleta sinalizada', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Simulador');
    await openPanel(page, 'Contratação');
    await expect(page.getByText(/esta tela não calcula legislação trabalhista/)).toBeVisible();
    await addHiring(page);
    // R$ 2.000 + 70% (R$ 1.400) + R$ 300 = R$ 3.700 por mês; 1º pagamento 05/12 (o dia 5 de novembro é antes da data inicial)
    await expect(cell(page, '2026-12-04', 'Diferença')).toHaveText('R$ 0,00');
    await expect(cell(page, '2026-12-05', 'Diferença')).toHaveText('-R$ 3.700,00');
    await expect(cell(page, '2026-12-05', 'Alternativa (hipótese)')).toContainText('-R$ 400,00');
    await expect(page.getByText(/hipótese incompleta — não foram informados/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Voltar ao original' }).click();
    await addHiring(page, { charges: '', fixed: '' });
    await expect(page.getByText(/hipótese incompleta — não foram informados: encargos \(%\) e outros custos mensais fixos/)).toBeVisible();
    await expect(cell(page, '2026-12-05', 'Diferença')).toHaveText('-R$ 2.000,00');
  });

  test('vencimento de fornecedor: só a data muda (trilha de → para) e o risco de 14/11 some', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Simulador');
    await addVendorShift(page, 'demo-despesa-02', '2026-11-21');
    await expect(page.getByRole('list', { name: 'Mudanças em lançamentos existentes' })).toContainText('data de 14/11/2026 para 21/11/2026');
    await expect(cell(page, '2026-11-14', 'Original')).toContainText('-R$ 700,00');
    await expect(cell(page, '2026-11-14', 'Alternativa (hipótese)')).toContainText('R$ 1.300,00'); // −700 + 2.000
    await expect(cell(page, '2026-11-14', 'Diferença')).toHaveText('+R$ 2.000,00');
    await expect(cell(page, '2026-11-21', 'Diferença')).toHaveText('R$ 0,00'); // a saída chega e iguala a base
    await expect(page.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' })).toContainText('só a data muda');
  });

  test('antecipação: líquido e custo em texto; o recebimento futuro sai e o líquido entra uma vez; Voltar ao original', async ({ page }) => {
    const errors = consoleErrors(page);
    await loadDemo(page);
    const dbBefore = await dumpDb(page);
    await nav(page, 'Simulador');
    await openPanel(page, 'Antecipação de recebimento');
    await expect(dataLabelled(page, 'Taxa informada ao mês (%)')).toHaveValue('');
    await expect(page.getByText(/Exemplo ilustrativo, que não é taxa de mercado/)).toBeAttached();
    await dataLabelled(page, 'Recebimento a antecipar').selectOption('demo-receita-02');
    await dataLabelled(page, 'Data da antecipação').fill('2026-11-13');
    await dataLabelled(page, 'Taxa informada ao mês (%)').fill('1');
    // à mão: 400000 × 100 × 2 / 300000 = 266,67 → custo R$ 2,67; líquido R$ 3.997,33
    await expect(page.getByRole('form', { name: 'Hipótese de antecipação de recebimento' })).toContainText('custo R$ 2,67');
    await expect(page.getByRole('form', { name: 'Hipótese de antecipação de recebimento' })).toContainText('R$ 3.997,33 líquidos em 13/11/2026');
    await page.getByRole('button', { name: 'Simular antecipação' }).click();
    await expect(cell(page, '2026-11-13', 'Alternativa (hipótese)')).toContainText('R$ 5.297,33'); // 500 + 800 + 3.997,33
    await expect(cell(page, '2026-11-14', 'Diferença')).toHaveText('+R$ 3.997,33');
    await expect(cell(page, '2026-11-15', 'Diferença')).toHaveText('-R$ 2,67'); // do vencimento em diante só sobra o custo
    await expect(cell(page, '2026-12-11', 'Diferença')).toHaveText('-R$ 2,67'); // nunca os dois
    await expect(page.getByRole('list', { name: 'Mudanças em lançamentos existentes' })).toContainText('retirado da data original (15/11/2026)');
    expect(await dumpDb(page)).toBe(dbBefore);
    await page.getByRole('button', { name: 'Voltar ao original' }).click();
    await expect(cell(page, '2026-11-15', 'Diferença')).toHaveText('R$ 0,00');
    await expect(page.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' })).toHaveCount(0);
    expect(await dumpDb(page)).toBe(dbBefore);
    expect(errors).toEqual([]);
  });

  test('as quatro decisões e um atraso da S05 coexistem na mesma Alternativa, com a conferência dos 30 dias', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Simulador');
    await dataLabelled(page, 'Recebimento').selectOption('demo-receita-01');
    await dataLabelled(page, 'Atraso (dias corridos)').fill('1');
    await page.getByRole('button', { name: 'Adicionar atraso' }).click();
    await addCashPurchase(page);
    await addHiring(page);
    await addVendorShift(page, 'demo-despesa-02', '2026-11-21');
    await addAdvance(page, 'demo-receita-02', '2026-11-13', '1');
    await expect(page.getByRole('list', { name: 'Hipóteses ativas' }).locator('li')).toHaveCount(5);
    await expect(page.getByText(/Conferido: nos 30 dias, Original \+ Diferença = Alternativa/)).toBeVisible();
    // à mão em 05/12: 3.300 (base) − 2,67 (custo da antecipação) − 1.000 (forno em 20/11) − 3.700 (contratação) = −1.402,67
    await expect(cell(page, '2026-12-05', 'Diferença')).toHaveText('-R$ 4.702,67');
    await expect(cell(page, '2026-12-05', 'Alternativa (hipótese)')).toContainText('-R$ 1.402,67');
    // nenhum botão da tela sugere executar algo real
    const buttons = (await page.getByRole('button').allInnerTexts()).join(' | ');
    expect(buttons).not.toMatch(/executar|transferir|antecipar|contratar|pagar|confirmar|aplicar|comprar/i);
  });

  test('teclado: o painel abre com Enter e os campos são alcançados com Tab, com foco visível', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Simulador');
    const summary = page.locator('summary', { hasText: 'Vencimento de fornecedor' });
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel(page, 'Vencimento de fornecedor')).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    await expect(dataLabelled(page, 'Conta a pagar')).toBeFocused();
    const outline = await dataLabelled(page, 'Conta a pagar').evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
    expect(outline).not.toMatch(/^none/);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter'); // fecha de novo
    await expect(panel(page, 'Vencimento de fornecedor')).not.toHaveAttribute('open', '');
  });

  const viewports = [
    { tag: '390x844', width: 390, height: 844, narrow: true },
    { tag: '768x1024', width: 768, height: 1024, narrow: false },
    { tag: '1440x900', width: 1440, height: 900, narrow: false },
  ] as const;
  for (const vp of viewports) {
    test(`responsivo ${vp.tag}: painéis, texto de custos/datas e comparação sem rolagem horizontal, alvos ≥ 44 px e nomes acessíveis`, async ({ page }) => {
      const errors = consoleErrors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loadDemo(page);
      await nav(page, 'Simulador');
      await openPanel(page, 'Compra de equipamento');
      await page.locator('details.cf-advanced__panel').filter({ has: page.locator('summary', { hasText: 'Compra de equipamento' }) }).screenshot({ path: `${SHOTS}/e2e-s06-painel-compra-aberto-${vp.tag}.png` });
      await dataLabelled(page, 'O que será comprado').fill('Forno combinado');
      await dataLabelled(page, 'Valor da compra (R$)').fill('10.000,00');
      await dataLabelled(page, 'Forma de pagamento').selectOption('installments');
      await dataLabelled(page, 'Data da primeira parcela').fill('2026-11-16');
      await dataLabelled(page, 'Número de parcelas').fill('3');
      await dataLabelled(page, 'Juros ao mês (%)').fill('2');
      await page.getByRole('button', { name: 'Adicionar hipótese de compra' }).click();
      await addHiring(page);
      await addVendorShift(page, 'demo-despesa-02', '2026-11-21');
      await addAdvance(page, 'demo-receita-02', '2026-11-13', '1');
      await expect(page.getByRole('list', { name: 'Hipóteses ativas' }).locator('li')).toHaveCount(4);
      await expect(page.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' })).toBeVisible();

      await page.getByRole('region', { name: 'Custos, datas e mudanças desta hipótese' }).screenshot({ path: `${SHOTS}/e2e-s06-custos-datas-${vp.tag}.png` });
      if (vp.narrow) {
        const tabs = page.getByRole('tablist', { name: /Escolha o que ver/ });
        await expect(tabs.getByRole('tab', { name: 'Original' })).toHaveAttribute('aria-selected', 'true');
        await tabs.getByRole('tab', { name: 'Alternativa (hipótese)' }).click();
        await expect(cell(page, '2026-11-16', 'Alternativa (hipótese)')).toBeVisible();
        await expect(cell(page, '2026-11-16', 'Diferença')).toBeVisible();
      } else {
        await expect(table(page).getByRole('columnheader', { name: 'Alternativa (hipótese)' })).toBeVisible();
      }
      await compareCard(page).screenshot({ path: `${SHOTS}/e2e-s06-comparacao-${vp.tag}.png` });
      await page.screenshot({ path: `${SHOTS}/e2e-s06-simulador-${vp.tag}.png`, fullPage: true });

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
        overflowing: [...document.querySelectorAll('main *')].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0 && (el as HTMLElement).offsetParent !== null && !el.closest('svg') && el.tagName !== 'TABLE').length,
      }));
      expect(m.page, 'rolagem horizontal da página').toBe(0);
      for (const wrap of m.wraps) expect(wrap.over, `tabela ${wrap.name}`).toBe(0);
      expect(m.smallTargets, 'alvos < 44px').toEqual([]);
      expect(m.unnamed, 'controles sem nome').toBe(0);
      expect(errors).toEqual([]);
    });
  }
});
