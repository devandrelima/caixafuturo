import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import type { View } from '../components/AppShell';
import { Onboarding } from '../components/Onboarding';
import { CfCard } from '../components/ui/UiPrimitives';

const VIEW_TITLES: Record<View, string> = {
  'visao-geral': 'Visão geral',
  movimentacoes: 'Movimentações',
  calendario: 'Calendário',
};

/**
 * Ligação PROVISÓRIA da fundação visual (S01-P02-T04): sem dados, sem cálculo, sem demonstração.
 * A task S01-P02-T02 substitui este componente pela integração real com persistência e projeção.
 */
export function App() {
  const [started, setStarted] = useState(false);
  const [view, setView] = useState<View>('visao-geral');
  const [notice, setNotice] = useState<string | undefined>();

  if (!started) {
    return (
      <Onboarding
        onExploreDemo={() => setNotice('A demonstração com dados fictícios ainda não foi conectada nesta versão.')}
        onStartEmpty={() => setStarted(true)}
        errorMessage={notice}
      />
    );
  }

  return (
    <AppShell activeView={view} onNavigate={setView} demoMode={false}>
      <div className="cf-page">
        <div className="cf-page__head">
          <h1 className="cf-page__title">{VIEW_TITLES[view]}</h1>
          <p className="cf-page__subtitle">Base visual da Sprint 1: os dados financeiros ainda não foram ligados.</p>
        </div>
        <CfCard title="Sem dados por enquanto" description="Nenhum valor é exibido até que os lançamentos sejam conectados ao motor de projeção.">
          <p className="cf-muted">Esta é uma pré-visualização da identidade visual e da navegação.</p>
        </CfCard>
      </div>
    </AppShell>
  );
}
