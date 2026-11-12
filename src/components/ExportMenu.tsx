import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CfButton } from './ui/UiPrimitives';

export interface ExportResult {
  csv: string;
  rows: number;
  /** Aviso em texto sobre o que ficou de fora ou limites do arquivo. */
  note?: string;
}

export interface ExportItem {
  id: string;
  label: string;
  description: string;
  filename: string;
  build: () => ExportResult;
}

export interface ExportMenuProps {
  items: readonly ExportItem[];
  disabled?: boolean;
  /** Para testes; o padrão baixa o arquivo no navegador, sem enviar nada a servidor. */
  onDownload?: (filename: string, csv: string) => void;
}

/** Gera o download local (Blob). O BOM UTF-8 já faz parte do texto. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Botão secundário "Exportar CSV" com a lista de arquivos possíveis; o arquivo é gerado neste navegador. */
export function ExportMenu({ items, disabled = false, onDownload = downloadCsv }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusTrigger = () => rootRef.current?.querySelector<HTMLButtonElement>('[data-export-trigger]')?.focus();

  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLButtonElement>('[data-export-option]')?.focus();
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
      focusTrigger();
    }
  }

  function run(item: ExportItem) {
    const result = item.build();
    onDownload(item.filename, result.csv);
    setOpen(false);
    focusTrigger();
    setMessage(`${item.filename}: ${result.rows} linha${result.rows === 1 ? '' : 's'} gerada${result.rows === 1 ? '' : 's'} neste navegador; nada foi enviado a servidor.${result.note ? ` ${result.note}` : ''}`);
  }

  return (
    <div className="cf-stack" ref={rootRef} onKeyDown={onKeyDown}>
      <CfButton variant="secondary" data-export-trigger="" onClick={() => setOpen((v) => !v)} disabled={disabled || items.length === 0} aria-expanded={open} aria-controls="export-options">
        Exportar CSV
      </CfButton>
      {open && (
        <div id="export-options" role="group" aria-label="Opções de exportação" className="cf-subcard cf-stack">
          {items.map((item) => (
            <div key={item.id}>
              <CfButton variant="ghost" data-export-option="" onClick={() => run(item)}>
                {item.label}
              </CfButton>
              <p className="cf-subtle">{item.description}</p>
            </div>
          ))}
        </div>
      )}
      {message && (
        <p role="status" className="cf-muted" data-testid="export-status">
          {message}
        </p>
      )}
    </div>
  );
}
