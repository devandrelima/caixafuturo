# S01 — Primeiro fluxo de caixa funcional

## Valor e viabilidade
Usuário carrega contas sintéticas, ajusta saldo, consulta 30 dias e identifica data e valor de falta de caixa.

Funcionalidades aprovadas preservadas: **F02** Contas pagar/receber; **F03** Saldo inicial e mínimo; **F06** Validação e duplicação; **F14** Fluxo 30 dias; **F18** Risco de saldo; **F19** Datas e déficits; **F28** Dashboard/gráficos/calendário; **F31** Demo sintética restaurante.

Situação: planejada, sem implementação. S01 é prioridade para a candidatura, desejável demo até 13/11.

## Demonstração quando implementada
`npm ci && npm run dev` → abrir URL local apresentada pelo Vite. Usar **dados fictícios** e verificar o incremento: Usuário carrega contas sintéticas, ajusta saldo, consulta 30 dias e identifica data e valor de falta de caixa. Executar roteiro de aceite manual: identificar entradas, mudar um dado, conferir saldos/resultado por cálculo independente, verificar erro e voltar ao estado anterior.

## Mapas
- [P01](P01.md): Base e entrada de dados; tasks S01-P01-T01, S01-P01-T02, S01-P01-T03.
- [P02](P02.md): Projeção, dashboard e demo; tasks S01-P02-T01 (motor), S01-P02-T04 (fundação visual), S01-P02-T02 (UI + dataset demo criado, testado e conectado) e S01-P02-T03 (apenas E2E, revisão visual e evidências).

## Frontend especificado
A task visual separada utiliza [guia](../../design/README.md), [tokens](../../design/tokens.json), [componentes](../../design/componentes.md), [wireframes de S01](../../design/telas/S01.md) e [qualidade](../../design/qualidade.md). A UI terá três vistas funcionais e onboarding opcional; não apresentar números estáticos, links falsos ou conteúdo de sprints futuras. Inspeção em 390×844, 768×1024 e 1440×900, com evidência de execução quando houver app.

## Contrato de responsabilidades da demonstração
**T02 entrega o fluxo já executável:** dataset `src/demo/restaurant.ts`, testes unitários da fixture, callback de onboarding conectado em `src/app/App.tsx`, persistência/limpeza confirmadas, dashboard calculado e README atualizado. **T03 é exclusivamente QA:** lê app e fixture, escreve teste Playwright e documentos de evidências. Falha identificada em T03 exige retorno ou replanejamento da T02; não usar escrita fora do manifesto para "consertar a demo". [Fonte de dados e saldos esperados](../../contratos/demo-s01.md).

## Qualidade e aprovação
Cada task testa mudanças locais; ao integrar executar a regressão `npm run test:unit -- --run --coverage`, `npm run test:e2e`, `npm run build` e demos do fluxo anterior. Cobertura do código novo/alterado >=80% **medida**. Checkpoint de risco: executar suíte completa e medir cobertura global >=80%. Registro de evidências reais e **aprovação humana explícita** são obrigatórios para liberar a próxima sprint.
