import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { projectWeekly } from '../../domain/finance/weekly';
import type { CashEntry, CashSettings } from '../../domain/finance/types';
import { createRepository } from '../../storage/repository';
import { EntriesPanel } from '../EntriesPanel';
import { ExportMenu, downloadCsv } from '../ExportMenu';
import type { ExportItem } from '../ExportMenu';
import { WeeklyView } from '../WeeklyView';

const item = (over: Partial<ExportItem> = {}): ExportItem => ({
  id: 'x',
  label: 'Arquivo X',
  description: 'Descrição do arquivo X.',
  filename: 'x.csv',
  build: () => ({ csv: '﻿a;b\r\n', rows: 1 }),
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('ExportMenu', () => {
  it('é um botão secundário que abre as opções com descrição; Escape fecha e devolve o foco', async () => {
    const user = userEvent.setup();
    render(<ExportMenu items={[item()]} onDownload={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Exportar CSV' });
    expect(trigger).toHaveClass('cf-btn--secondary');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Opções de exportação' });
    expect(within(group).getByText('Descrição do arquivo X.')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Arquivo X' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('escolher uma opção baixa o arquivo com o nome certo e anuncia linhas geradas e que nada foi enviado', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<ExportMenu items={[item({ build: () => ({ csv: 'CSV!', rows: 3, note: '2 liquidado(s) não incluídos.' }) })]} onDownload={onDownload} />);
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await user.keyboard('{Enter}'); // a 1ª opção já recebe o foco
    expect(onDownload).toHaveBeenCalledWith('x.csv', 'CSV!');
    expect(screen.getByTestId('export-status')).toHaveTextContent('x.csv: 3 linhas geradas neste navegador; nada foi enviado a servidor. 2 liquidado(s) não incluídos.');
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('singular em 1 linha; desabilitado sem itens ou com disabled', () => {
    const { rerender } = render(<ExportMenu items={[]} />);
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
    rerender(<ExportMenu items={[item()]} disabled />);
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
  });

  it('downloadCsv: cria um Blob UTF-8 com BOM (EF BB BF), usa o nome do arquivo e libera a URL', async () => {
    let blob: Blob | undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('relatório.csv');
    });
    const create = vi.fn((b: Blob) => ((blob = b), 'blob:fake'));
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    downloadCsv('relatório.csv', '﻿olá;ç\r\n');
    expect(click).toHaveBeenCalledTimes(1);
    expect(blob?.type).toBe('text/csv;charset=utf-8');
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob as Blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8').decode(bytes.slice(3))).toBe('olá;ç\r\n');
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:fake'));
    expect(document.querySelector('a[download]')).toBeNull(); // âncora temporária removida
    vi.unstubAllGlobals();
  });
});

const e = (id: string, over: Partial<CashEntry> = {}): CashEntry => ({
  id,
  direction: 'out',
  amountCents: '10000',
  dueDate: '2026-12-05',
  description: `Conta ${id}`,
  category: 'X',
  origin: 'manual',
  sourceKey: `manual:${id}`,
  state: 'scheduled',
  ...over,
});
const noop = () => undefined;

describe('exportação nas Movimentações', () => {
  const entries = [e('a', { dueDate: '2026-12-01' }), e('b', { dueDate: '2026-12-05', category: 'Y' }), e('c', { dueDate: '2026-12-10' }), e('d', { dueDate: '2026-12-20', state: 'settled', settledAt: '2026-12-20' })];
  const settings: CashSettings = { baseDate: '2026-11-30', openingBalanceCents: '100000', minimumBalanceCents: '0' };
  const { projection } = projectWeekly(settings, entries);

  function mount(onDownload = vi.fn()) {
    render(<EntriesPanel entries={entries} flaggedIds={new Set()} onAdd={noop} onPickCsv={noop} onEdit={noop} onDelete={noop} baseDate="2026-11-30" dailyPoints={projection.points} onDownload={onDownload} />);
    return onDownload;
  }

  it('sem filtro: todos os AGENDADOS, com aviso do liquidado que ficou de fora', async () => {
    const user = userEvent.setup();
    const onDownload = mount();
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await user.click(screen.getByRole('button', { name: 'Todos os lançamentos agendados' }));
    const [filename, csv] = onDownload.mock.calls[0] as [string, string];
    expect(filename).toBe('caixafuturo-lancamentos-2026-11-30.csv');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + 3); // cabeçalho + a, b, c
    expect(screen.getByTestId('export-status')).toHaveTextContent('3 linhas geradas');
    expect(screen.getByTestId('export-status')).toHaveTextContent('1 liquidado(s) da lista não foram incluídos.');
  });

  it('com filtro ativo: o CSV é EXATAMENTE a lista filtrada (período e categoria), com nome "-filtrado"', async () => {
    const user = userEvent.setup();
    const onDownload = mount();
    fireEvent.change(screen.getByLabelText('Período a partir de'), { target: { value: '2026-12-02' } });
    fireEvent.change(screen.getByLabelText('Período até'), { target: { value: '2026-12-31' } });
    await user.selectOptions(screen.getByLabelText('Categoria'), 'X');
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await user.click(screen.getByRole('button', { name: 'Lançamentos do filtro atual' }));
    const [filename, csv] = onDownload.mock.calls[0] as [string, string];
    expect(filename).toBe('caixafuturo-lancamentos-2026-11-30-filtrado.csv');
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    expect(lines).toEqual(['tipo;descricao;valor;vencimento;categoria;identificador_externo;referencia_venda', 'pagar;Conta c;100,00;2026-12-10;X;manual:c;']); // "d" liquidado fora; "a" antes do período; "b" outra categoria
  });

  it('a projeção diária sai inteira e NÃO é afetada pelo filtro; descreve que não é reimportável', async () => {
    const user = userEvent.setup();
    const onDownload = mount();
    await user.selectOptions(screen.getByLabelText('Categoria'), 'Y');
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(screen.getByText(/não é reimportável e não é afetada pelo filtro/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Projeção diária de saldo' }));
    const [filename, csv] = onDownload.mock.calls[0] as [string, string];
    expect(filename).toBe('caixafuturo-projecao-diaria-2026-11-30.csv');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + projection.points.length);
  });

  it('avisa em texto o limite da reimportação (origem CSV × manual)', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(screen.getByText(/reimportar é seguro para lançamentos de origem csv/i)).toBeInTheDocument();
  });

  it('sem data-base ou sem lançamentos não há botão de exportação', () => {
    const { unmount } = render(<EntriesPanel entries={entries} flaggedIds={new Set()} onAdd={noop} onPickCsv={noop} onEdit={noop} onDelete={noop} />);
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
    unmount();
    render(<EntriesPanel entries={[]} flaggedIds={new Set()} onAdd={noop} onPickCsv={noop} onEdit={noop} onDelete={noop} baseDate="2026-11-30" />);
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
  });
});

describe('exportação das 13 semanas', () => {
  it('uma linha por semana, com o mesmo saldo mostrado na tabela', async () => {
    const user = userEvent.setup();
    const settings: CashSettings = { baseDate: '2026-11-12', openingBalanceCents: '500000', minimumBalanceCents: '100000' };
    const { weekly } = projectWeekly(settings, [e('a', { amountCents: '30000', dueDate: '2026-11-13' })]);
    const onDownload = vi.fn();
    render(<WeeklyView weekly={weekly} entriesById={new Map()} baseDate="2026-11-12" onDownload={onDownload} />);
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await user.click(screen.getByRole('button', { name: 'Fluxo das semanas' }));
    const [filename, csv] = onDownload.mock.calls[0] as [string, string];
    expect(filename).toBe('caixafuturo-13-semanas-2026-11-12.csv');
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(14);
    expect(lines[1]).toContain('4700,00;470000'); // 5.000,00 − 300,00 na semana 1
    expect(screen.getByTestId('export-status')).toHaveTextContent('13 linhas geradas');
  });

  it('sem baseDate não mostra o botão', () => {
    const settings: CashSettings = { baseDate: '2026-11-12', openingBalanceCents: '0', minimumBalanceCents: '0' };
    render(<WeeklyView weekly={projectWeekly(settings, []).weekly} entriesById={new Map()} />);
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
  });
});

describe('exportação integrada ao App', () => {
  it('Movimentações da demonstração: o arquivo baixado tem BOM, cabeçalho, as 4 contas da S01 e valores com vírgula', async () => {
    window.location.hash = '';
    const repo = createRepository({ factory: new IDBFactory(), dbName: 'cf-export' });
    let blob: Blob | undefined;
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => ((blob = b), 'blob:x'), revokeObjectURL: vi.fn() });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const user = userEvent.setup();
    render(<App repository={repo} />);
    await user.click(await screen.findByRole('button', { name: /explorar demonstração/i }));
    await screen.findByRole('heading', { level: 1, name: 'Visão geral' });
    await user.click(screen.getByRole('button', { name: 'Movimentações' }));
    await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }));
    await user.click(screen.getByRole('button', { name: 'Todos os lançamentos agendados' }));
    expect(names).toEqual(['caixafuturo-lancamentos-2026-11-11.csv']);
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
      r.readAsArrayBuffer(blob as Blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // readAsText descartaria o BOM; os bytes não mentem
    const text = ` ${new TextDecoder('utf-8').decode(bytes.slice(3))}`;
    const lines = text.slice(1).split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('tipo;descricao;valor;vencimento;categoria;identificador_externo;referencia_venda');
    expect(lines).toHaveLength(5);
    expect(lines).toContain('pagar;Aluguel fictício;2000,00;2026-11-14;Aluguel;demo:demo-despesa-02;');
    expect(lines).toContain('receber;Recebimento agendado fictício;4000,00;2026-11-15;Recebimentos;demo:demo-receita-02;');
    vi.unstubAllGlobals();
  });
});
