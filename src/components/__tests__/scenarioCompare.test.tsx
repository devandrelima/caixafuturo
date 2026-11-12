import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenarioDemoBase } from '../../demo/scenarioDemo';
import { simulate } from '../../domain/scenarios/engine';
import type { Adjustment, SimulationResult } from '../../domain/scenarios/types';
import { ScenarioCompare, signedBRL } from '../ScenarioCompare';
import { ScenarioPanel } from '../ScenarioPanel';

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));

function mockNarrow(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow && query.includes('767'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}
afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = [] as Adjustment[], onState }: { initial?: Adjustment[]; onState?: (a: Adjustment[]) => void }) {
  const [adjustments, setAdjustments] = useState<Adjustment[]>(initial);
  const base = useState(() => createScenarioDemoBase())[0];
  return (
    <ScenarioPanel
      snapshot={base}
      adjustments={adjustments}
      onChange={(next) => {
        setAdjustments(next);
        onState?.(next);
      }}
    />
  );
}

const table = () => screen.getByRole('table', { name: /Saldo por dia/ });
const row = (date: string) => table().querySelector(`[data-date="${date}"]`) as HTMLElement;
const originalColumn = () => [...table().querySelectorAll('tbody tr')].map((tr) => tr.querySelector('[data-label="Original"]')?.textContent ?? '');

async function addDelay(user: ReturnType<typeof userEvent.setup>, days: string) {
  await user.selectOptions(screen.getByLabelText('Recebimento'), 'cen-conta-01');
  await user.type(screen.getByLabelText('Atraso (dias corridos)'), days);
  await user.click(screen.getByRole('button', { name: 'Adicionar atraso' }));
}

describe('Simulador: sem hipóteses', () => {
  it('Original e Alternativa idênticas, diferença zero, aviso claro e "Voltar ao original" desabilitado', () => {
    render(<Harness />);
    expect(screen.getByText('Nenhuma hipótese ativa')).toBeInTheDocument();
    expect(screen.getByText('Tudo aqui é hipótese')).toBeInTheDocument();
    expect(row('2026-11-13')).toHaveTextContent('R$ 800,00');
    expect(row('2026-11-13').querySelector('[data-label="Diferença"]')).toHaveTextContent('R$ 0,00');
    expect(screen.getByRole('button', { name: 'Voltar ao original' })).toBeDisabled();
  });

  it('a conferência confirma Original + Diferença = Alternativa nos 30 dias', () => {
    render(<Harness />);
    expect(screen.getByText(/Conferido: nos 30 dias, Original \+ Diferença = Alternativa\. A alternativa difere do original em 0 dias\./)).toBeInTheDocument();
  });
});

describe('Simulador: hipóteses mudam só a Alternativa', () => {
  it('atraso de 3 dias: Original intacto, Alternativa e Diferença batem com o cálculo à mão', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const before = originalColumn();
    await addDelay(user, '3');
    expect(await screen.findByRole('list', { name: 'Hipóteses ativas' })).toHaveTextContent('Atrasar "Evento corporativo fictício" (R$ 1.800,00, 14/11/2026) em 3 dias');
    // 14/11: Original R$ 2.600,00 · Alternativa R$ 800,00 · Diferença −R$ 1.800,00
    expect(row('2026-11-14').querySelector('[data-label="Original"]')).toHaveTextContent('R$ 2.600,00');
    expect(row('2026-11-14').querySelector('[data-label="Alternativa (hipótese)"]')).toHaveTextContent('R$ 800,00');
    expect(row('2026-11-14').querySelector('[data-label="Alternativa (hipótese)"]')).toHaveTextContent('Abaixo do mínimo');
    expect(row('2026-11-14').querySelector('[data-label="Diferença"]')).toHaveTextContent('-R$ 1.800,00');
    expect(row('2026-11-17').querySelector('[data-label="Diferença"]')).toHaveTextContent('R$ 0,00');
    expect(originalColumn()).toEqual(before); // o Original não mudou
    expect(screen.getByText(/coloca 2 dia\(s\) a mais em risco \(o primeiro: 14\/11\/2026\)/)).toBeInTheDocument();
    expect(screen.getByText(/difere do original em 3 dias/)).toBeInTheDocument();
  });

  it('trocar a hipótese (novo atraso no mesmo recebimento) substitui a anterior e não soma duas vezes', async () => {
    const user = userEvent.setup();
    const seen: Adjustment[][] = [];
    render(<Harness onState={(a) => seen.push(a)} />);
    await addDelay(user, '3');
    await user.clear(screen.getByLabelText('Atraso (dias corridos)'));
    await user.selectOptions(screen.getByLabelText('Recebimento'), 'cen-conta-01');
    await user.type(screen.getByLabelText('Atraso (dias corridos)'), '1');
    await user.click(screen.getByRole('button', { name: 'Adicionar atraso' }));
    expect(seen[seen.length - 1]).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Hipóteses ativas' })).toHaveTextContent('em 1 dia');
    expect(row('2026-11-14').querySelector('[data-label="Diferença"]')).toHaveTextContent('-R$ 1.800,00');
    expect(row('2026-11-15').querySelector('[data-label="Diferença"]')).toHaveTextContent('R$ 0,00');
  });

  it('variação de despesas (Fornecedores a 110%) e de vendas (70%) aparecem como hipótese, com diferença exata', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Categoria de despesa'), 'c:Fornecedores');
    await user.type(screen.getByLabelText('Despesas ficam em (%)'), '110');
    await user.click(screen.getByRole('button', { name: 'Adicionar variação de despesas' }));
    await user.type(screen.getByLabelText('Vendas ficam em (%)'), '70');
    await user.click(screen.getByRole('button', { name: 'Adicionar variação de vendas' }));
    const list = screen.getByRole('list', { name: 'Hipóteses ativas' });
    expect(list).toHaveTextContent('Despesas de "Fornecedores" de 12/11/2026 a 11/12/2026 ficam em 110%');
    expect(list).toHaveTextContent('Repasses de vendas de 12/11/2026 a 11/12/2026 ficam em 70%');
    // 18/11: −220,00 (despesa de 13/11) −288,03 −576,06 (repasses) = −1.084,09
    expect(row('2026-11-18').querySelector('[data-label="Diferença"]')).toHaveTextContent('-R$ 1.084,09');
    expect(row('2026-11-18').querySelector('[data-label="Original"]')).toHaveTextContent('R$ 3.980,30');
    expect(row('2026-11-18').querySelector('[data-label="Alternativa (hipótese)"]')).toHaveTextContent('R$ 2.896,21');
  });

  it('as diferenças de todos os dias conciliam com os dois saldos exibidos', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await addDelay(user, '3');
    const money = (text: string) => BigInt(text.replace(/[^\d-]/g, '').replace(/^(-?)0*(\d)/, '$1$2'));
    const rows = [...table().querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(30);
    for (const tr of rows) {
      const o = money((tr.querySelector('[data-label="Original"]') as HTMLElement).textContent?.match(/-?R\$ [\d.]+,\d{2}/)?.[0] ?? '');
      const a = money((tr.querySelector('[data-label="Alternativa (hipótese)"]') as HTMLElement).textContent?.match(/-?R\$ [\d.]+,\d{2}/)?.[0] ?? '');
      const d = money((tr.querySelector('[data-label="Diferença"]') as HTMLElement).textContent?.replace(/^\+/, '') ?? '');
      expect(o + d).toBe(a);
    }
  });

  it('"Voltar ao original" remove todas as hipóteses, avisa em texto e o Original continua igual', async () => {
    const user = userEvent.setup();
    const seen: Adjustment[][] = [];
    render(<Harness onState={(a) => seen.push(a)} />);
    const before = originalColumn();
    await addDelay(user, '3');
    await user.click(screen.getByRole('button', { name: 'Voltar ao original' }));
    expect(seen[seen.length - 1]).toEqual([]);
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
    expect(screen.getByText(/Você está vendo o Original, com todos os seus dados intactos/)).toBeInTheDocument();
    expect(originalColumn()).toEqual(before);
    expect(row('2026-11-14').querySelector('[data-label="Diferença"]')).toHaveTextContent('R$ 0,00');
    expect(screen.getByRole('button', { name: 'Voltar ao original' })).toBeDisabled();
  });

  it('remover uma hipótese mantém as outras', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await addDelay(user, '3');
    await user.type(screen.getByLabelText('Vendas ficam em (%)'), '70');
    await user.click(screen.getByRole('button', { name: 'Adicionar variação de vendas' }));
    await user.click(screen.getByRole('button', { name: /Remover hipótese: Atrasar/ }));
    const list = screen.getByRole('list', { name: 'Hipóteses ativas' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('Repasses de vendas');
  });

  it('filtro "só dias com diferença" mostra apenas os dias alterados e não muda os saldos', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await addDelay(user, '3');
    const toggle = screen.getByRole('button', { name: 'Só os dias com diferença' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const rows = [...table().querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.getAttribute('data-date'))).toEqual(['2026-11-14', '2026-11-15', '2026-11-16']);
    await user.click(toggle);
    expect(table().querySelectorAll('tbody tr')).toHaveLength(30);
  });
});

describe('Simulador: validação dos controles', () => {
  it('percentual inválido e período invertido mostram erro e não criam hipótese', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Vendas ficam em (%)'), '80.5');
    await user.click(screen.getByRole('button', { name: 'Adicionar variação de vendas' }));
    expect(screen.getByText('Informe um percentual como 80 ou 80,5 (use vírgula).')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
    await user.clear(screen.getByLabelText('Despesas: de'));
    await user.type(screen.getByLabelText('Despesas: de'), '2026-12-31');
    await user.type(screen.getByLabelText('Despesas ficam em (%)'), '120');
    await user.click(screen.getByRole('button', { name: 'Adicionar variação de despesas' }));
    expect(screen.getByText('O início não pode ser depois do fim.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
  });

  it('atraso sem recebimento escolhido ou com dias fora de 1–365 mostra erro', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Adicionar atraso' }));
    expect(screen.getByText('Escolha o recebimento que vai atrasar.')).toBeInTheDocument();
    expect(screen.getByText('Informe de 1 a 365 dias.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Recebimento'), 'cen-conta-01');
    for (const bad of ['366', '0', '1,5', 'abc']) {
      await user.clear(screen.getByLabelText('Atraso (dias corridos)'));
      await user.type(screen.getByLabelText('Atraso (dias corridos)'), bad);
      await user.click(screen.getByRole('button', { name: 'Adicionar atraso' }));
      expect(screen.getByText('Informe de 1 a 365 dias.')).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Hipóteses ativas' })).toBeNull();
    }
    await user.clear(screen.getByLabelText('Atraso (dias corridos)'));
    await user.type(screen.getByLabelText('Atraso (dias corridos)'), '365');
    await user.click(screen.getByRole('button', { name: 'Adicionar atraso' }));
    expect(screen.getByRole('list', { name: 'Hipóteses ativas' })).toHaveTextContent('em 365 dias');
  });
});

describe('Simulador: rotulagem hipotética e ausência de execução real', () => {
  it('toda a Alternativa é rotulada como hipótese em texto; nenhum botão sugere execução real', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await addDelay(user, '3');
    expect(screen.getByRole('columnheader', { name: 'Alternativa (hipótese)' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Resumo da Alternativa (hipótese)' });
    expect(within(summary).getByText('Hipótese')).toBeInTheDocument();
    const hypo = [...document.querySelectorAll('[data-hypothetical="true"]')];
    expect(hypo.length).toBeGreaterThan(30);
    expect(screen.getByRole('heading', { name: /Original × Alternativa \(hipótese\)/ })).toBeInTheDocument();
    const labels = screen.getAllByRole('button').map((b) => `${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).join(' | ');
    expect(labels).not.toMatch(/executar|transferir|antecipar|contratar|pagar|confirmar|aplicar/i);
  });

  it('as premissas ficam acessíveis em texto e dizem que nada é gravado', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await addDelay(user, '3');
    expect(screen.getByText(/Premissas desta hipótese \(\d+\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/nada é gravado, executado ou transferido/).length).toBeGreaterThan(0);
  });

  it('a simulação não altera a base nem produz efeito colateral nela', async () => {
    const user = userEvent.setup();
    const base = createScenarioDemoBase();
    const before = json(base);
    function Fixed() {
      const [a, setA] = useState<Adjustment[]>([]);
      return <ScenarioPanel snapshot={base} adjustments={a} onChange={setA} />;
    }
    render(<Fixed />);
    await addDelay(user, '3');
    await user.click(screen.getByRole('button', { name: 'Voltar ao original' }));
    expect(json(base)).toBe(before);
    expect(Object.isFrozen(base)).toBe(true);
  });
});

describe('Simulador: abas no celular', () => {
  it('em tela estreita: abas Original / Alternativa (hipótese) e a Diferença sempre visível', async () => {
    mockNarrow(true);
    const user = userEvent.setup();
    render(<Harness initial={[{ id: 'h1', kind: 'delay_receipt', entryId: 'cen-conta-01', days: 3 }]} />);
    const tabs = screen.getByRole('tablist', { name: /Escolha o que ver/ });
    const [tabOriginal, tabAlt] = within(tabs).getAllByRole('tab');
    expect(tabOriginal).toHaveTextContent('Original');
    expect(tabAlt).toHaveTextContent('Alternativa (hipótese)');
    expect(tabOriginal).toHaveAttribute('aria-selected', 'true');
    // aba Original: sem coluna da Alternativa; Diferença presente
    expect(screen.queryByRole('columnheader', { name: 'Alternativa (hipótese)' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Original' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Diferença' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resumo da diferença' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Resumo da Alternativa (hipótese)' })).toBeNull();
    expect(row('2026-11-14').querySelector('[data-label="Diferença"]')).toHaveTextContent('-R$ 1.800,00');

    await user.click(tabAlt!);
    expect(tabAlt).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('columnheader', { name: 'Original' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Alternativa (hipótese)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Diferença' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resumo da Alternativa (hipótese)' })).toHaveTextContent('Hipótese');
    expect(row('2026-11-14')).toHaveTextContent('R$ 800,00');
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('as setas do teclado trocam de aba e só a aba ativa entra na ordem de tabulação', async () => {
    mockNarrow(true);
    const user = userEvent.setup();
    render(<Harness />);
    const [tabOriginal, tabAlt] = screen.getAllByRole('tab');
    expect(tabOriginal).toHaveAttribute('tabindex', '0');
    expect(tabAlt).toHaveAttribute('tabindex', '-1');
    tabOriginal!.focus();
    await user.keyboard('{ArrowRight}');
    expect(tabAlt).toHaveAttribute('aria-selected', 'true');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(tabAlt).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tabOriginal).toHaveAttribute('aria-selected', 'true');
  });

  it('em tela larga não há abas: Original, Alternativa e Diferença ficam lado a lado', () => {
    mockNarrow(false);
    render(<Harness />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Original' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Alternativa (hipótese)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Diferença' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resumo do Original' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resumo da Alternativa (hipótese)' })).toBeInTheDocument();
  });
});

describe('ScenarioCompare (apresentação)', () => {
  const base = createScenarioDemoBase();
  const run = (a: Adjustment[]) => simulate(base, a);

  it('signedBRL: sinal explícito quando há diferença', () => {
    expect([signedBRL(100n), signedBRL(-100n), signedBRL(0n)]).toEqual(['+R$ 1,00', '-R$ 1,00', 'R$ 0,00']);
  });

  it('resumo: saldo final, menor saldo, primeiro alerta e dias em alerta, com a diferença', () => {
    render(<ScenarioCompare result={run([{ id: 'h', kind: 'delay_receipt', entryId: 'cen-conta-01', days: 3 }])} hasAdjustments />);
    const original = screen.getByRole('region', { name: 'Resumo do Original' });
    expect(original).toHaveTextContent('Saldo em 11/12/2026');
    expect(original).toHaveTextContent('R$ 800,00 em 13/11');
    expect(original).toHaveTextContent('Risco de ficar abaixo do mínimo em 13/11/2026');
    expect(original).toHaveTextContent('Dias em alerta1');
    const diff = screen.getByRole('region', { name: 'Resumo da diferença' });
    expect(diff).toHaveTextContent('Saldo final' + 'R$ 0,00');
    expect(diff).toHaveTextContent('Dias em alerta2 a mais');
  });

  it('a conferência acusa inconsistência real entre os saldos e a diferença (não é texto fixo)', () => {
    const good = run([{ id: 'h', kind: 'delay_receipt', entryId: 'cen-conta-01', days: 3 }]);
    const broken: SimulationResult = { ...good, deltaByDate: good.deltaByDate.map((d, i) => (i === 2 ? { ...d, deltaCents: d.deltaCents + 1n } : d)) };
    render(<ScenarioCompare result={broken} hasAdjustments />);
    expect(screen.getByText('Atenção: a conferência falhou em 1 de 30 dias.')).toBeInTheDocument();
  });

  it('avisos do motor aparecem em um alerta de atenção', () => {
    render(<ScenarioCompare result={run([{ id: 'h', kind: 'hiring' }])} hasAdjustments />);
    expect(screen.getByText('Atenção nesta hipótese')).toBeInTheDocument();
    expect(screen.getByText(/tipo ainda não suportado/)).toBeInTheDocument();
  });
});
