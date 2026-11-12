# Evolução visual após Sprint 1

Ponto de partida obrigatório: tokens.json, AppShell e padrões de S01. Cada sprint adiciona telas necessárias, sem reprojetar sidebar, espaçamentos, estados ou navegação. Só criar componentes que prestem serviço ao fluxo implementado. Em toda task UI: carregar este arquivo + qualidade.md + tokens.json + contrato de interface, e revisar tela desktop/mobile com evidências.

## S02 — vendas e repasses
Adicionar item **Vendas e recebimentos** ao menu apenas quando funcional. Visão em 3 áreas tituladas **Faturamento bruto**, **Recebimentos previstos líquidos** e **Saldo projetado** com datas e explicações. Formulário de Pix/cartão, taxas e repasses; tabela de origem das vendas; hipótese manual visivelmente identificada. Nunca empilhar todas as séries sem legenda ou usar cor como única diferenciação.

## S03 — inteligência estatística
Adicionar **Previsões** com seletor de modelo, resumo MAE/WAPE, janela de treino/avaliação e qualidade dos dados. Gráfico simples mostra central e bandas quando justificadas; legenda textual e aviso "dados insuficientes" quando necessário. Método sofisticado não recebe decoração visual para parecer mais preciso.

## S04 — horizonte estendido e exportação
Na seção **Calendário**, acrescentar 13 semanas e recorrências; em **Movimentações**, filtros chips claros, detalhamento em linha ou painel, exportar CSV como botão secundário. Estado de filtro visível e "Limpar filtros" acessível.

## S05 — cenários
Adicionar **Simulador** somente quando funcional, com coluna/painel para premissas e comparação lado a lado de **Original** e **Alternativa** (no mobile, abas claramente identificadas + diferença). Uma cor quente para edição hipotética, mas nunca confundida com alerta/recebimento real. CTA "Voltar ao original".

## S06 — simulações avançadas
Reutilizar Simulador: painéis/accordions para compras, contratação, vencimentos e antecipação; custo e datas em texto antes de atualizar gráfico; confirmar caráter hipotético. Sem botões que sugiram execução bancária real.

## Orientações permanentes
Cartoonesco apenas como detalhe visual **original** em boas-vindas, vazio, sucesso e microinterações; nunca mascote copiado ou gráficos decorativos. Novo componente herda tokens; preservar modo claro prioritário, contraste e acessibilidade. O prazo de candidatura não autoriza apresentar navegação incompleta como funcional.
