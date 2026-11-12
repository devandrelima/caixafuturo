import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOTS = 'docs/evidencias/capturas';
type ViewName = 'Visão geral' | 'Movimentações' | 'Vendas e recebimentos' | 'Previsões' | 'Calendário';

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
async function loadRecurring(page: Page) {
  await nav(page, 'Calendário');
  await page.getByRole('button', { name: 'Carregar recorrências fictícias' }).click();
  await expect(page.getByRole('table', { name: 'Regras de recorrência' })).toBeVisible();
}
const weekClosings = (page: Page) =>
  page.getByRole('table', { name: 'Fluxo de caixa por semana' }).locator('tbody tr').evaluateAll((rows) => rows.map((r) => (r.children[3] as HTMLElement).innerText));
const consoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
};

test.describe('Sprint 4 — recorrências, 13 semanas, filtros e detalhe', () => {
  test('Calendário: 13 semanas da demo sem recorrências (15/11 = R$ 3.300,00 como na S01), ressalva e premissas', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Calendário');
    await expect(page.getByRole('heading', { level: 1, name: 'Calendário' })).toBeVisible();
    const closings = await weekClosings(page);
    expect(closings).toHaveLength(13);
    expect(closings[0]).toBe('R$ 3.300,00');
    await expect(page.getByText('Quanto mais longe, maior a incerteza')).toBeVisible();
    await expect(page.getByText('Nunca entram previsão de faturamento nem hipóteses manuais.')).toBeVisible();
    await expect(page.getByText('Nenhuma recorrência ainda.', { exact: false })).toBeVisible();
  });

  test('recorrências fictícias: saldos das 13 semanas conferem com a conta à mão; dia 31, data final e liquidada; persiste ao recarregar', async ({ page }) => {
    await loadDemo(page);
    await loadRecurring(page);
    expect(await weekClosings(page)).toEqual(['R$ 4.500,00', 'R$ 4.150,00', 'R$ 3.800,00', 'R$ 1.650,00', 'R$ 1.300,00', 'R$ 1.550,00', 'R$ 1.200,00', '-R$ 950,00', '-R$ 1.300,00', '-R$ 1.650,00', '-R$ 2.600,00', '-R$ 4.750,00', '-R$ 5.100,00']);
    // semana 8 (28/12–03/01) termina em −950,00 e o alerta em TEXTO aponta o dia 31/12
    await expect(page.getByRole('table', { name: 'Fluxo de caixa por semana' }).locator('[data-week="8"]')).toContainText('Saldo negativo em 31/12: -R$ 950,00');
    // condomínio dia 31: 30/11, 31/12 e 31/01
    const next = page.getByRole('table', { name: 'Próximas ocorrências calculadas' });
    await expect(next.getByText('30/11/2026')).toHaveCount(2); // condomínio + fornecedor
    await expect(page.getByText('Ocorrências que já existem como lançamento (1)')).toBeVisible();
    await page.reload();
    await nav(page, 'Calendário');
    await expect(page.getByRole('table', { name: 'Regras de recorrência' }).locator('tbody tr')).toHaveCount(4);
    expect((await weekClosings(page))[12]).toBe('-R$ 5.100,00');
  });

  test('pular uma data e excluir uma regra (com confirmação) recalculam; o liquidado permanece em Movimentações', async ({ page }) => {
    await loadDemo(page);
    await loadRecurring(page);
    await page.getByRole('button', { name: 'Pular Condomínio fictício (dia 31) em 30/11/2026' }).click();
    await expect(page.getByText('Ocorrência de 30/11/2026 pulada')).toBeVisible();
    expect((await weekClosings(page))[3]).toBe('R$ 3.450,00'); // 3.800 − 350; sem os 1.800 do condomínio
    await page.getByRole('button', { name: 'Excluir recorrência Seguro fictício' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Lançamentos já gravados ou liquidados permanecem');
    await dialog.getByRole('button', { name: 'Excluir recorrência' }).click();
    await expect(page.getByText('Recorrência excluída.')).toBeVisible();
    await nav(page, 'Movimentações');
    await page.getByLabel('Origem', { exact: true }).selectOption('Recorrente');
    await expect(page.getByTestId('entries-summary')).toContainText('liquidado');
    await expect(page.getByRole('table', { name: 'Lançamentos' }).getByText('Liquidado')).toHaveCount(1);
  });

  test('Movimentações: filtro muda só a lista; somatório = linhas visíveis; alerta global permanece; Limpar filtros; teclado', async ({ page }) => {
    await loadDemo(page);
    await loadRecurring(page);
    await nav(page, 'Movimentações');
    const status = page.getByTestId('filter-status');
    await expect(status).toContainText('Sem filtros — mostrando todos os 24 lançamentos.');
    await page.getByLabel('Categoria', { exact: true }).selectOption('Fixas');
    // condomínio ×3 (1.800) + seguro ×2 calculados (600) + 1 liquidado de R$ 580 = 5.400 + 1.200 + 580 = 7.180
    await expect(status).toContainText('Filtro ativo — mostrando 6 de 24 lançamentos.');
    await expect(page.getByText('Categoria: Fixas')).toBeVisible();
    const summary = page.getByTestId('entries-summary');
    await expect(summary).toContainText('6 lançamentos listados');
    await expect(summary).toContainText('saídas R$ 7.180,00');
    const rows = page.getByRole('table', { name: 'Lançamentos' }).locator('tbody tr[data-entry-id]');
    await expect(rows).toHaveCount(6);
    // soma das linhas visíveis (lida da tela) = valor do somatório
    const values = await rows.evaluateAll((rs) => rs.map((r) => (r.children[4] as HTMLElement).innerText));
    const cents = values.reduce((a, v) => a + Number(v.replace(/[^\d]/g, '')), 0);
    expect(cents).toBe(718000);
    // o alerta global continua visível e é do CÁLCULO COMPLETO, não do filtro
    await expect(page.getByText('Alerta de saldo (não filtrado)')).toBeVisible();
    await expect(page.getByText(/Saldo projetado negativo em 14\/11\/2026/)).toBeVisible();
    // teclado: foca "Limpar filtros" e aciona com Enter
    await page.getByRole('button', { name: 'Limpar filtros' }).focus();
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Sem filtros');
    await expect(rows).toHaveCount(24);
  });

  test('detalhe rastreável por teclado: de onde vem o saldo e a chave de origem; <details> das semanas abre com Enter', async ({ page }) => {
    await loadDemo(page);
    await loadRecurring(page);
    await nav(page, 'Movimentações');
    const toggle = page.getByRole('button', { name: /Detalhes de Condomínio fictício \(dia 31\) em 30\/11\/2026/ });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = page.getByTestId('entry-detail');
    await expect(detail).toContainText('Entra no saldo de 30/11/2026 (fechamento do dia: R$ 1.650,00');
    await expect(detail).toContainText('rec:demo-rec-condominio:2026-11-30');
    await nav(page, 'Calendário');
    const summary = page.locator('[data-week-detail="8"] > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-week-detail="8"]')).toHaveJSProperty('open', true);
    await expect(page.locator('[data-week-detail="8"]')).toContainText('rec:demo-rec-condominio:2026-12-31');
  });

  test('cadastrar recorrência mensal no dia 31 pelo formulário e ver 28/02 no horizonte', async ({ page }) => {
    await loadDemo(page);
    await nav(page, 'Calendário');
    await page.getByRole('button', { name: 'Nova recorrência' }).click();
    await page.getByLabel('Descrição', { exact: false }).fill('Plano mensal teste');
    await page.getByLabel('Valor (R$)', { exact: false }).fill('100,00');
    await page.getByLabel('Data inicial', { exact: false }).fill('2026-10-31');
    await expect(page.getByText(/nos meses em que esse dia não existe/)).toBeVisible();
    await page.getByRole('button', { name: 'Salvar recorrência' }).click();
    await expect(page.getByText('Recorrência salva')).toBeVisible();
    const next = page.getByRole('table', { name: 'Próximas ocorrências calculadas' });
    await expect(next.locator('tbody tr').nth(0)).toContainText('30/11/2026');
    await expect(next.locator('tbody tr').nth(1)).toContainText('31/12/2026');
    await expect(next.locator('tbody tr').nth(2)).toContainText('31/01/2027');
  });

  test('migração real do IndexedDB v2 → v3 no Chromium: dados do usuário preservados, store nova criada, regra gravada', async ({ page }) => {
    await page.route('**/__seed__', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }));
    await page.goto('/__seed__');
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('caixafuturo', 2);
          req.onupgradeneeded = () => {
            const db = req.result;
            db.createObjectStore('settings', { keyPath: 'key' });
            db.createObjectStore('entries', { keyPath: 'id' }).createIndex('sourceKey', 'sourceKey', { unique: true });
            db.createObjectStore('meta', { keyPath: 'key' });
            db.createObjectStore('sales', { keyPath: 'id' }).createIndex('saleKey', 'saleKey', { unique: true });
            db.createObjectStore('reconciliation', { keyPath: 'key' });
          };
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['settings', 'entries', 'meta'], 'readwrite');
            tx.objectStore('settings').put({ key: 'cash', baseDate: '2026-11-11', openingBalanceCents: '300000', minimumBalanceCents: '100000' });
            tx.objectStore('entries').put({ id: 'e_v2', direction: 'out', amountCents: '45000', dueDate: '2026-11-20', description: 'Conta criada na v2', category: 'Teste', origin: 'manual', sourceKey: 'manual:e_v2', state: 'scheduled' });
            tx.objectStore('entries').put({ id: 'e_v2_paid', direction: 'out', amountCents: '1000', dueDate: '2026-11-10', description: 'Conta já paga na v2', category: '', origin: 'manual', sourceKey: 'manual:e_v2_paid', state: 'settled', settledAt: '2026-11-10' });
            tx.objectStore('meta').put({ key: 'dataset', kind: 'user' });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.goto('/');
    await nav(page, 'Movimentações');
    await expect(page.getByText('Data-base 11/11/2026')).toBeVisible();
    const table = page.getByRole('table', { name: 'Lançamentos' });
    await expect(table.getByText('Conta criada na v2')).toBeVisible();
    await expect(table.getByText('Conta já paga na v2')).toBeVisible();
    await expect(table.getByText('Liquidado')).toHaveCount(1);
    await nav(page, 'Calendário');
    await page.getByRole('button', { name: 'Nova recorrência' }).click();
    await page.getByLabel('Descrição', { exact: false }).fill('Regra pós-migração');
    await page.getByLabel('Valor (R$)', { exact: false }).fill('10,00');
    await page.getByLabel('Data inicial', { exact: false }).fill('2026-11-15');
    await page.getByRole('button', { name: 'Salvar recorrência' }).click();
    await expect(page.getByText('Recorrência salva')).toBeVisible();
    const info = await page.evaluate(
      () =>
        new Promise<{ version: number; stores: string[]; entries: number; rules: number }>((resolve) => {
          const req = indexedDB.open('caixafuturo');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['entries', 'recurrence'], 'readonly');
            const e = tx.objectStore('entries').count();
            const r = tx.objectStore('recurrence').count();
            tx.oncomplete = () => {
              const out = { version: db.version, stores: [...db.objectStoreNames].sort(), entries: e.result, rules: r.result };
              db.close();
              resolve(out);
            };
          };
        }),
    );
    expect(info).toEqual({ version: 3, stores: ['entries', 'meta', 'recurrence', 'reconciliation', 'sales', 'settings'].sort(), entries: 2, rules: 1 });
  });

  for (const [w, h, tag] of [
    [390, 844, 'mobile'],
    [768, 1024, 'tablet'],
    [1440, 900, 'desktop'],
  ] as const) {
    test(`responsividade e acessibilidade em ${tag} (${w}×${h}): sem rolagem horizontal, alvos ≥ 44 px, nomes acessíveis, sem erro de console`, async ({ page }) => {
      const errors = consoleErrors(page);
      await page.setViewportSize({ width: w, height: h });
      await loadDemo(page);
      await loadRecurring(page);
      for (const view of ['Calendário', 'Movimentações'] as const) {
        await nav(page, view);
        if (view === 'Movimentações') await page.getByLabel('Categoria', { exact: true }).selectOption('Fixas');
        const m = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          wraps: [...document.querySelectorAll('.cf-table-wrap')].map((e) => ({ name: e.querySelector('table')?.getAttribute('aria-label'), over: e.scrollWidth - e.clientWidth })),
          smallTargets: [...document.querySelectorAll('main button, main select, main input, main summary')]
            .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('.cf-visually-hidden') && (el as HTMLInputElement).type !== 'file')
            .map((el) => ({ text: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height) }))
            .filter((x) => x.h < 44),
          unnamed: [...document.querySelectorAll('main button, main select, main input')].filter(
            (el) => (el as HTMLInputElement).type !== 'file' && !(el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.length || (el.textContent ?? '').trim()),
          ).length,
        }));
        expect(m.page, `${view} página`).toBe(0);
        for (const wrap of m.wraps) expect(wrap.over, `${view} tabela ${wrap.name}`).toBe(0);
        expect(m.smallTargets, `${view} alvos < 44px`).toEqual([]);
        expect(m.unnamed, `${view} controles sem nome`).toBe(0);
        await page.screenshot({ path: `${SHOTS}/e2e-s04-${view === 'Calendário' ? 'calendario' : 'movimentacoes'}-${tag}.png`, fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
});
