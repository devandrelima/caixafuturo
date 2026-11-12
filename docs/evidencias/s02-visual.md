# Revisão visual — Sprint 2 (Chromium real)

Capturas geradas pelo E2E (`tests/e2e/sales-flow.spec.ts`) em 12/11/2026 em [`capturas/`](capturas): `mobile-vendas.png` (390×844), `tablet-vendas.png` (768×1024), `desktop-vendas.png` (1440×900), `*-visao-geral-s02.png` (Visão geral com a explicação de riscos), `e2e-s02-conciliado.png`, `e2e-s02-pendente.png`, `e2e-s02-demo-vendas.png`, `e2e-s02-explicacao-risco.png`, `e2e-s02-vendas-regras.png`.

## Verificado com asserções (não só visualmente)
- Sem rolagem horizontal da página em 390, 768 e 1440 px nas vistas **Vendas e recebimentos** e **Visão geral** (com 84 vendas); também em 320 px (medido contra o container).
- Zero erros de console e zero `pageerror` nos três viewports.
- As três áreas aparecem na ordem **Faturamento bruto → Recebimentos previstos líquidos → Saldo projetado**, cada uma com `h2`.
- Alvos de toque ≥ 44 px e nomes acessíveis em todos os controles visíveis; foco e teclado nos fluxos de pendência e explicação.

## Observado nas capturas (revisão manual por quem executou)
- Tema creme/areia/grafite/dourado da S01 preservado; cartões, selos e alertas reutilizam os mesmos componentes. Situação do recebível sempre em **texto** (Derivado / Conciliado / Conciliação pendente / Lote — não suportado / Parcelas — não suportado / Já no saldo inicial), nunca só cor.
- Hipótese manual aparece em alerta de aviso e a coluna "Natureza" repete o rótulo em cada linha.
- Mobile: cartões de indicadores empilham; tabelas rolam dentro do cartão com a primeira coluna fixa; título da topbar trunca ("Vendas e r…").

## Problemas e limites (não escondidos)
- A vista é longa (≈ 8.700 px no mobile com 84 vendas): faturamento por dia e regras de repasse ficam abaixo da dobra. Sem navegação por âncoras.
- A tabela de recebíveis tem 9 colunas; em 390 px exige rolagem horizontal **interna** (achado B).
- Sem ilustrações novas nesta sprint (o desenho original discreto ficou só no onboarding/marca da S01).
- 195 px (zoom extremo): estouro horizontal (achado C da S01), agora também na vista nova.
- Não verificado: Firefox/Safari, dispositivos reais, leitor de tela, contraste medido na página renderizada, modo escuro (não existe).
