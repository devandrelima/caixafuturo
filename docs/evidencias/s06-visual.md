# Revisão visual — Sprint 6 (decisões avançadas no Simulador)

Chromium headless 1.65 (Playwright), dados fictícios da demonstração, 13/11/2026. Capturas em `docs/evidencias/capturas/e2e-s06-*.png` (regeneradas a cada `npx playwright test`): `painel-compra-aberto`, `custos-datas`, `comparacao` e `simulador` (página inteira) em 390×844, 768×1024 e 1440×900. Cenário: compra de R$ 10.000 em 3×, contratação, novo vencimento e antecipação na mesma Alternativa.

## Medido no DOM (E2E, três viewports; local e container)
Sem rolagem horizontal da página **e das tabelas** ("Saldo por dia" e "Lançamentos hipotéticos criados"), nenhum alvo < 44 px em `main` (botões, selects, inputs, `summary`), nenhum controle sem nome acessível, nenhum erro de console. **Teclado no Chromium real:** `Enter` abre e fecha o painel (`<details>`), `Tab` chega ao primeiro campo, que mostra o contorno de foco.

## Olhado nas imagens
- **390×844:** painel aberto com rótulos acima dos campos, ajuda em texto pequeno e botão primário em duas linhas, sem corte; "Custos, datas e mudanças" com premissas em lista legível (longa, mas completa), mudanças "de → para" e os lançamentos hipotéticos como cartões empilhados (Descrição · Valor · Situação) com selo "Hipótese" e, nas parcelas fora de 30 dias, "Fora do horizonte". A faixa "Simulador" no meio da captura de elemento é a barra superior fixa (artefato do recorte).
- **768×1024:** tabela de lançamentos criados em quatro colunas; o selo "Fora do horizonte" quebra em duas linhas na coluna Situação, sem estouro; três resumos lado a lado (a Alternativa com borda tracejada e selo "Hipótese").
- **1440×900:** os quatro painéis abertos em coluna, lista de hipóteses ativas com "Remover", alerta de atenção com os avisos (parcelas fora do horizonte, dias a mais em risco), texto de custos e datas **acima** do resumo e da tabela e comparação em colunas com divisória tracejada.
- A hipótese é distinguida por **texto + forma** (selo "Hipótese", borda tracejada, cabeçalho "Alternativa (hipótese)"), sem token de cor novo; `validar_design.py` passa.
- Crítica honesta: a lista de premissas, com as quatro decisões e a S05, fica **longa**; está aberta de propósito (custo e data em texto antes), mas pode cansar em telas pequenas.

## Não verificado
Contraste medido das telas novas; leitor de tela; zoom 200%; modo escuro (inexistente); capturas dos estados de erro dos formulários; setas das abas Original/Alternativa no navegador real; outros navegadores; aparelho móvel real.
