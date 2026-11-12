import { CfAlert, CfButton } from './ui/UiPrimitives';

export interface OnboardingProps {
  onExploreDemo: () => void;
  onStartEmpty: () => void;
  isLoading?: boolean;
  errorMessage?: string;
}

/** Ilustração original e estática: uma moeda sorridente com um brilho. */
function CoinArt() {
  return (
    <svg className="cf-onboarding__art" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <ellipse cx="48" cy="86" rx="26" ry="5" fill="var(--cf-surface-secondary)" />
      <circle cx="48" cy="46" r="34" fill="var(--cf-accent)" stroke="var(--cf-text)" strokeWidth="3" />
      <circle cx="48" cy="46" r="25" fill="none" stroke="var(--cf-accent-active)" strokeWidth="3" strokeDasharray="4 5" />
      <circle cx="38" cy="42" r="3.5" fill="var(--cf-text)" />
      <circle cx="58" cy="42" r="3.5" fill="var(--cf-text)" />
      <path d="M37 55 Q48 65 59 55" fill="none" stroke="var(--cf-text)" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M80 14 v10 M75 19 h10" stroke="var(--cf-chart-primary)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Onboarding({ onExploreDemo, onStartEmpty, isLoading = false, errorMessage }: OnboardingProps) {
  return (
    <main className="cf-onboarding">
      <div className="cf-onboarding__inner">
        <CoinArt />
        <h1 className="cf-onboarding__title">Seu caixa, sem surpresas.</h1>
        <p className="cf-onboarding__lead">Veja quando uma conta pode apertar o caixa do seu negócio.</p>
        {errorMessage && (
          <CfAlert tone="negative" title="Não foi possível continuar">
            {errorMessage}
          </CfAlert>
        )}
        <div className="cf-onboarding__actions">
          <div className="cf-onboarding__choice">
            <CfButton variant="primary" block loading={isLoading} onClick={onExploreDemo}>
              Explorar demonstração
            </CfButton>
            <span className="cf-subtle">Dados fictícios de um restaurante</span>
          </div>
          <div className="cf-onboarding__choice">
            <CfButton variant="secondary" block disabled={isLoading} onClick={onStartEmpty}>
              Começar com meus dados
            </CfButton>
            <span className="cf-subtle">Cadastro manual ou CSV</span>
          </div>
        </div>
        <p className="cf-onboarding__note">Seus dados ficam neste navegador. O CaixaFuturo não é uma conta bancária.</p>
      </div>
    </main>
  );
}
