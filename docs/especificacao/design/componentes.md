# Inventário de componentes e contratos visuais — S01

Não é código pronto. Nomes abaixo são convenções sugeridas para React/TypeScript; a task cria implementações tipadas e testadas. Componentes recebem dados preparados por serviços; não calculam dinheiro com float nem persistem alterações por conta própria. Todos usam `tokens.json` com classes/CSS variables documentadas.

| Componente | Propriedades/uso | Estados verificáveis |
|---|---|---|
| `AppShell` | `activeView`, `onNavigate`, `demoMode`, `children` | menu aberto/fechado mobile, link ativo, foco restaurado |
| `Onboarding` | `onExploreDemo`, `onStartEmpty`, `isLoading` | primeiro acesso, confirmação antes de trocar base, falha de loading |
| `CfButton` / `CfIconButton` | `variant=primary|secondary|ghost|danger`, `disabled`, `loading`, `type` | dourado/grafite, foco, loading não acionável, alvo >=44px |
| `CfCard` / `CfPanel` | `title`, `description?`, `actions?`, `children` | borda, raio, padding e responsividade consistentes |
| `CfBadge` | `tone=neutral|positive|warning|negative|demo`, rótulo textual | cor não é único sinal, risco correto |
| `CfField` / `CfSelect` | `label`, `hint?`, `error?`, `required`, valor controlado | ajuda, erro, foco, teclado, aria-describedby |
| `FinanceForm` | `onSubmit(CashEntryDraft)`, validação, loading | campos diretos, BRL e data, erro por campo |
| `ImportPreview` | `rowsValid`, `rowsDuplicate`, `rowsInvalid`, `onConfirm` | prévia antes de salvar, erro por linha, success após persistência |
| `CashDashboard` | `CashSettings`, `DailyPoint[]`, `firstRisk?`, callbacks | cards, gráfico + tabela, estado sem dados e sem risco |
| `RiskCalendar` | `DailyPoint[]`, `selectedDate`, `onSelectDate` | data/valor crítico, detalhes por ID, navegação de mês |
| `CfAlert` | `tone`, `title`, `body`, `action?` | negativo vs abaixo do mínimo, erro de storage, aviso demo |

## Hierarquia e conteúdos canônicos
- Layout global: sidebar areia (somente desktop), menu-gaveta mobile, conteúdo creme, títulos grafite, cards superfícies claras.
- Card de saldo: **"Saldo informado em DD/MM/AAAA"**, sempre referenciado à base; não usar "Saldo atual" em dado datado.
- Card futuro: **"Saldo projetado em DD/MM/AAAA"**, não prometer disponibilidade bancária real.
- Card de risco: **"Próxima data crítica"** e **"Déficit para o mínimo"**; dia e quantidade explicáveis pelo motor. Valor negativo deve ter sinal explícito.
- Card de tendência: só mostrar dados realmente calculados. Sem espaço reservado com números artificiais.
- Demo: selo pequeno persistente "Dados fictícios"; nunca impor mascote ou substituir dados reais silenciosamente.

## Responsabilidades e fluxos
- `AppShell` mantém navegação local (sem SPA router obrigatório na S01) e sem links mortos.
- `Onboarding` expõe ações; integração decide persistência e exibe confirmação.
- `CashDashboard` e `RiskCalendar` devem consumir exatamente a mesma coleção de projeções, não recomputar fórmulas de forma independente.
- `ImportPreview` nunca grava antes da confirmação; resultado distingue criado, ignorado e inválido.
- Botões de exclusão/reset precisam de confirmação explícita, com Cancelar e foco correto.
- Todo modal possui título acessível, escape para fechar e retorno de foco; preferir `<dialog>` sem dependência extra quando adequado.

## Diretriz cartoonesca
Não incluir personagem obrigatório na Sprint 1. A simpatia vem de raios, ícones simples, linguajar humano e microestados. Se houver uma ilustração de boas-vindas, criar forma SVG **original**, leve, estática e com propósito; sem usar a figura do castelo/personagens das capturas. Não gerar personagem diferente em cada tela.
