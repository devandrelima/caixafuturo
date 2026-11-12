# Revisão visual — Sprint 1 (modelo de `design/REVISAO_VISUAL_MODELO.md`)

**Task:** S01-P02-T03 · **Commit do app:** `a463e33` · **Ambiente:** Chromium headless 1.65 (Playwright), VPS Linux, sem tela física. Capturas reais em [`capturas/`](capturas/) geradas pelo E2E (do container pelo IP público). Responsável pela decisão final: **o usuário** (esta revisão não é aprovação).

| Critério | Estado | Evidência |
|---|---|---|
| Captura desktop 1440×900 | Aprovado | `capturas/desktop-{visao-geral,movimentacoes,calendario}.png` |
| Captura tablet 768×1024 | Aprovado | `capturas/tablet-*.png` |
| Captura mobile 390×844 | Aprovado com ressalvas | `capturas/mobile-*.png` (ver achados A e B) |
| Onboarding + demo opt-in | Aprovado | `e2e-onboarding.png`; E2E confirma que nada carrega sem clique |
| Paleta e espaçamentos conforme tokens | Aprovado | inspeção visual (creme/areia/grafite/dourado, cantos arredondados); teste unitário confere cada token ↔ CSS; sem hex fora de `:root` |
| Navegação teclado/foco/Escape | Aprovado | E2E: foco com outline ≥ 2px, Tab preso no menu/diálogo, Escape devolve o foco |
| Sem scroll horizontal da página | Aprovado (≥ 260px) / **Reprovado a 195px** | E2E nos 3 viewports + reflow 320px: sem rolagem; diagnóstico a 195px: estouro (achado C) |
| Contraste WCAG e gráfico tabular | Parcial | contraste dos tokens ≥ 4,5:1 via `validar_design.py` (não medido na página); gráfico tem tabela alternativa, tooltip por teclado e marcadores por forma (■ negativo, ● abaixo do mínimo) |
| Estados vazio/sem risco/risco/erro | Aprovado | `estado-sem-saldos.png`, `estado-sem-risco.png`, `estado-abaixo-minimo.png`; negativo em `*-visao-geral.png`; erros de storage e CSV cobertos por testes de integração |
| Saldo e riscos conferidos com o motor | Aprovado | E2E compara tabela, tooltip do gráfico e calendário com o contrato |
| Importação e duplicados com UX explícita | Aprovado | `e2e-importacao-previa.png`; contadores a importar / já importados / com erro |
| Mobile 200% de zoom e reduced motion | Parcial | reduced motion verificado; zoom: aprovado até o piso WCAG de 320px, **reprovado a 195px** (achado C) |

## Achados (corrigir só via replanejamento da T02/T04; a T03 não edita produção)
- **A (baixo).** Mobile: o título da barra superior trunca ("Moviment…") quando o selo "Dados fictícios" está visível.
- **B (médio, usabilidade).** Mobile: na tabela de lançamentos as colunas Valor, Situação e Ações ficam fora da tela e exigem rolagem **interna** da tabela, sem indício visual; editar/excluir no celular é pouco descobrível. Uma lista em cartões no mobile resolveria.
- **C (baixo, extremo).** 195px CSS (200% de zoom em celular de 390px): estouro horizontal no menu em gaveta (itens passam da largura) e em *Movimentações* (cabeçalho/alerta). De 260px para cima nenhum estouro.

## Skills de design
Inventário: não há skill de frontend/design React instalada nesta sessão. Foi usada a skill `dataviz` (disponível) como guia do gráfico: série única sem legenda de série, linha de 2px, marcadores ≥ 8px com forma por risco, tabela alternativa, hover/teclado, cores só dos tokens do projeto. Não foi usado validador de paleta categórica (série única). **Fallback:** revisão manual guiada por `design/qualidade.md`.

## Comandos efetivamente executados
`npm run test:unit -- --run --coverage` (219 testes) · `npx playwright test` local (17/17) e contra o container por IP (17/17) · `npm run build`. Cobertura global 93,16% stmts / 87,66% branches (detalhes em [`s01.md`](s01.md)).

Este documento não substitui a avaliação humana da Sprint 1.
