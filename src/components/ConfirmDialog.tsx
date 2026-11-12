import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { CfButton } from './ui/UiPrimitives';

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo modal acessível: título nomeado, foco inicial em "Cancelar", Tab preso, Escape cancela e devolve o foco. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancelar', tone = 'danger', busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
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

  return (
    <div className="cf-modal" onKeyDown={onKeyDown}>
      <div className="cf-modal__scrim" aria-hidden="true" />
      <div ref={rootRef} className="cf-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
        <h2 id={titleId} className="cf-card__title">
          {title}
        </h2>
        <div id={descId} className="cf-stack" style={{ marginTop: 8 }}>
          {children}
        </div>
        <div className="cf-dialog__actions">
          <button ref={cancelRef} type="button" className="cf-btn cf-btn--secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <CfButton variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </CfButton>
        </div>
      </div>
    </div>
  );
}
