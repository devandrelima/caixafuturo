# S05 — Simulador de cenários

## Valor e viabilidade
Usuário simula atrasos e choques, compara alternativas sem modificar o cenário original.

Funcionalidades aprovadas preservadas: **F21** Atrasar recebíveis; **F22** Choque de vendas/despesas; **F27** Comparação de cenários.

Situação: planejada, sem implementação. Evolução posterior à candidatura (15/11/2026).

## Demonstração quando implementada
`npm ci && npm run dev` → abrir URL local apresentada pelo Vite. Usar **dados fictícios** e verificar o incremento: Usuário simula atrasos e choques, compara alternativas sem modificar o cenário original. Executar roteiro de aceite manual: identificar entradas, mudar um dado, conferir saldos/resultado por cálculo independente, verificar erro e voltar ao estado anterior.

## Mapas
- [P01](P01.md): Isolamento e atraso; tasks S05-P01-T01, S05-P01-T02.
- [P02](P02.md): Choques e comparação; tasks S05-P02-T01, S05-P02-T02.

## Qualidade e aprovação
Cada task testa mudanças locais; ao integrar executar a regressão `npm run test:unit -- --run --coverage`, `npm run test:e2e`, `npm run build` e demos do fluxo anterior. Cobertura do código novo/alterado >=80% **medida**. Suíte completa no checkpoint S03/S06 ou antecipada se risco mudar. Registro de evidências reais e **aprovação humana explícita** são obrigatórios para liberar a próxima sprint.
