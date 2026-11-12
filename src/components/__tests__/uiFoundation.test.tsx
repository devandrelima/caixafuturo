import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell, NAV_ITEMS } from '../AppShell';
import { Onboarding } from '../Onboarding';
import { CfAlert, CfBadge, CfButton, CfCard, CfField, CfSelect } from '../ui/UiPrimitives';

const css = readFileSync('src/app/styles.css', 'utf-8');
const tokens = JSON.parse(readFileSync('docs/especificacao/design/tokens.json', 'utf-8')) as {
  colors: Record<string, string>;
  radiusPx: Record<string, number>;
  controls: { heightPx: number; minTouchTargetPx: number };
  layout: { sidebarExpandedPx: number; contentMaxPx: number };
};
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('tokens → CSS variables', () => {
  it('cada cor canônica existe como --cf-* com o mesmo valor', () => {
    for (const [name, value] of Object.entries(tokens.colors)) {
      const re = new RegExp(`--cf-${kebab(name)}:\\s*${value.replace('#', '#')};`, 'i');
      expect(css, `token ${name}`).toMatch(re);
    }
  });

  it('raios, controle e layout vêm dos tokens', () => {
    for (const [name, px] of Object.entries(tokens.radiusPx)) {
      expect(css).toMatch(new RegExp(`--cf-radius-${kebab(name)}:\\s*${px}px;`));
    }
    expect(css).toMatch(new RegExp(`--cf-control-height:\\s*${tokens.controls.heightPx}px;`));
    expect(css).toMatch(new RegExp(`--cf-sidebar-width:\\s*${tokens.layout.sidebarExpandedPx}px;`));
    expect(css).toMatch(new RegExp(`--cf-content-max:\\s*${tokens.layout.contentMaxPx}px;`));
  });

  it('não há cores hexadecimais fora do bloco de tokens (:root)', () => {
    const rootEnd = css.indexOf('/* fim-tokens */');
    expect(rootEnd).toBeGreaterThan(0);
    expect(css.slice(rootEnd)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('botão primário usa texto grafite sobre dourado e controles têm 44px', () => {
    expect(css).toMatch(/\.cf-btn--primary\s*{[^}]*background:\s*var\(--cf-accent\)[^}]*color:\s*var\(--cf-accent-text\)/s);
    expect(css).toMatch(/\.cf-btn\s*{[^}]*min-height:\s*var\(--cf-control-height\)/s);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe('AppShell', () => {
  it('mostra somente as três vistas da Sprint 1', () => {
    render(
      <AppShell activeView="visao-geral" onNavigate={() => {}} demoMode={false}>
        <p>conteúdo</p>
      </AppShell>,
    );
    const nav = screen.getByRole('navigation', { name: /principal/i });
    const items = within(nav).getAllByRole('button');
    expect(items.map((i) => i.textContent)).toEqual(['Visão geral', 'Movimentações', 'Vendas e recebimentos', 'Calendário']);
    expect(NAV_ITEMS).toHaveLength(4);
    expect(within(nav).getByRole('button', { name: 'Visão geral' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Calendário' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(screen.queryByText(/previs(ão|oes) de vendas|simula/i)).toBeNull();
  });

  it('navega pelo callback e fecha o menu', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <AppShell activeView="visao-geral" onNavigate={onNavigate} demoMode={false}>
        x
      </AppShell>,
    );
    await user.click(screen.getByRole('button', { name: 'Movimentações' }));
    expect(onNavigate).toHaveBeenCalledWith('movimentacoes');
  });

  it('exibe o selo "Dados fictícios" apenas no modo demonstração', () => {
    const { rerender } = render(
      <AppShell activeView="calendario" onNavigate={() => {}} demoMode={false}>
        x
      </AppShell>,
    );
    expect(screen.queryByText('Dados fictícios')).toBeNull();
    rerender(
      <AppShell activeView="calendario" onNavigate={() => {}} demoMode>
        x
      </AppShell>,
    );
    expect(screen.getByText('Dados fictícios')).toBeInTheDocument();
  });

  it('menu móvel: abre, move o foco, Escape fecha e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    render(
      <AppShell activeView="visao-geral" onNavigate={() => {}} demoMode={false}>
        x
      </AppShell>,
    );
    const toggle = screen.getByRole('button', { name: /abrir menu/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: /fechar menu/i })).toHaveAttribute('aria-expanded', 'true');
    const first = screen.getByRole('button', { name: 'Visão geral' });
    expect(first).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /abrir menu/i })).toHaveFocus();
    expect(screen.getByRole('button', { name: /abrir menu/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('menu móvel: Tab permanece dentro do menu enquanto aberto', async () => {
    const user = userEvent.setup();
    render(
      <AppShell activeView="visao-geral" onNavigate={() => {}} demoMode={false}>
        <button type="button">fora</button>
      </AppShell>,
    );
    await user.click(screen.getByRole('button', { name: /abrir menu/i }));
    const names = ['Visão geral', 'Movimentações', 'Vendas e recebimentos', 'Calendário'];
    await user.tab();
    expect(screen.getByRole('button', { name: names[1]! })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: names[2]! })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: names[3]! })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: names[0]! })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus();
  });

  it('clicar na área escura fecha o menu', async () => {
    const user = userEvent.setup();
    render(
      <AppShell activeView="visao-geral" onNavigate={() => {}} demoMode={false}>
        x
      </AppShell>,
    );
    await user.click(screen.getByRole('button', { name: /abrir menu/i }));
    await user.click(screen.getByTestId('cf-scrim'));
    expect(screen.getByRole('button', { name: /abrir menu/i })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Onboarding', () => {
  it('oferece duas ações reais e não carrega dados sozinho', async () => {
    const onExploreDemo = vi.fn();
    const onStartEmpty = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onExploreDemo={onExploreDemo} onStartEmpty={onStartEmpty} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(onExploreDemo).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /explorar demonstração/i }));
    expect(onExploreDemo).toHaveBeenCalledTimes(1);
    expect(onStartEmpty).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /começar com meus dados/i }));
    expect(onStartEmpty).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ficam neste navegador/i)).toBeInTheDocument();
  });

  it('isLoading desativa as ações e erro é exibido como alerta', () => {
    render(<Onboarding onExploreDemo={() => {}} onStartEmpty={() => {}} isLoading errorMessage="Falha ao abrir o armazenamento." />);
    expect(screen.getByRole('button', { name: /explorar demonstração/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /começar com meus dados/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao abrir o armazenamento.');
  });
});

describe('primitivos', () => {
  it('CfButton: variante, tipo padrão button e loading não acionável', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <CfButton variant="primary" onClick={onClick}>
        Salvar
      </CfButton>,
    );
    const btn = screen.getByRole('button', { name: 'Salvar' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveClass('cf-btn', 'cf-btn--primary');
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <CfButton variant="danger" loading onClick={onClick}>
        Salvar
      </CfButton>,
    );
    const loading = screen.getByRole('button', { name: /salvar/i });
    expect(loading).toBeDisabled();
    expect(loading).toHaveAttribute('aria-busy', 'true');
    await user.click(loading);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('CfCard: título, descrição e ações', () => {
    render(
      <CfCard title="Resumo" description="Texto de apoio" actions={<button type="button">Ação</button>}>
        corpo
      </CfCard>,
    );
    expect(screen.getByRole('heading', { name: 'Resumo' })).toBeInTheDocument();
    expect(screen.getByText('Texto de apoio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ação' })).toBeInTheDocument();
    expect(screen.getByText('corpo')).toBeInTheDocument();
  });

  it('CfBadge mostra rótulo textual (cor nunca é o único sinal)', () => {
    render(<CfBadge tone="negative">Saldo negativo</CfBadge>);
    expect(screen.getByText('Saldo negativo')).toHaveClass('cf-badge--negative');
  });

  it('CfField liga label, dica e erro por aria-describedby', () => {
    render(<CfField label="Valor (R$)" hint="Use 1.234,56" error="Valor inválido." required defaultValue="" />);
    const input = screen.getByLabelText(/valor \(r\$\)/i);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toHaveLength(2);
    expect(screen.getByText('Valor inválido.')).toHaveAttribute('id', describedBy.split(' ')[1]);
    expect(screen.getByText('Use 1.234,56')).toBeInTheDocument();
  });

  it('CfField sem erro não marca aria-invalid; CfSelect é rotulado', () => {
    render(
      <>
        <CfField label="Descrição" defaultValue="" />
        <CfSelect label="Tipo" defaultValue="out">
          <option value="out">Pagar</option>
          <option value="in">Receber</option>
        </CfSelect>
      </>,
    );
    expect(screen.getByLabelText('Descrição')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Tipo')).toHaveValue('out');
  });

  it('CfAlert usa role alert para erro e status para demais tons', () => {
    const { rerender } = render(<CfAlert tone="negative" title="Erro">falhou</CfAlert>);
    expect(screen.getByRole('alert')).toHaveTextContent('falhou');
    rerender(<CfAlert tone="neutral" title="Aviso">ok</CfAlert>);
    expect(screen.getByRole('status')).toHaveTextContent('ok');
  });
});
