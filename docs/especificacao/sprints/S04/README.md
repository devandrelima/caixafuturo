# S04 — Planejamento ampliado

## Valor e viabilidade
Usuário acompanha recorrências e 13 semanas, filtra lançamentos e exporta CSV consistente.

Funcionalidades aprovadas preservadas: **F05** Recorrências; **F15** Fluxo 13 semanas; **F29** Filtros/detalhe; **F30** Exportação CSV.

Situação: planejada, sem implementação. Evolução posterior à candidatura (15/11/2026).

## Demonstração quando implementada
`npm ci && npm run dev` → abrir URL local apresentada pelo Vite. Usar **dados fictícios** e verificar o incremento: Usuário acompanha recorrências e 13 semanas, filtra lançamentos e exporta CSV consistente. Executar roteiro de aceite manual: identificar entradas, mudar um dado, conferir saldos/resultado por cálculo independente, verificar erro e voltar ao estado anterior.

## Mapas
- [P01](P01.md): Recorrências e horizonte; tasks S04-P01-T01, S04-P01-T02.
- [P02](P02.md): Filtros e exportação; tasks S04-P02-T01, S04-P02-T02.

## Qualidade e aprovação
Cada task testa mudanças locais; ao integrar executar a regressão `npm run test:unit -- --run --coverage`, `npm run test:e2e`, `npm run build` e demos do fluxo anterior. Cobertura do código novo/alterado >=80% **medida**. Suíte completa no checkpoint S03/S06 ou antecipada se risco mudar. Registro de evidências reais e **aprovação humana explícita** são obrigatórios para liberar a próxima sprint.
