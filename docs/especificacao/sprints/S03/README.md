# S03 — Inteligência estatística

## Valor e viabilidade
Usuário compara baselines/modelos e erros históricos e vê estimativas justificadas versus realizado.

Funcionalidades aprovadas preservadas: **F08** Sazonalidade; **F09** Comparação modelos; **F10** Backtesting; **F11** Faixas de previsão; **F17** Previsto versus realizado.

Situação: planejada, sem implementação. Evolução posterior à candidatura (15/11/2026).

## Demonstração quando implementada
`npm ci && npm run dev` → abrir URL local apresentada pelo Vite. Usar **dados fictícios** e verificar o incremento: Usuário compara baselines/modelos e erros históricos e vê estimativas justificadas versus realizado. Executar roteiro de aceite manual: identificar entradas, mudar um dado, conferir saldos/resultado por cálculo independente, verificar erro e voltar ao estado anterior.

## Mapas
- [P01](P01.md): Sazonalidade e modelos; tasks S03-P01-T01, S03-P01-T02.
- [P02](P02.md): Backtesting e exposição; tasks S03-P02-T01, S03-P02-T02.

## Qualidade e aprovação
Cada task testa mudanças locais; ao integrar executar a regressão `npm run test:unit -- --run --coverage`, `npm run test:e2e`, `npm run build` e demos do fluxo anterior. Cobertura do código novo/alterado >=80% **medida**. Checkpoint de risco: executar suíte completa e medir cobertura global >=80%. Registro de evidências reais e **aprovação humana explícita** são obrigatórios para liberar a próxima sprint.
