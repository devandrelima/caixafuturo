import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { CfBadge } from './ui/UiPrimitives';

export type View = 'visao-geral' | 'movimentacoes' | 'vendas' | 'previsoes' | 'calendario' | 'simulador';

export const NAV_ITEMS: ReadonlyArray<{ id: View; label: string; icon: ReactNode }> = [
  {
    id: 'visao-geral',
    label: 'Visão geral',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    id: 'movimentacoes',
    label: 'Movimentações',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 4v14m0 0-3-3m3 3 3-3M17 20V6m0 0-3 3m3-3 3 3" />
      </svg>
    ),
  },
  {
    id: 'vendas',
    label: 'Vendas e recebimentos',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h16l-1.5 9a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 7zM4 7 3 3M9 21h.01M15 21h.01" />
      </svg>
    ),
  },
  {
    id: 'previsoes',
    label: 'Previsões',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
      </svg>
    ),
  },
  {
    id: 'calendario',
    label: 'Calendário',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    ),
  },
  {
    id: 'simulador',
    label: 'Simulador',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </svg>
    ),
  },
];

export interface AppShellProps {
  activeView: View;
  onNavigate: (view: View) => void;
  demoMode: boolean;
  children: ReactNode;
}

function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="13" fill="var(--cf-accent)" stroke="var(--cf-text)" strokeWidth="2" />
      <circle cx="12" cy="14" r="1.6" fill="var(--cf-text)" />
      <circle cx="20" cy="14" r="1.6" fill="var(--cf-text)" />
      <path d="M11.5 19 Q16 23 20.5 19" fill="none" stroke="var(--cf-text)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({ activeView, onNavigate, demoMode, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
    else if (wasOpen.current) toggleRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const focusables = () =>
    Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);

  function onSidebarKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const current = NAV_ITEMS.find((item) => item.id === activeView);

  return (
    <div className="cf-shell">
      <header className="cf-topbar">
        <button
          ref={toggleRef}
          type="button"
          className="cf-btn cf-btn--ghost cf-menu-btn"
          aria-expanded={open}
          aria-controls="cf-sidebar"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="cf-topbar__title">{current?.label}</span>
        {demoMode && <CfBadge tone="demo">Dados fictícios</CfBadge>}
      </header>

      {open && <div className="cf-scrim" data-testid="cf-scrim" aria-hidden="true" onClick={() => setOpen(false)} />}

      <aside id="cf-sidebar" ref={sidebarRef} className="cf-sidebar" data-open={open} onKeyDown={onSidebarKeyDown}>
        <div className="cf-sidebar__head">
          <span className="cf-brand">
            <BrandMark />
            CaixaFuturo
          </span>
        </div>
        <nav aria-label="Principal">
          <ul className="cf-nav">
            {NAV_ITEMS.map((item, index) => (
              <li key={item.id}>
                <button
                  ref={index === 0 ? firstItemRef : undefined}
                  type="button"
                  className="cf-nav__item"
                  aria-current={item.id === activeView ? 'page' : undefined}
                  onClick={() => {
                    onNavigate(item.id);
                    setOpen(false);
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="cf-btn cf-btn--ghost cf-sidebar__close"
          onClick={() => setOpen(false)}
        >
          Fechar
        </button>
      </aside>

      <main className="cf-main" id="conteudo">
        {children}
      </main>
    </div>
  );
}
