# S02 — Vendas e recebimentos futuros

## Valor e viabilidade
Usuário importa vendas, configura repasses e distingue faturamento, recebimento e dinheiro disponível sem dupla contagem.

Funcionalidades aprovadas preservadas: **F01** CSV histórico de vendas; **F04** Pix/cartão/taxas/prazos; **F07** Médias e tendências; **F12** Projeção manual; **F13** Venda -> recebível; **F16** Confirmado/previsto/hipotético; **F20** Explicação de riscos.

Situação: planejada, sem implementação. S02 somente após aceite humano de S01 e se houver tempo antes de 15/11.

## Pendência técnica obrigatória — PEND-S02-001
Conciliação **entre recebíveis do CSV de contas da S01 e recebíveis derivados do CSV de vendas da S02**: IDs distintos não impedem dupla contagem do mesmo repasse. A política de vínculo (1:1, parcelas e lotes), prioridade, ambiguidades e revisão humana ainda precisa ser fechada antes da implementação do serviço de repasse. Responsável principal **S02-P01-T02**; interface/regressão **S02-P02-T02**. O gate S02 exige testes com ambas as ordens de importação e reimportações. [Registro e critérios completos](../../pendencias/S02-conciliacao-recebiveis.md).

## Demonstração quando implementada
`npm ci && npm run dev` → abrir URL local apresentada pelo Vite. Usar **dados fictícios** e verificar o incremento: Usuário importa vendas, configura repasses e distingue faturamento, recebimento e dinheiro disponível sem dupla contagem. Executar roteiro de aceite manual: identificar entradas, mudar um dado, conferir saldos/resultado por cálculo independente, verificar erro e voltar ao estado anterior.

## Mapas
- [P01](P01.md): Vendas e repasses; tasks S02-P01-T01, S02-P01-T02.
- [P02](P02.md): Previsão manual e explicações; tasks S02-P02-T01, S02-P02-T02.

## Qualidade e aprovação
Cada task testa mudanças locais; ao integrar executar a regressão `npm run test:unit -- --run --coverage`, `npm run test:e2e`, `npm run build` e demos do fluxo anterior. Cobertura do código novo/alterado >=80% **medida**. Checkpoint de risco: executar suíte completa e medir cobertura global >=80%. Registro de evidências reais e **aprovação humana explícita** são obrigatórios para liberar a próxima sprint.
