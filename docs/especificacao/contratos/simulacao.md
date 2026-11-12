# Contrato de simulação — v1

Scenario = {id, baseSnapshotId, label, adjustments[]}; ajustes tipados: delay_receipt, scale_sales, scale_expense, equipment_purchase, hiring, shift_vendor_due, advance_receivable, com IDs de origem, vigência, valores em centavos e taxas em basis points inteiros. Transformação pura simulate(baseSnapshot, adjustments) -> baseProjection, alternativeProjection, deltaByDate, assumptions, warnings.

Base imutável; cenário é replayável e não modifica IndexedDB de lançamentos reais. Atraso desloca uma entrada, sem duplicá-la. Antecipação remove recebível da data futura e inclui o valor líquido antecipado na nova data, com custo explícito, elegibilidade e taxa configurada. Parcelamento registra principal, encargos, calendário, total; contratação registra custos informados, sem fingir cálculo completo da legislação trabalhista. Não executar transferências, renegociações, contratações ou pagamentos reais. Comparação sempre mantém cenário original visível.

