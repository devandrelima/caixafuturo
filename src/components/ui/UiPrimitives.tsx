import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Join = (string | false | undefined)[];
const cx = (...parts: Join) => parts.filter(Boolean).join(' ');

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface CfButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  block?: boolean;
}

export function CfButton({ variant = 'secondary', loading = false, block = false, type = 'button', disabled, className, children, ...rest }: CfButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('cf-btn', `cf-btn--${variant}`, block && 'cf-btn--block', className)}
    >
      {loading && <span className="cf-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export interface CfCardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
  children?: ReactNode;
}

export function CfCard({ title, description, actions, headingLevel = 2, className, children }: CfCardProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <section className={cx('cf-card', className)}>
      {(title || actions) && (
        <div className="cf-card__head">
          <div>
            {title && <Heading className="cf-card__title">{title}</Heading>}
            {description && <p className="cf-card__desc">{description}</p>}
          </div>
          {actions && <div className="cf-card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = 'neutral' | 'positive' | 'warning' | 'negative' | 'demo';

export function CfBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('cf-badge', `cf-badge--${tone}`)}>{children}</span>;
}

export interface CfAlertProps {
  tone?: Exclude<Tone, 'demo'>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function CfAlert({ tone = 'neutral', title, children, action }: CfAlertProps) {
  return (
    <div className={cx('cf-alert', `cf-alert--${tone}`)} role={tone === 'negative' ? 'alert' : 'status'}>
      <strong className="cf-alert__title">{title}</strong>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

interface FieldChrome {
  label: string;
  hint?: string;
  error?: string;
}

function useFieldIds(id?: string) {
  const generated = useId();
  const base = id ?? generated;
  return { base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

function describedBy(hint: string | undefined, error: string | undefined, hintId: string, errorId: string) {
  const ids = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ');
  return ids || undefined;
}

export interface CfFieldProps extends InputHTMLAttributes<HTMLInputElement>, FieldChrome {}

export function CfField({ label, hint, error, id, className, ...input }: CfFieldProps) {
  const { base, hintId, errorId } = useFieldIds(id);
  return (
    <div className={cx('cf-field', className)}>
      <label className="cf-field__label" htmlFor={base}>
        {label}
        {input.required ? ' *' : ''}
      </label>
      <input
        {...input}
        id={base}
        className="cf-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, error, hintId, errorId)}
      />
      {hint && (
        <span id={hintId} className="cf-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="cf-field__error">
          {error}
        </span>
      )}
    </div>
  );
}

export interface CfSelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldChrome {}

export function CfSelect({ label, hint, error, id, className, children, ...select }: CfSelectProps) {
  const { base, hintId, errorId } = useFieldIds(id);
  return (
    <div className={cx('cf-field', className)}>
      <label className="cf-field__label" htmlFor={base}>
        {label}
      </label>
      <select
        {...select}
        id={base}
        className="cf-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, error, hintId, errorId)}
      >
        {children}
      </select>
      {hint && (
        <span id={hintId} className="cf-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="cf-field__error">
          {error}
        </span>
      )}
    </div>
  );
}
