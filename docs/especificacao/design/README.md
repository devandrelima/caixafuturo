# Direção visual oficial — CaixaFuturo

**Status:** direção de design definida pelo usuário em 11/11/2026; **implementação e aprovação de sprint ainda não autorizadas**. Esta documentação é a fonte de verdade para estilo e UX (ADR-0004). Foco da Sprint 1: produto **clean, minimalista, acolhedor e discretamente cartoonesco**, inspirado nas capturas fornecidas do biip.club. Não copiar identidade, logo, textos, personagens, cards de membro, marcas ou elementos proprietários da referência.

## O que absorver das capturas compartilhadas
1. **Onboarding / primeira tela:** espaço negativo generoso, título grande e expressivo, uma ação principal dourada, conteúdo centralizado, progressão simples. **Adaptar:** onboarding financeiro curto e opcional, não fluxo de comunidade.
2. **Etapas com painel dividido:** formulário à esquerda e visualização-resumo à direita, cantos generosos e contornos finos. **Adaptar:** configuração dos saldos/preview da demonstração, e não cadastro de perfil.
3. **Área interna:** sidebar bege, item ativo em cápsula clara, conteúdo central em superfície branca quente, navegação econômica, cards com raio grande e sombra quase imperceptível.
4. **Página de projetos e configurações:** agrupamento consistente, títulos fortes, chips discretos, campos preenchidos em areia clara, listas com separadores sutis e componentes de leitura fácil.
5. **Toque cartoonesco:** formas arredondadas, microilustração **original** 2D e detalhes bem humorados apenas em estados vazios, boas-vindas e conclusão. **Não** importar mascote do biip.club, modelagem 3D, ilustrações exageradas ou animações que atrapalhem decisões financeiras.

## Linguagem visual que deve prevalecer
- Fundo off-white, superfície creme quase branca, sidebar areia suave, grafite para texto. **Amarelo-dourado** é ação e identidade; verde é situação positiva, vermelho é saldo negativo e âmbar é alerta abaixo do mínimo. Não pintar números financeiros de verde/amarelo indiscriminadamente.
- Pouca densidade por padrão; conteúdo importante primeiro, detalhes disponíveis ao toque. O gráfico de caixa precisa ser legível, com alternativa em tabela; não esconder risco em efeitos decorativos.
- Hierarquia: um título de página, um subtítulo conciso, indicadores realmente necessários, gráfico de 30 dias, calendário e lista explicável. Nada de cards decorativos sem função.
- Estilo amigável, mas **adulto e confiável**, adequado ao dono de restaurante. Nenhuma referência externa deve ser necessária para reproduzir os componentes.

## Fonte de verdade e leitura seletiva
- [tokens.json](tokens.json): **única fonte de cores, tipografia, dimensões e raios**. Na implementação usar CSS custom properties extraídas desses tokens, não inventar novas cores por componente.
- [telas/S01.md](telas/S01.md): organização, comportamento e wireframes da Sprint 1.
- [evolucao.md](evolucao.md): como expandir a interface nas Sprints 2–6 sem redesenhá-la.
- [qualidade.md](qualidade.md): revisão e evidências de layout, acessibilidade, estados e interação.
- [Contrato UI](../contratos/interface.md): fontes e semântica dos dados, rotas e comportamento.
- [ADR-0004](../../../decisoes/0004-identidade-visual.md): decisão e limites da inspiração.

**Ordem de precedência:** invariantes financeiros e segurança > contrato de interface (semântica) > tokens e telas (aparência) > preferências locais de componentes. Se houver conflito, registrar proposta de mudança antes de alterar. Não copiar estes textos para todos os manifests: a task UI deve carregá-los seletivamente.

**Não alegar** que mockup, captura real, revisão visual, teste de acessibilidade ou aplicativo foram produzidos enquanto existirem apenas especificações.
