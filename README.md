# CaixaFuturo

Projeto open source para projetar o caixa de pequenos comércios/restaurantes e simular decisões com cálculos verificáveis, **sem IA externa no runtime**, sem servidor de aplicação e sem login.

**Status (12/11/2026):** Sprints 1, 2, 3 e 4 **aprovadas pelo usuário**; a **Sprint 5 (Simulador) está implementada e aguardando avaliação humana** (ver `docs/evidencias/s05.md`). A Sprint 4 (planejamento ampliado: recorrências, fluxo de 13 semanas, filtros com detalhe rastreável e exportação CSV) está descrita em [ADR-0008](docs/decisoes/0008-recorrencias-13-semanas-exportacao.md) e em `docs/evidencias/s04.md`. A Sprint 5 (simulador: atrasar recebíveis, choques de vendas/despesas e comparação Original × Alternativa sem alterar o original) está descrita na [ADR-0009](docs/decisoes/0009-simulador-de-cenarios.md); a S06 **não foi iniciada**. A Sprint 3 trouxe sazonalidade, modelos, backtesting, faixas e previsto × realizado ([ADR-0007](docs/decisoes/0007-modelos-e-backtesting.md)); a Sprint 2, vendas, repasses líquidos derivados e conciliação sem dupla contagem ([ADR-0006](docs/decisoes/0006-conciliacao-recebiveis.md)). O estado real de cada task está em [`ESTADO.json`](ESTADO.json); nada é declarado pronto sem teste e commit registrados.

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

## Planejamento ampliado (Sprint 4)
- **Calendário:** além do calendário de 30 dias, mostra as **próximas 13 semanas** (segunda a domingo; a 1ª pode ser parcial) com o alerta do pior dia de cada semana, a ressalva de que a incerteza cresce com o horizonte e as premissas (lançamentos, recorrências calculadas e repasses das vendas; nunca previsão de faturamento). Em **Recorrências** cadastre receitas/despesas semanais, quinzenais, mensais ou anuais (dia 31 cai no último dia dos meses curtos), pule uma data ou exclua a regra; excluir a regra não apaga o que já foi lançado.
- **Movimentações:** filtros por período, categoria e origem com o estado em texto e "Limpar filtros". O somatório vem dos lançamentos listados e o alerta de saldo continua visível, calculado sobre todos. "Detalhes" mostra de qual dia do saldo vem cada lançamento.
- **Exportar CSV (botão secundário):** em Movimentações exporta a lista filtrada no formato do CSV de contas (UTF-8 com BOM, `;`, decimal com vírgula; textos que parecem fórmula saem com apóstrofo) ou a projeção diária; em Calendário exporta as 13 semanas. O arquivo é gerado no navegador. Reimportar é seguro para lançamentos de origem CSV; manuais e recorrentes entrariam como novos no mesmo navegador.
- **Demonstração:** na demonstração, Calendário → "Carregar recorrências fictícias" (dados fictícios; dia 31, semanal, data final e uma ocorrência já liquidada).
- Decisões e limites (sem dias úteis/feriados): [ADR-0008](docs/decisoes/0008-recorrencias-13-semanas-exportacao.md). Evidências: `docs/evidencias/s04.md` e `s04-visual.md`.

## Simulador (Sprint 5)
- **Simulador (menu):** teste hipóteses sem mexer nos seus dados. **Atrasar um recebimento** (1 a 365 dias corridos), **variar repasses de vendas** e **variar despesas** (por percentual, período e, nas despesas, categoria). A tela compara **Original × Alternativa (hipótese)** dia a dia, com a diferença, avisos e premissas em texto. No celular a comparação vira abas Original | Alternativa, com a diferença sempre visível. **Voltar ao original** remove as hipóteses.
- Nada é gravado: as hipóteses vivem só na sessão e recarregar a página as descarta; o IndexedDB e o saldo real não mudam. Nenhum botão executa transferência, antecipação ou contratação.
- Limites: dias corridos; um atraso por recebimento; o choque de vendas atua nos repasses já esperados (não em vendas futuras nem na previsão); contas importadas e vendas conciliadas não entram; sem exportação da comparação. Decisões: [ADR-0009](docs/decisoes/0009-simulador-de-cenarios.md). Evidências: `docs/evidencias/s05.md` e `s05-visual.md`.
- **Demonstração:** carregue a demonstração → Simulador → escolha "15/11 · Recebimento agendado fictício (R$ 4.000,00)" e atraso de 2 dias: o saldo de 15/11 e 16/11 vira −R$ 700,00 na Alternativa (diferença −R$ 4.000,00) e o Original não muda.

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
