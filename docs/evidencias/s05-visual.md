# Revisão visual — Sprint 5 (simulador)

Chromium headless 1.65 (Playwright), dados fictícios da demonstração, atraso de R$ 4.000 de 15/11 em 2 dias. Capturas em `docs/evidencias/capturas/e2e-s05-*.png` (regeneradas a cada `npm run test:e2e`).

## Medido no DOM (E2E, três viewports)
Sem rolagem horizontal da página **e da tabela "Saldo por dia"**, nenhum alvo < 44 px em `main` (botões, selects, inputs, summary), nenhum controle sem nome acessível, nenhum erro de console. 390×844, 768×1024 e 1440×900 passam, localmente e no container.

## Olhado nas imagens
- **390×844:** abas "Original" e "Alternativa (hipótese)" lado a lado no topo, resumo da aba ativa com selo "Hipótese" e borda tracejada, resumo da Diferença sempre visível, linhas empilhadas com rótulo ("Alternativa (hipótese)", "Diferença"). A 1ª captura mostrou o selo de alerta **cortado**; depois da correção ele quebra em duas linhas e cabe.
- **768×1024:** três resumos em colunas (a Alternativa com borda tracejada e selo), tabela de quatro colunas com divisória tracejada antes da Alternativa; selos de risco em texto ("Abaixo do mínimo", "Saldo negativo").
- **1440×900:** três cartões de hipótese lado a lado, lista de hipóteses ativas com "Remover", comparação em colunas. A barra lateral que aparece no meio da captura de página inteira é artefato do recorte (barra fixa), não do layout.
- A hipótese é distinguida por **texto + forma** (selo "Hipótese", borda tracejada, cabeçalho "Alternativa (hipótese)"), sem token de cor novo; `validar_design.py` passa.

## Não verificado
Contraste medido das telas novas; foco por teclado visto no navegador (as setas das abas e a ordem de Tab estão cobertas só em jsdom); leitor de tela; zoom 200%; modo escuro (inexistente); capturas do estado de erro do simulador; outros navegadores.
