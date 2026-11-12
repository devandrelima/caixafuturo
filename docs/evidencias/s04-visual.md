# Revisão visual — Sprint 4 (Calendário com 13 semanas e recorrências; Movimentações com filtros)

Capturas reais (Chromium headless 1.65, geradas pelo E2E em `docs/evidencias/capturas/`): `e2e-s04-calendario-{mobile,tablet,desktop}.png` e `e2e-s04-movimentacoes-{mobile,tablet,desktop}.png` (390×844, 768×1024, 1440×900, página inteira). Responsável: executor (IA); **sem revisão humana ainda**. Recortes de elementos em tamanho real foram inspecionados para as tabelas e os filtros.

**Skills de design:** as skills de frontend/design disponíveis são para Artifacts (HTML publicado) e não se aplicam a este app React; fallback manual com `design/qualidade.md`, tokens existentes (nenhuma cor nova) e Playwright.

| Critério | Resultado | Evidência |
|---|---|---|
| Sem rolagem horizontal da página (390/768/1440) | aprovado | E2E ×3 |
| Tabelas novas (semanas, regras, ocorrências) e Lançamentos sem rolagem interna | aprovado depois da correção | E2E ×3 |
| Sem erro de console | aprovado | E2E ×3 |
| Alvos ≥ 44 px e controles com nome acessível (botões, campos, selects, summary) | aprovado | E2E ×3 |
| Alerta de risco da semana visível em texto no celular (data e valor) | aprovado depois da correção | recorte 390 px |
| Cor não é o único sinal (alertas por texto; filtro ativo por texto e chips) | aprovado (inspeção) | capturas |
| Botão secundário "Exportar CSV" e menu de opções (foco inicial, Escape devolve o foco, descrição em texto, status "nada foi enviado") | aprovado | E2E + unit + recorte 390 px |
| Teclado: Detalhes (Enter), `<details>` das semanas (Enter), Limpar filtros (Enter) | aprovado | E2E |
| Reutiliza CfCard/CfButton/CfSelect/CfField/CfAlert/CfBadge, sem paleta nova | aprovado | código |
| Leitor de tela, contraste medido, zoom 200%, outros navegadores | **não verificado** | — |

## Problemas encontrados na revisão e corrigidos
1. Coluna "Situação" (alerta) das semanas fora da tela no celular → tabela empilhada com rótulos.
2. Regras: "Período" e "Ações" cortadas → empilhada.
3. Tabela Lançamentos: meu botão "Detalhes" agravou o achado B no tablet (254 → 273 px) → empilhada até 1023 px (616 → 0 e 254 → 0).
4. Recuo padrão do `<ul>` dos chips de filtro → removido.

## Pontos menores que permanecem
- Os achados A (título da topbar trunca no mobile) e C (estouro a 195 px) da S01 **não** foram tratados (fora do escopo). O B foi resolvido **apenas** para a tabela Lançamentos; as demais tabelas herdadas não foram tocadas.
- As tabelas empilhadas usam `display: block` em elementos de tabela; para preservar a semântica foram adicionados papéis ARIA explícitos (`table/row/rowheader/cell`). Não foi testado com leitor de tela.
