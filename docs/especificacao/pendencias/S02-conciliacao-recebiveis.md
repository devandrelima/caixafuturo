# PEND-S02-001 — Conciliação de recebíveis importados versus derivados de vendas

**Status:** **decisão registrada em 12/11/2026** ([ADR-0006](../../decisoes/0006-conciliacao-recebiveis.md)); implementação e prova (testes/E2E/UI) ainda exigidas pelo gate abaixo. Parcelas e lotes: **limitação documentada** (não suportados).  
**Responsável por resolução e prova:** executor/integrador de `S02-P01-T02`, revisado em `S02-P02-T02`; aprovação pelo humano no gate da Sprint 2.  
**Risco:** alta prioridade — **duplicação de entradas financeiras e saldo projetado incorreto**.

## Problema
O mesmo repasse de cartão/Pix pode existir como **conta a receber importada** (CSV de contas da S01) e como **recebível líquido calculado** a partir de vendas importadas (CSV de vendas da S02). A deduplicação por `sourceKey` **dentro de um tipo de CSV** não basta para deduplicar **entre origens diferentes**. Importar ambos sem conciliação faz a projeção contar o mesmo dinheiro duas vezes.

## Contrato a fechar antes de implementar S02-P01-T02
- Preservar identificadores de venda, identificador externo do recebível, referência de transação/lote/repasse quando disponível, origem e data; não descartar rastreabilidade.
- Definir **chave de conciliação entre origens**, prioridades entre entrada confirmada/importada e derivada/estimada, estados do vínculo e efeitos de atualização/cancelamento. Compatibilizar com `CashEntry.linkedSaleId` e o domínio financeiro.
- Evitar correspondência automática **somente por valor e data**: repasses coincidentes são possíveis. Quando faltar vínculo confiável, manter registro sinalizado como **conciliação pendente** e exigir revisão explícita em vez de contabilizar ambas as entradas sem aviso ou inventar coincidência.
- Decidir política para repasses agregados (N vendas → 1 recebível), parcelados (1 venda → N repasses), taxas divergentes, pagamento parcial e alteração da data do repasse; registrar decisão e testes **antes da implementação**. Não assumir que o modelo atual de relação 1:1 resolve esses casos.
- Garantir que o motor projete **uma única disponibilidade por recebimento econômico**, sem duplicação, mantendo explicação da origem. Reimportações são idempotentes e não removem lançamentos legítimos de forma silenciosa.

## Testes obrigatórios e aceite da Sprint 2
1. Importar **primeiro contas, depois vendas**, e inverter a ordem; resultado de caixa deve ser idêntico quando houver vínculo explícito.
2. Reimportar ambos os arquivos e reprocessar repasses; nenhuma entrada é duplicada.
3. Para o mesmo repasse com valor/data similares e **sem chave confiável**, exibir a pendência e não somar automaticamente uma segunda disponibilidade; permitir resolução explícita verificável.
4. Para repasse de várias vendas, parcelas e taxas distintas, validar se contrato cobre ou marcar como **limitação bloqueadora** de uma funcionalidade oferecida (não fingir suporte).
5. A UI distingue valores importados, derivados, conciliados e pendentes, e informa efeito sobre o saldo.
6. Ao editar, liquidar ou cancelar um dos registros, não reaparecem duas entradas.

**Gate:** S02 não pode ser declarada concluída sem decisão registrada, algoritmo/estado de conciliação e testes locais/E2E demonstrando ausência de dupla contagem entre CSV de contas e CSV de vendas. Esta pendência **não bloqueia a Sprint 1** nem autoriza implementá-la.
