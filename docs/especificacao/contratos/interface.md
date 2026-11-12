# Contrato canônico de UI e experiência — v2

Público: donos/gestores de pequenos comércios e restaurantes; português brasileiro, BRL, datas em DD/MM/AAAA na tela e ISO no domínio. Aparência de **SaaS financeiro clean/minimalista quente e discretamente cartoonesco**, com identidade própria. Fonte visual: [guia](../design/README.md), [tokens](../design/tokens.json), [componentes](../design/componentes.md), [telas S01](../design/telas/S01.md), [evolução](../design/evolucao.md), [qualidade](../design/qualidade.md).

## Contrato funcional da navegação S01
Estado de UI lógico: `View = 'visao-geral' | 'movimentacoes' | 'calendario'`. Navegar só entre vistas implementadas; sem links falsos das sprints futuras. Onboarding não exige cadastro; usuário pode explorar dataset fictício ou iniciar com dados próprios. Reutilizar `AppShell` e componentes com props tipadas, não duplicar valores financeiros ou definições de CSS.

**Visão geral:** saldo *informado* com data-base e saldo *projetado* com data, mínimo configurável, menor saldo, primeiro risco com déficit; gráfico **e tabela** de 30 dias, calendário e detalhamento causal dos lançamentos. Gráfico e calendário consomem as mesmas `DailyPoint[]` do motor. Dados demo sempre rotulados "Dados fictícios", nunca números estáticos simulando cálculo.

**Movimentações:** adicionar/editar/excluir entradas pagar/receber, categoria, origem, vencimento e valores BRL; importar CSV com preview de válidas, inválidas, duplicadas e erro por linha; confirmar antes de gravar; recalcular tela após persistência. Pedido de exclusão/reset pede confirmação.

**Calendário:** data selecionável, contas e saldos relacionados, próximos riscos e botão de ir à data crítica; não há cálculo paralelo de saldo nem promessa de execução financeira.

**Fluxos e feedback:** ação em tela → validação → persistência/resultados do domínio → projeção → atualização UI → confirmação real. Erro de storage não vira sucesso; dados existentes não são apagados para mostrar exemplo. Avisos de déficit exibem `shortfallCents`, data e IDs de origem. O fluxo deve funcionar sem LLM, servidor, login ou chave.

## Design/adaptação
Responsividade 360px até desktop, menu colapsável, campos >=44px, foco visível, Tab/Escape, rótulos e erros, contraste >=4.5:1 para texto comum, gráfico com tabela, `prefers-reduced-motion`; evidências de inspeção em três resoluções de [qualidade.md](../design/qualidade.md). Mudanças visuais seguem [ADR-0004](../../decisoes/0004-identidade-visual.md).

## Futuras sprints
S02 separa **faturamento bruto**, **recebimento líquido previsto** e **saldo projetado**; S03 traz método e métricas; S04 filtros e exportação; S05/S06 hipóteses e base imutável. O menu só cresce depois de cada incremento funcional aprovado. Inventariar skills de design realmente disponíveis por task; justificar escolha/fallback; não presumir screenshot ou resultado sem executar.

## Simulador (S05)
Vista `simulador` (menu "Simulador"): painel de hipóteses (atraso, variação de vendas, variação de despesas) + comparação Original × Alternativa (hipótese) × Diferença. Tudo da Alternativa é rotulado como hipótese em **texto e forma** (selo "Hipótese", borda tracejada), sem token de cor novo; o Original fica sempre visível (colunas lado a lado ≥ 768 px; abas Original | Alternativa + Diferença abaixo disso); CTA "Voltar ao original"; hipóteses só em memória; nenhum botão sugere execução real. Ver ADR-0009.
