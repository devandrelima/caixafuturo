import type { ImportPlan, CsvPreview } from '../domain/import/csv';
import { CfAlert, CfBadge, CfButton, CfCard } from './ui/UiPrimitives';

export interface ImportPreviewProps {
  fileName: string;
  preview: CsvPreview;
  plan: ImportPlan;
  importing?: boolean;
  /** Contas já existentes que receberão uma referência de venda nova (S02). */
  referenceUpdates?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Prévia da importação: nada é gravado antes de "Importar". Mostra erro por linha. */
export function ImportPreview({ fileName, preview, plan, importing = false, referenceUpdates = 0, onConfirm, onCancel }: ImportPreviewProps) {
  const { created, ignored, errors } = plan.summary;
  return (
    <CfCard title="Prévia da importação" description={`Arquivo: ${fileName}`}>
      <div className="cf-stack">
        {preview.fatalError ? (
          <CfAlert tone="negative" title="Não foi possível ler o arquivo">
            {preview.fatalError}
          </CfAlert>
        ) : (
          <>
            <div className="cf-row" aria-label="Resumo da prévia">
              <CfBadge tone="positive">{created} a importar</CfBadge>
              <CfBadge tone="neutral">{ignored} já importado(s) ou duplicado(s)</CfBadge>
              <CfBadge tone={errors > 0 ? 'negative' : 'neutral'}>{errors} com erro</CfBadge>
              {referenceUpdates > 0 && <CfBadge tone="warning">{referenceUpdates} referência(s) de venda a atualizar</CfBadge>}
              <span className="cf-subtle">{preview.totalRows} linha(s) de dados</span>
            </div>
            {errors > 0 && (
              <div className="cf-table-wrap">
                <table className="cf-table" aria-label="Linhas com erro">
                  <thead>
                    <tr>
                      <th scope="col">Linha</th>
                      <th scope="col">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.errors.map((e) => (
                      <tr key={e.line}>
                        <th scope="row">{e.line}</th>
                        <td style={{ whiteSpace: 'normal' }}>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {errors > 0 && <p className="cf-subtle">As linhas com erro não serão importadas. Corrija o arquivo e envie de novo, se desejar.</p>}
            {created === 0 && errors === 0 && referenceUpdates === 0 && <p className="cf-muted">Nada novo para importar: todas as linhas já existem.</p>}
          </>
        )}
        <div className="cf-row">
          <CfButton variant="primary" loading={importing} disabled={(created === 0 && referenceUpdates === 0) || preview.fatalError !== null} onClick={onConfirm}>
            {created > 0 ? `Importar ${created} lançamento(s)` : referenceUpdates > 0 ? 'Atualizar referências de venda' : 'Importar'}
          </CfButton>
          <CfButton variant="ghost" onClick={onCancel} disabled={importing}>
            Cancelar
          </CfButton>
        </div>
      </div>
    </CfCard>
  );
}
