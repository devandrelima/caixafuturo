# CaixaFuturo

Projeto open source para projetar o caixa de pequenos comércios/restaurantes e simular decisões com cálculos verificáveis, **sem IA externa no runtime**, sem servidor de aplicação e sem login.

**Status (12/11/2026):** Sprints 1 e 2 aprovadas pelo usuário. Sprint 3 (inteligência estatística: sazonalidade, modelos, backtesting, faixas e previsto × realizado) implementada e testada, **aguardando avaliação humana** ([ADR-0007](docs/decisoes/0007-modelos-e-backtesting.md)). A Sprint 2 (vendas e recebimentos futuros) trouxe: importação de vendas por CSV, regras de taxa/comissão/prazo, repasses líquidos derivados, conciliação com o CSV de contas sem dupla contagem ([ADR-0006](docs/decisoes/0006-conciliacao-recebiveis.md)), média/tendência/baseline com avisos, projeção manual como hipótese e explicação de cada risco. O estado real de cada task está em [`ESTADO.json`](ESTADO.json); nada é declarado pronto sem teste e commit registrados.

- [Especificação v2, seis sprints e tasks](docs/especificacao/README.md)
- [Decisões, arquitetura e riscos](docs/especificacao/00_visao_geral_e_decisoes.md)
- [Identidade visual, tokens, componentes e telas](docs/especificacao/design/README.md)
- [ADR-0005: Docker e contexto HTTP](docs/decisoes/0005-docker-e-contexto-http.md)
- [Skill Planejamento de Sistemas 2.0](https://github.com/devandrelima/planejamento-de-sistemas), revisão 76c187894d15ff2ecd744a25cc195feb68d72b0d

Prioridade candidatura iFood AI Builder 15/11/2026: S01 primeiro fluxo de caixa com 30 dias e risco; S02 só após aprovação humana da S01. As 31 funcionalidades do produto completo constam do planejamento.

## Usar o aplicativo

1. **Explorar demonstração** (tela inicial): carrega, após clique, dados **fictícios** de um restaurante (data-base 11/11/2026, saldo R$ 3.000,00, mínimo R$ 1.000,00 e quatro lançamentos). O motor calcula os saldos: 12/11 R$ 500,00 · 13/11 R$ 1.300,00 · 14/11 **-R$ 700,00** (déficit de R$ 1.700,00 para o mínimo) · 15/11 R$ 3.300,00. O selo "Dados fictícios" fica visível enquanto os dados forem da demonstração. Se já houver dados, o app pede confirmação antes de substituí-los.
2. **Começar com meus dados**: informe data-base, saldo inicial (fotografia conciliada ao **fim** da data-base) e saldo mínimo; depois cadastre contas em *Movimentações* ou importe um CSV.
3. **Visão geral**: indicadores, gráfico de 30 dias (com tabela de valores), calendário e alertas por data com a origem do cálculo. **Movimentações**: adicionar, editar e excluir (com confirmação) e importar CSV. **Calendário**: dia selecionável e atalho para a próxima data crítica.
4. **CSV de contas** (UTF-8 ou Windows-1252, separador `;` ou `,`): colunas `tipo` (pagar/receber), `descricao`, `valor` (pt-BR, ex. `1.234,56`), `vencimento` (`DD/MM/AAAA` ou `AAAA-MM-DD`), `categoria` e `identificador_externo` (opcionais). A prévia mostra erro por linha antes de gravar. Reimportar o mesmo arquivo não duplica lançamentos; duas contas legítimas idênticas exigem identificadores externos distintos.
5. Contas agendadas **até** a data-base já deveriam estar no saldo informado: são sinalizadas e **não** somadas.

## Vendas e recebimentos (Sprint 2)

Vista **Vendas e recebimentos**, com três áreas separadas: **Faturamento bruto** (não é dinheiro disponível), **Recebimentos previstos líquidos** e **Saldo projetado**.

1. **CSV de vendas** (`;` `,` ou tab): `identificador_venda` (obrigatório), `data_venda`, `valor_bruto` (positivo), `meio_pagamento` (pix, débito, crédito, dinheiro, voucher) e `categoria` (opcional). Reimportar o mesmo arquivo não duplica faturamento; mesmo identificador com dados diferentes é conflito explícito (não sobrescreve). Estornos não são importados.
2. **Regras de repasse** por meio de pagamento: taxa, comissão e prazo (dias corridos). Valores iniciais são **ilustrativos**. Mudar taxa ou prazo muda a data e o valor do caixa. Feriados e dias úteis não são considerados.
3. **Conciliação** com o CSV de contas: a coluna opcional `referencia_venda` liga uma conta a receber à venda (`identificador_venda`). Sem referência, conta e repasse próximos ficam como **conciliação pendente** (só a conta importada soma) até você decidir; nada é vinculado só por valor e data. **Parcelas e lotes não são suportados** (sinalizados na tela). O resultado independe da ordem de importação.
4. **Previsão**: média diária e tendência (7 dias vs 7 anteriores), baseline **não validado** com aviso de série curta/insuficiente, e projeção manual sempre rotulada como **hipótese**; nenhuma das duas entra no saldo projetado.
5. Na demonstração, o botão **Carregar vendas fictícias** adiciona 84 vendas de 28 dias (R$ 14.580,00 brutos).
6. A **Visão geral** explica cada data de risco: lançamentos considerados, origem, repasses estimados e o que ficou de fora.

## Previsões (Sprint 3)

Vista **Previsões**, sempre sobre **faturamento bruto** (não é dinheiro disponível e **não** altera o saldo projetado).

1. **Modelos** com parâmetros fixos e documentados: ingênuo (último dia), média móvel de 7 dias, sazonal por dia da semana (últimas 4 ocorrências) e Holt-Winters aditivo semanal (α 0,20 · β 0,05 · γ 0,30; exige ≥ 42 dias). Modelo sem amostra suficiente aparece **indisponível, com o motivo**, e não gera número.
2. **Backtesting rolling-origin:** em cada janela semanal o modelo só vê dados até o corte e é comparado com o faturamento **realmente importado**. Mostra MAE, WAPE (indefinido quando o realizado é R$ 0), viés e a janela de treino/avaliação. Abre no modelo de **menor erro medido** (nunca "melhor"); sem ao menos 4 janelas nenhum erro é medido.
3. **Faixas** conservadora/central/otimista: 10º e 90º percentis dos erros passados, só com ≥ 28 erros e ≥ 4 janelas. **Não é intervalo de confiança** e não promete cobertura futura.
4. **Previsto × realizado** é **retrospectivo** (recalculado com os dados até cada corte; não é a previsão gravada na época; nada novo é persistido, IndexedDB segue na v2).
5. **Sazonalidade** por dia da semana e período do mês só com amostra (≥ 28 dias e ≥ 4 observações por dia; ≥ 3 meses para período); outliers e dias sem venda são listados e excluídos do índice.
6. Na demonstração, **Carregar histórico fictício de 12 semanas** (84 dias, um evento e uma lacuna; as 4 últimas semanas são idênticas às vendas fictícias da S02, então nada duplica). O padrão artificial faz o erro parecer baixo: isso só mostra que o cálculo funciona, não o que aconteceria com vendas reais.

## Desenvolvimento local

Requer Node.js 20.19+ (testado com 22).

```bash
npm ci
npm run dev                                  # servidor de desenvolvimento (Vite)
npm run test:unit -- --run --coverage        # testes unitários + cobertura (mínimo 80%)
npm run test:e2e                             # Playwright (quando houver testes E2E)
npm run build                                # typecheck + build de produção em dist/
```

## Executar com Docker

O app é uma SPA estática: o Docker compila com Node e serve `dist/` com Nginx (sem root, sistema de arquivos somente leitura). **Não são necessárias chaves de API nem credenciais.**

```bash
docker compose up -d --build     # constrói e inicia (primeira vez)
```

Acesse **`http://IP_DO_SERVIDOR:8084`**. A porta do host é `CAIXAFUTURO_PORT` (padrão **8084**; a 8080 é ocupada pelo code-server na VPS de desenvolvimento e não foi alterada). Para outra porta: `CAIXAFUTURO_PORT=8090 docker compose up -d`.

| Ação | Comando |
|---|---|
| Atualizar com verificação e *rollback* automático | `./scripts/deploy.sh` |
| Ver estado e saúde | `docker compose ps` (coluna *healthy*) |
| Ver logs | `docker compose logs -f caixafuturo` |
| Commit implantado | `curl http://IP:8084/version.txt` |
| Parar (sem apagar nada) | `docker compose stop caixafuturo` |
| Iniciar novamente | `docker compose start caixafuturo` |

`scripts/deploy.sh` constrói a imagem com o commit como *tag*, testa-a em um contêiner descartável, troca **somente** o serviço `caixafuturo`, espera ficar saudável e responder HTTP e, se falhar, restaura a imagem estável anterior (`caixafuturo:previous`). Nunca usa `docker compose down` nem toca em outros contêineres. O contêiner tem `restart: unless-stopped` e continua rodando após o fim da sessão do operador.

### Limitações importantes

- **Seus dados ficam no IndexedDB do navegador**, não no contêiner. Recriar ou reiniciar o contêiner não apaga esses dados; limpar os dados do site no navegador apaga. **Não há sincronização entre dispositivos nem backup automático.**
- **HTTP público por IP não é adequado para informações financeiras reais** (sem criptografia em trânsito). Use apenas os **dados fictícios** da demonstração. Para uso real é necessário HTTPS (fora do escopo da Sprint 1).
- Em HTTP por IP o navegador não oferece `crypto.subtle`; por isso o SHA-256 do importador é implementado em TypeScript puro (ADR-0005), sem trocar por hash fraco.

## Frontend
Estilo **clean, minimalista, warm e levemente cartoonesco**, com identidade original (off-white, areia, grafite, dourado). [Guia visual](docs/especificacao/design/README.md), [tokens JSON](docs/especificacao/design/tokens.json) e [telas da S01](docs/especificacao/design/telas/S01.md).
