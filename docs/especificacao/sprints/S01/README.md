# S01 — Primeiro fluxo de caixa funcional

## Valor e viabilidade
Usuário carrega contas sintéticas, ajusta saldo, consulta 30 dias e identifica data e valor de falta de caixa.

Funcionalidades aprovadas preservadas: **F02** Contas pagar/receber; **F03** Saldo inicial e mínimo; **F06** Validação e duplicação; **F14** Fluxo 30 dias; **F18** Risco de saldo; **F19** Datas e déficits; **F28** Dashboard/gráficos/calendário; **F31** Demo sintética restaurante.

Situação: planejada, sem implementação. S01 é prioridade para a candidatura, desejável demo até 13/11.

## Demonstração quando implementada
`npm ci && npm run dev` → abrir URL local apresentada pelo Vite. Usar **dados fictícios** e verificar o incremento: Usuário carrega contas sintéticas, ajusta saldo, consulta 30 dias e identifica data e valor de falta de caixa. Executar roteiro de aceite manual: identificar entradas, mudar um dado, conferir saldos/resultado por cálculo independente, verificar erro e voltar ao estado anterior.

## Mapas
- [P01](P01.md): Base e entrada de dados; tasks S01-P01-T01, S01-P01-T02, S01-P01-T03.
- [P02](P02.md): Projeção, dashboard e demo; tasks S01-P02-T01, S01-P02-T02, S01-P02-T03.

## Qualidade e aprovação
Cada task testa mudanças locais; ao integrar executar a regressão `npm run test:unit -- --run --coverage`, `npm run test:e2e`, `npm run build` e demos do fluxo anterior. Cobertura do código novo/alterado >=80% **medida**. Checkpoint de risco: executar suíte completa e medir cobertura global >=80%. Registro de evidências reais e **aprovação humana explícita** são obrigatórios para liberar a próxima sprint.
