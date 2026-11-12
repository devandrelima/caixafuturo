# Revisão visual — Sprint 3 (Previsões)

Capturas reais (Chromium headless 1.65, geradas pelo E2E em `docs/evidencias/capturas/`): `mobile|tablet|desktop-previsoes.png` (390×844, 768×1024, 1440×900, página inteira), `e2e-s03-insuficiente.png`, `e2e-s03-previsoes.png`, `e2e-s03-sem-faixa.png`. Revisadas por inspeção das imagens e por medições no DOM. Responsável: executor (IA); **sem revisão humana ainda**.

**Skills de design:** as skills de frontend/design disponíveis no executor são para Artifacts (HTML publicado) e não se aplicam a este app React; fallback manual com `design/qualidade.md`, tokens existentes (nenhuma cor nova) e Playwright.

| Critério | Resultado | Evidência |
|---|---|---|
| Sem rolagem horizontal da página (390/768/1440) | aprovado | E2E `previsoes` ×3 |
| Sem erro de console | aprovado | E2E |
| Alvos ≥ 44 px e nomes acessíveis (botões, campos, selects, summary) | aprovado | E2E ×3 |
| Gráfico cabe no cartão; tem descrição, legenda textual e tabela equivalente | aprovado | E2E + unit |
| Tabelas da vista sem rolagem interna nos 3 viewports | aprovado depois da correção | E2E |
| Cor não é o único sinal (linha cinza contínua / dourada com losangos / área com linhas pontilhadas + legenda textual; estados por texto) | aprovado (inspeção) | capturas |
| Método sofisticado sem decoração extra | aprovado: mesmo desenho para todos os modelos | inspeção |
| Estados: insuficiente, com erro medido, sem faixa (HW a 28 dias), WAPE indefinido, dados próprios curtos | aprovado | E2E + unit |
| Teclado: trocar modelo (setas), abrir/fechar tabela (Enter) | aprovado | E2E |
| Leitor de tela, contraste medido, zoom 200%, outros navegadores | **não verificado** | — |

## Problemas encontrados na revisão e corrigidos
1. **Mobile, rolagem horizontal da página (510 px em 390):** a coluna implícita do `.cf-stack` crescia até 473 px porque o `<svg>` tem largura explícita. Corrigido com `grid-template-columns: minmax(0, 1fr)` (afeta o `.cf-stack` global; os E2E da S01/S02 seguem verdes).
2. **Mobile, tabela de previsão cortada (437 px em 280 px):** "Central" e "Otimista" ficavam fora da vista. Corrigido com tabela compacta (fonte 12 px, espaçamento menor, ano da data oculto só visualmente no mobile, % do erro em linha própria).
3. **Rótulos de data do gráfico sobrepostos** ("11/1118/11"): o rótulo da data-base some quando ficaria a menos de 60 px do último.

## Pontos menores que permanecem
- O rótulo "Previsão →" do gráfico encosta no pico da linha em 390 px.
- A página tem ~7.000 px de altura no mobile (cinco cartões); é longa, mas cada bloco tem título e dá para pular. Não há índice interno.
- A tabela "dia a dia" foi inspecionada só por medição (sem rolagem) e captura de página inteira.
