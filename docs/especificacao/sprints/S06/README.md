# S06 — Simulações financeiras avançadas

## Valor e viabilidade
Usuário avalia compras, contratações, mudanças com fornecedores e antecipação com custos explícitos.

Funcionalidades aprovadas preservadas: **F23** Equipamento e parcelamento; **F24** Contratação; **F25** Vencimento fornecedores; **F26** Antecipação recebíveis.

Situação: **implementada e aprovada pelo usuário em 13/11/2026** (última sprint do plano). Evidências em `docs/evidencias/s06.md` e `s06-visual.md`; decisões na [ADR-0010](../../../decisoes/0010-simulacoes-avancadas.md). Evolução posterior à candidatura (15/11/2026).

## Demonstração quando implementada
`npm ci && npm run dev` → abrir URL local apresentada pelo Vite. Usar **dados fictícios** e verificar o incremento: Usuário avalia compras, contratações, mudanças com fornecedores e antecipação com custos explícitos. Executar roteiro de aceite manual: identificar entradas, mudar um dado, conferir saldos/resultado por cálculo independente, verificar erro e voltar ao estado anterior.

## Mapas
- [P01](P01.md): Compras e contratação; tasks S06-P01-T01, S06-P01-T02.
- [P02](P02.md): Fornecedores e antecipação; tasks S06-P02-T01, S06-P02-T02.

## Qualidade e aprovação
Cada task testa mudanças locais; ao integrar executar a regressão `npm run test:unit -- --run --coverage`, `npm run test:e2e`, `npm run build` e demos do fluxo anterior. Cobertura do código novo/alterado >=80% **medida**. Checkpoint de risco: executar suíte completa e medir cobertura global >=80%. Registro de evidências reais e **aprovação humana explícita** são obrigatórios para liberar a próxima sprint.
