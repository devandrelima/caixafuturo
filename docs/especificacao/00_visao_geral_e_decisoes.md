# Visão geral e decisões — CaixaFuturo

## Produto e público
Produto web open source para comerciantes e restaurantes: antecipar riscos de caixa e simular decisões com histórico e cálculos verificáveis. Pergunta principal: quando e quanto vai faltar, por quê? Distinguir venda bruta, recebimento agendado e caixa disponível. Sem API de IA para o usuário final.

## Escopo e viabilidade
**Agora, prioridade para candidatura em 15/11/2026:** Sprint 1 concluída e demonstrável até 13/11, com dados de restaurante sintético; Sprint 2 apenas se a primeira for aprovada, com esforço em 14/11. **Depois:** Sprints 3–6. **Não construir:** integração bancária, pagamentos reais, autenticação por convenção, backend distribuído, modelo de IA externo, dados verdadeiros em demo pública. As 31 funcionalidades permanecem no plano, sem exclusões.
Equipe/capacidade em horas: não informada; registrar execução real e ajustar prazo, sem presumir velocidade de agentes. Orçamento: priorizar execução local gratuita.

## Stack proposta
Vite + React + TypeScript strict (app SPA); IndexedDB nativo (dados só no navegador; ausência de sincronização deve ser divulgada); domínio financeiro com funções puras; BigInt para centavos e strings decimais inteiras no JSON; datas civis ISO YYYY-MM-DD; Vitest + coverage-v8 + Testing Library + fake-indexeddb + Playwright. SVG/tabela acessível para gráficos inicialmente, sem exigir biblioteca pesada. npm ci e npm run dev após implementação. Execução containerizada: Docker multi-stage (Node → Nginx), `compose.yaml`, sem credenciais (ADR-0005). Nenhum código de aplicativo existe no planejamento.

## Decisões e ADRs
- ADR-0001: local-first, sem autenticação/servidor, por prazo, custo e simplicidade.
- ADR-0002: saldos em centavos exatos, data-base conciliada, chaves de origem idempotentes.
- ADR-0003: baseline estatístico, comparação temporal e previsão sem promessas de precisão.
- ADR-0005: execução em Docker (Nginx estático, porta 8084) e SHA-256 puro por causa de contexto HTTP não seguro.
- ADR-0004: direção visual minimalista quente com dourado e detalhes cartoonesco 2D originais, conforme referência enviada pelo usuário.

## Contratos canônicos
[Financeiro](contratos/financeiro.md), [CSV](contratos/importacao.md), [Previsões](contratos/previsoes.md), [Simulação](contratos/simulacao.md), [Interface](contratos/interface.md), [design](design/README.md), [tokens](design/tokens.json), [telas](design/telas/S01.md). Alterar contratos compartilhados exige ADR e revisão dos contextos das tasks.

## Testes e gates
Task: teste local reproduzível, antes de implementar quando possível. Sprint: regressão afetada, demonstração ponta a ponta, cobertura do código alterado >=80% medida. Checkpoint: S03 e S06, e antecipação por risco alto (S01/S02/S06), suíte completa e cobertura global >=80% medida. CLI valida manifestos e dependências, não testes do produto. Toda sprint precisa de aprovação humana antes de liberar a seguinte.

## Riscos e pendências
- Janela 11–15/11 muito curta: confiabilidade da S01 prevalece sobre S02.
- CSV sem identificador externo pode confundir lançamentos idênticos: exigir chave externa para duplicatas legítimas.
- Float, fuso e duplicação de recebíveis: testes invariantes e contratos estritos.
- **PEND-S02-001 (aberta):** conciliar recebíveis importados por CSV de contas versus recebíveis gerados de vendas, inclusive vínculos ambíguos, parcelas e lotes; responsabilidade S02-P01-T02, validação S02-P02-T02; [registro](pendencias/S02-conciliacao-recebiveis.md).
- IndexedDB não é backup: documentar limitação, exportação na S04.
- Histórico insuficiente: avisos e projeção manual identificada, sem inventar acurácia.
- Navegador/Playwright e ambiente de CI podem demandar instalação: registrar resultado concreto.
- Aprovação do planejamento e autorização para programar são decisões humanas separadas.

