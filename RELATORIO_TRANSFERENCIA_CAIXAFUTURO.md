# RELATÓRIO DE TRANSFERÊNCIA — CAIXAFUTURO

**Elaborado em:** 11/11/2026, horário local do Brasil (execução GitHub Actions registrada em 12/11 UTC).  
**Repositório:** https://github.com/devandrelima/caixafuturo  
**Branch:** main  
**Commits importantes:** planejamento completo `45a6597a0282dfbdcf0d62694c541707d82daefc`; workflow validado no commit `ddf1de45e91885bdd7da31e8f916a6c26af3580f`.  
**Último commit da branch:** verificar https://github.com/devandrelima/caixafuturo/commits/main (o próprio relatório gera um commit posterior ao de validação).

## 1. Status e metodologia
Skill oficial: https://github.com/devandrelima/planejamento-de-sistemas, versão 2.0, commit `76c187894d15ff2ecd744a25cc195feb68d72b0d`. Hierarquia de execução: PROJETO → SPRINT → PROMPT-MAPA → TASK. Repositório CaixaFuturo inicialmente vazio; foi iniciado exclusivamente com **documentação, manifesto, workflow de validação e estado**. Não há aplicação funcional, teste de produto executado ou cobertura medida.

## 2. Arquivos criados
- `README.md`; `docs/especificacao/README.md`; `docs/especificacao/00_visao_geral_e_decisoes.md`; `docs/especificacao/plano.json`; `ESTADO.json`.
- `docs/especificacao/sprints/S01/` a `S06/`: seis resumos, **12 mapas humanos** (`P01.md` e `P02.md` por sprint), **27 tasks JSON** (`tasks/Tnn.json`).
- `docs/especificacao/memoria/`: memórias `global.md`, `financeiro.md`, `importacao.md`, `previsoes.md`, `simulacao.md`, `ui.md`.
- `docs/especificacao/contratos/`: `financeiro.md`, `importacao.md`, `previsoes.md`, `simulacao.md`, `interface.md`, `demo-s01.md`.
- `docs/decisoes/`: quatro ADRs (a quarta define direção visual do usuário); `docs/especificacao/evidencias/README.md`; `.github/workflows/validar-planejamento.yml`; este relatório.

## 3. Validação executada de verdade
GitHub Actions: https://github.com/devandrelima/caixafuturo/actions/runs/43125706368
- Job `planejamento`: **success** com checkout do script oficial fixado na revisão acima.
- `fluxo.py --repo . validar`: `{"errors": 0, "findings": []}`.
- `fluxo.py --repo . prontas`: sprint `S01`; task pronta `S01-P01-T01`; `parallel_batch` igual a `["S01-P01-T01"]`; gate `execucao` da CLI (não representa autorização humana para começar programação).
- `fluxo.py --repo . contexto S01-P01-T01 --saida /tmp/caixafuturo-primeira-task.md`: executado com sucesso; 3 arquivos contextuais, estimativa **1.004 tokens**, orçamento **8.000** (não é consumo real/faturado).
- O estado `ESTADO.json` registra todas as tasks **pendentes** e todas as sprints com `human_approved=false`. Nenhuma cobertura, teste de produto, desempenho ou economia de tokens pode ser declarada.

## 4. Sprints planejadas (todas as 31 funcionalidades)
| Sprint | Itens do escopo | Entrega |
|---|---|---|
| S01 | 02,03,06,14,18,19,28,31 | Contas, saldo, CSV, caixa 30 dias, risco, calendário/dashboard, demo sintética |
| S02 | 01,04,07,12,13,16,20 | Vendas, meios/taxas/prazos, médias, projeção manual, recebíveis, estados e explicação |
| S03 | 08,09,10,11,17 | Sazonalidade, modelos, backtesting, faixas, previsto x realizado |
| S04 | 05,15,29,30 | Recorrências, horizonte 13 semanas, filtros, exportação |
| S05 | 21,22,27 | Atrasos/choques e comparação de cenários |
| S06 | 23,24,25,26 | Equipamentos, contratações, fornecedores, antecipações |

## 5. Entrega exata da Sprint 1
Vite + React + TypeScript com IndexedDB local; dinheiro BigInt/centavos strings, datas civis; cadastro/importação de pagar/receber com idempotência e erros por linha; saldo inicial/mínimo; motor determinístico de 30 dias, alertas negativos/abaixo mínimo, justificativa por lançamento; dashboard, gráfico/tabela, calendário; dataset de restaurante fictício, teste E2E e cobertura medida. O contrato `demo-s01.md` fixa resultados que o código futuro precisa reproduzir: 12/11 saldo R$ 500 e déficit R$ 500; 14/11 saldo -R$ 700 e déficit R$ 1.700.

**7 tasks da S01:** P01 T01 (base financeira), T02 (persistência), T03 (CSV); P02 T01 (projeção), T04 (base visual), T02 (UI integrada), T03 (demo/E2E/revisão visual). Contratos definidos previamente; execução paralela somente depois da primeira task e com ausência de colisões.

## 6. Prioridade para candidatura e riscos
Meta de candidatura **15/11/2026**: S01 confiável, testada e demonstrável até 13/11; S02 apenas se a S01 for aprovada e couber no tempo de 14/11. S03–S06 ficam no roadmap. Riscos: cronograma curto, deduplicação, reais/datas, dados armazenados apenas no browser, falta de backtesting, confiabilidade de testes E2E. Não utilizar dados pessoais nem bancários reais. A aprovação do planejamento é distinta da autorização de iniciar a programação.

## 7. Próxima ação recomendada
Solicitar **revisão e aprovação humana do planejamento**. Após autorização expressa para implementar, executar no clone local do CaixaFuturo:

```bash
git clone https://github.com/devandrelima/planejamento-de-sistemas.git ../planejamento-de-sistemas
git -C ../planejamento-de-sistemas checkout 76c187894d15ff2ecd744a25cc195feb68d72b0d
python3 ../planejamento-de-sistemas/skills/planejamento-de-sistemas/scripts/fluxo.py --repo . prontas
python3 ../planejamento-de-sistemas/skills/planejamento-de-sistemas/scripts/fluxo.py --repo . contexto S01-P01-T01
```

Não codificar antes de autorização. Ao encerrar cada sprint: logs reais, regressão, cobertura, demo e aceite humano. Auditoria independente deve conferir GitHub Actions e os contratos, além de validar os resultados de produto quando vierem a existir.

## Complemento frontend — 11/11/2026
A direção enviada em capturas foi documentada de forma autocontida em `docs/especificacao/design/`: guia, tokens, componentes, telas S01, evolução S02–S06, critérios visuais e template de auditoria. O contrato UI foi atualizado para v2 e ADR-0004 registrado. Foi adicionada a task **S01-P02-T04** para construção do sistema visual antes da task S01-P02-T02 de integração; todas as tasks UI S02–S06 receberam contextos e aceites visuais seletivos. Agora são 27 tasks, 12 mapas, seis sprints, 31 funcionalidades. Verificar CI posterior em GitHub Actions; a aprovação estrutural não autoriza implementação.

## Auditoria complementar da identidade visual (GitHub Actions)

A execução oficial em https://github.com/devandrelima/caixafuturo/actions/runs/43137462086, no commit `4b2dbfc4466d98271f78a66485ca63a3d949d6f1`, terminou **success**. O comando `fluxo.py validar` registrou **0 errors, findings []**; `tools/validar_design.py` verificou **7 documentos**, **25 tokens de cor**, **7 tasks de interface** e contrastes principais de texto **>=4.5:1**. `prontas` manteve `S01-P01-T01` como única task inicial, e seu contexto foi carregado com estimativa de 1.004/8.000 tokens. Isso é validação documental/estrutural, não código de frontend, screenshot, teste do produto ou aceite humano. Relatórios posteriores devem apontar o run correspondente ao novo commit, quando aplicável.
