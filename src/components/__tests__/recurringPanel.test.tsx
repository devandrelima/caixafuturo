import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { expandRecurrences, type RecurrenceRule } from '../../domain/finance/recurrence';
import { createRepository } from '../../storage/repository';
import type { Repository } from '../../storage/repository';
import { RecurringPanel } from '../RecurringPanel';

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  id: 'r1',
  direction: 'out',
  amountCents: '180000',
  description: 'Condomínio',
  category: 'Fixas',
  frequency: 'monthly',
  startDate: '2026-01-31',
  ...over,
});

function panel(over: Partial<Parameters<typeof RecurringPanel>[0]> = {}) {
  const r = rule();
  const { entries, covered } = expandRecurrences([r], [], { from: '2026-11-12', to: '2027-02-07' });
  const props = {
    rules: [r],
    occurrences: entries,
    covered,
    invalidRules: [],
    demoMode: false,
    busy: false,
    onSave: vi.fn().mockResolvedValue(null),
    onRemove: vi.fn(),
    onSkip: vi.fn(),
    onLoadDemo: vi.fn(),
    ...over,
  };
  return { props, ...render(<RecurringPanel {...props} />) };
}

describe('RecurringPanel (isolado)', () => {
  it('lista regras e próximas ocorrências calculadas (31/jan → 30/11, 31/12, 31/01)', () => {
    panel();
    const rules = screen.getByRole('table', { name: 'Regras de recorrência' });
    expect(within(rules).getByText('Condomínio')).toBeInTheDocument();
    expect(within(rules).getByText('Mensal')).toBeInTheDocument();
    expect(within(rules).getByText('desde 31/01/2026')).toBeInTheDocument();
    const next = screen.getByRole('table', { name: 'Próximas ocorrências calculadas' });
    const dates = within(next).getAllByRole('row').slice(1).map((r) => r.children[0]?.textContent);
    expect(dates).toEqual(['30/11/2026', '31/12/2026', '31/01/2027']);
  });

  it('estado vazio explica o que cadastrar; botão de demonstração só em modo demonstração e sem regras', () => {
    const { unmount } = panel({ rules: [], occurrences: [] });
    expect(screen.getByText(/nenhuma recorrência ainda/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /carregar recorrências fictícias/i })).toBeNull();
    unmount();
    const { props } = panel({ rules: [], occurrences: [], demoMode: true });
    fireEvent.click(screen.getByRole('button', { name: /carregar recorrências fictícias/i }));
    expect(props.onLoadDemo).toHaveBeenCalledTimes(1);
  });

  it('pular uma data e excluir a regra chamam os callbacks com a regra certa', async () => {
    const user = userEvent.setup();
    const { props } = panel();
    await user.click(screen.getByRole('button', { name: 'Pular Condomínio em 31/12/2026' }));
    expect(props.onSkip).toHaveBeenCalledWith(rule(), '2026-12-31');
    await user.click(screen.getByRole('button', { name: 'Excluir recorrência Condomínio' }));
    expect(props.onRemove).toHaveBeenCalledWith(rule());
  });

  it('formulário: valida em texto (valor, descrição, datas) e não chama onSave', async () => {
    const user = userEvent.setup();
    const { props } = panel({ rules: [], occurrences: [] });
    await user.click(screen.getByRole('button', { name: 'Nova recorrência' }));
    await user.click(screen.getByRole('button', { name: 'Salvar recorrência' }));
    expect(screen.getByText('Informe a descrição.')).toBeInTheDocument();
    expect(screen.getByText('Informe uma data inicial válida.')).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/^Descrição/), 'Aluguel');
    await user.type(screen.getByLabelText(/^Valor/), '1.500,00');
    fireEvent.change(screen.getByLabelText(/^Data inicial/), { target: { value: '2026-12-10' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-12-01' } });
    await user.click(screen.getByRole('button', { name: 'Salvar recorrência' }));
    expect(screen.getByText('A data final não pode ser anterior à inicial.')).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('formulário válido monta a regra em centavos (sem id; quem grava define) e fecha ao salvar', async () => {
    const user = userEvent.setup();
    const { props } = panel({ rules: [], occurrences: [] });
    await user.click(screen.getByRole('button', { name: 'Nova recorrência' }));
    await user.selectOptions(screen.getByLabelText('Tipo'), 'in');
    await user.type(screen.getByLabelText(/^Descrição/), 'Mensalidade');
    await user.type(screen.getByLabelText(/^Valor/), '1.234,56');
    await user.selectOptions(screen.getByLabelText('Periodicidade'), 'weekly');
    fireEvent.change(screen.getByLabelText(/^Data inicial/), { target: { value: '2026-11-16' } });
    await user.click(screen.getByRole('button', { name: 'Salvar recorrência' }));
    expect(props.onSave).toHaveBeenCalledWith({ id: '', direction: 'in', amountCents: '123456', description: 'Mensalidade', category: '', frequency: 'weekly', startDate: '2026-11-16' });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Nova recorrência' })).toBeNull());
  });

  it('dica do dia 31 aparece para mensal/anual com dia > 28, em texto', () => {
    panel({ rules: [], occurrences: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Nova recorrência' }));
    fireEvent.change(screen.getByLabelText(/^Data inicial/), { target: { value: '2026-01-31' } });
    expect(screen.getByText(/dia 31: nos meses em que esse dia não existe/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Periodicidade'), { target: { value: 'weekly' } });
    expect(screen.queryByText(/dia 31: nos meses/i)).toBeNull();
  });

  it('erro devolvido por quem grava aparece no formulário e o formulário continua aberto', async () => {
    const user = userEvent.setup();
    const { props } = panel({ rules: [], occurrences: [], onSave: vi.fn().mockResolvedValue('Sem espaço de armazenamento.') });
    await user.click(screen.getByRole('button', { name: 'Nova recorrência' }));
    await user.type(screen.getByLabelText(/^Descrição/), 'X');
    await user.type(screen.getByLabelText(/^Valor/), '10,00');
    fireEvent.change(screen.getByLabelText(/^Data inicial/), { target: { value: '2026-12-01' } });
    await user.click(screen.getByRole('button', { name: 'Salvar recorrência' }));
    expect(await screen.findByText('Sem espaço de armazenamento.')).toBeInTheDocument();
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('form', { name: 'Nova recorrência' })).toBeInTheDocument();
  });

  it('editar abre o formulário preenchido (valor formatado) e mantém o id', async () => {
    const user = userEvent.setup();
    const { props } = panel();
    await user.click(screen.getByRole('button', { name: 'Editar recorrência Condomínio' }));
    expect(screen.getByLabelText(/^Valor/)).toHaveValue('1.800,00');
    await user.clear(screen.getByLabelText(/^Valor/));
    await user.type(screen.getByLabelText(/^Valor/), '1.900,00');
    await user.click(screen.getByRole('button', { name: 'Salvar recorrência' }));
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', amountCents: '190000' }));
  });

  it('regra inválida é avisada (ignorada no cálculo) e ocorrências cobertas ficam visíveis, nunca silenciosas', () => {
    panel({
      invalidRules: [{ ruleId: 'r1', errors: ['Valor inválido: use centavos inteiros maiores que zero.'] }],
      covered: [
        { ruleId: 'r1', date: '2026-11-30', sourceKey: 'rec:r1:2026-11-30', reason: 'materialized', entryId: 'rec_abc' },
        { ruleId: 'r1', date: '2026-12-31', sourceKey: 'rec:r1:2026-12-31', reason: 'equivalent', entryId: 'csv_1' },
      ],
    });
    expect(screen.getByText(/regra\(s\) inválida\(s\)/i)).toBeInTheDocument();
    const covered = screen.getByText(/ocorrências que já existem como lançamento \(2\)/i).closest('details') as HTMLElement;
    expect(covered).toHaveTextContent('já existe um lançamento gravado com esta chave (rec_abc)');
    expect(covered).toHaveTextContent('equivalente ao lançamento existente csv_1; não duplicada');
  });

  it('declara a limitação de dias corridos e que o já lançado não muda', () => {
    panel();
    expect(screen.getByText(/sem dias úteis nem feriados/i)).toBeInTheDocument();
    expect(screen.getByText(/o que já foi lançado ou liquidado não muda/i)).toBeInTheDocument();
  });
});

describe('recorrências integradas ao App (IndexedDB real de teste)', () => {
  let repo: Repository;
  let factory: IDBFactory;
  beforeEach(() => {
    window.location.hash = '';
    factory = new IDBFactory();
    repo = createRepository({ factory, dbName: 'cf-rec' });
  });

  async function openCalendar() {
    const user = userEvent.setup();
    render(<App repository={repo} />);
    await user.click(await screen.findByRole('button', { name: /explorar demonstração/i }));
    await screen.findByRole('heading', { level: 1, name: 'Visão geral' });
    await user.click(screen.getByRole('button', { name: 'Calendário' }));
    await screen.findByRole('heading', { level: 1, name: 'Calendário' });
    return user;
  }

  it('sem regras o Calendário mostra 13 semanas dos lançamentos da demo e o painel vazio; a demo da S01 segue igual', async () => {
    await openCalendar();
    const weeks = screen.getByRole('table', { name: 'Fluxo de caixa por semana' });
    expect(within(weeks).getAllByRole('row')).toHaveLength(14); // cabeçalho + 13
    // 15/11 (domingo): fecha em R$ 3.300,00 como na S01
    expect(within(weeks).getAllByRole('row')[1]).toHaveTextContent('R$ 3.300,00');
    expect(screen.getByText(/nenhuma recorrência ainda/i)).toBeInTheDocument();
    expect(await repo.recurrence.listRules()).toEqual([]);
  });

  it('"Carregar recorrências fictícias" grava regras e a ocorrência liquidada, recalcula as 13 semanas (à mão) e é idempotente', async () => {
    const user = await openCalendar();
    await user.click(screen.getByRole('button', { name: /carregar recorrências fictícias/i }));
    await screen.findByRole('table', { name: 'Regras de recorrência' });
    expect((await repo.recurrence.listRules()).map((r) => r.id)).toEqual(['demo-rec-condominio', 'demo-rec-eventos', 'demo-rec-seguro', 'demo-rec-fornecedor'], // ordem: data inicial, depois id
    );
    const weeks = screen.getByRole('table', { name: 'Fluxo de caixa por semana' });
    const closings = within(weeks).getAllByRole('row').slice(1).map((r) => r.children[3]?.textContent);
    expect(closings).toEqual(['R$ 4.500,00', 'R$ 4.150,00', 'R$ 3.800,00', 'R$ 1.650,00', 'R$ 1.300,00', 'R$ 1.550,00', 'R$ 1.200,00', '-R$ 950,00', '-R$ 1.300,00', '-R$ 1.650,00', '-R$ 2.600,00', '-R$ 4.750,00', '-R$ 5.100,00']);
    // a ocorrência liquidada de 20/11 fica gravada com a chave estável e não é duplicada
    const stored = await repo.listEntries();
    expect(stored.filter((x) => x.sourceKey === 'rec:demo-rec-seguro:2026-11-20')).toHaveLength(1);
    expect(screen.getByText(/ocorrências que já existem como lançamento \(1\)/i)).toBeInTheDocument();
  });

  it('PULAR uma data persiste na regra e tira só aquela ocorrência do saldo', async () => {
    const user = await openCalendar();
    await user.click(screen.getByRole('button', { name: /carregar recorrências fictícias/i }));
    await user.click(await screen.findByRole('button', { name: 'Pular Condomínio fictício (dia 31) em 30/11/2026' }));
    await screen.findByText(/ocorrência de 30\/11\/2026 pulada/i);
    expect((await repo.recurrence.listRules()).find((r) => r.id === 'demo-rec-condominio')?.skippedDates).toEqual(['2026-11-30']);
    const weeks = screen.getByRole('table', { name: 'Fluxo de caixa por semana' });
    // semana 4 (30/11–06/12): sem o condomínio de R$ 1.800,00 fecha em R$ 3.450,00 (3.800 − 350)
    expect(within(weeks).getAllByRole('row')[4]).toHaveTextContent('R$ 3.450,00');
  });

  it('EXCLUIR a regra pede confirmação, remove as ocorrências futuras e MANTÉM o lançamento liquidado', async () => {
    const user = await openCalendar();
    await user.click(screen.getByRole('button', { name: /carregar recorrências fictícias/i }));
    await user.click(await screen.findByRole('button', { name: 'Excluir recorrência Seguro fictício' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/lançamentos já gravados ou liquidados permanecem/i);
    await user.click(within(dialog).getByRole('button', { name: 'Excluir recorrência' }));
    await screen.findByText(/recorrência excluída/i);
    expect((await repo.recurrence.listRules()).map((r) => r.id)).not.toContain('demo-rec-seguro');
    expect((await repo.listEntries()).some((x) => x.sourceKey === 'rec:demo-rec-seguro:2026-11-20' && x.state === 'settled')).toBe(true);
  });

  it('cadastrar recorrência pelo formulário (mensal dia 31) grava a regra e entra nos saldos', async () => {
    const user = await openCalendar();
    await user.click(screen.getByRole('button', { name: 'Nova recorrência' }));
    await user.type(screen.getByLabelText(/^Descrição/), 'Mensalidade teste');
    await user.type(screen.getByLabelText(/^Valor/), '1.000,00');
    fireEvent.change(screen.getByLabelText(/^Data inicial/), { target: { value: '2026-10-31' } });
    await user.click(screen.getByRole('button', { name: 'Salvar recorrência' }));
    await screen.findByText(/recorrência salva/i);
    const saved = (await repo.recurrence.listRules())[0];
    expect(saved).toMatchObject({ description: 'Mensalidade teste', amountCents: '100000', frequency: 'monthly', startDate: '2026-10-31', direction: 'out' });
    expect(saved?.id).toMatch(/^r_[0-9a-f]{20}$/);
    const next = screen.getByRole('table', { name: 'Próximas ocorrências calculadas' });
    expect(within(next).getAllByRole('row')[1]).toHaveTextContent('30/11/2026');
    expect(within(next).getAllByRole('row')[2]).toHaveTextContent('31/12/2026');
  });

  it('Movimentações: ocorrências aparecem como "Calculada pela regra" e o alerta global fica fora do filtro', async () => {
    const user = await openCalendar();
    await user.click(screen.getByRole('button', { name: /carregar recorrências fictícias/i }));
    await screen.findByRole('table', { name: 'Regras de recorrência' });
    await user.click(screen.getByRole('button', { name: 'Movimentações' }));
    await screen.findByRole('heading', { level: 1, name: 'Movimentações' });
    await user.selectOptions(screen.getByLabelText('Origem'), 'Recorrente');
    const table = screen.getByRole('table', { name: 'Lançamentos' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(20); // 19 calculadas + 1 gravada (liquidada)
    expect(within(table).getAllByText('Calculada pela regra')).toHaveLength(19);
    expect(within(table).getAllByText('Liquidado')).toHaveLength(1);
    // o alerta global continua lá (14/11 da demo S01) mesmo filtrando só recorrentes
    expect(screen.getByText(/saldo projetado negativo em 14\/11\/2026/i)).toBeInTheDocument();
    expect(screen.getByRole('search', { name: 'Filtros de lançamentos' })).toBeInTheDocument();
  });
});
