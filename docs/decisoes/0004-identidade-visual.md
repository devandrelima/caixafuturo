# 0004 — Identidade visual warm minimal, cartoonesco contido

Data: 2026-11-11
Status: aceita como direção visual informada pelo usuário; **não aprova implementação de Sprint 1**.

## Contexto e alternativas
Usuário forneceu capturas de um site de comunidade com onboarding espaçoso, fundo creme, amarelo-dourado, sidebar areia, campos suaves e cards arredondados, pedindo ao CaixaFuturo algo "clean e minimalista mas um pouco cartoonesco". Alternativas consideradas: painel financeiro corporativo frio, cópia literal da referência e SaaS amigável com identidade original. Adotada a terceira opção.

## Decisão e motivo
Adotar [guia](../especificacao/design/README.md), [tokens](../especificacao/design/tokens.json), [telas](../especificacao/design/telas/S01.md) e [qualidade](../especificacao/design/qualidade.md). Fundo off-white, grafite, acento dourado e card arredondado; toque lúdico exclusivamente em formas e ilustrações 2D **originais** discretas, não em métricas/alertas. Sinais financeiros usam cores semânticas com texto. Sem copiar personagem, logo, layout exato ou trechos da interface mostrada.

## Impactos e reversibilidade
Contratos UI, memória UI e todas as tasks de interface S01–S06 passam a carregar os documentos seletivamente. Tarefa S01 dedicada à base visual (S01-P02-T04), seguida de integração S01-P02-T02 e QA S01-P02-T03. Mudanças visuais futuras devem atualizar design/tokens, telas/contratos e tasks não concluídas, com regressão e revisão visual. Decisão reversível por novo ADR; aprovação humana da sprint permanece obrigatória.
