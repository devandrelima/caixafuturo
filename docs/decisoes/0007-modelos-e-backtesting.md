# ADR-0007 — Sazonalidade, modelos, backtesting e faixas (Sprint 3)

Data: 2026-11-12
Status: **proposta do executor** (decisões técnicas conservadoras; as de produto estão marcadas e dependem do usuário). Complementa o [ADR-0003](0003-previsao.md).

## Princípio
O que a S03 prova é apenas: "em **dados fornecidos**, com estas regras fixas, o modelo X errou tanto em janelas passadas". Não prova precisão futura. Com dados sintéticos prova só que o **código** faz as contas certas. Nada de "precisão", "confiança" ou "probabilidade" é anunciado sem medição; sem dados suficientes o app mostra aviso, não número.

## D1. Série e data de corte
Série de **faturamento bruto** por dia (`unit: gross_sales`, nunca caixa). Todo cálculo recebe uma **data de corte** (`cutoff`): só vendas com `saleDate <= cutoff` entram. Com a política `zero` (padrão) a série de treino vai da 1ª venda **até o corte** (dias sem venda, inclusive os finais, = R$ 0 "preenchido"); com `ignore`, só dias observados. Alterar vendas **depois** do corte nunca muda o resultado (teste obrigatório).

## D2. Sazonalidade (`seasonality.ts`)
- **Dia da semana:** índice por dia = média do dia ÷ média geral, em pontos-base (10 000 = igual à média).
- **Período do mês:** três períodos (dias 1–10, 11–20, 21–fim), mesmas contas. Não controla o dia da semana (cada período de ≥ 10 dias contém todos os dias da semana, com mistura quase igual).
- **Amostra mínima (parâmetros fixos):** semanal exige ≥ 28 dias de série e ≥ 4 observações **utilizáveis** (não outlier) em **cada** dia da semana; mensal exige ≥ 3 meses distintos em que **cada** período tenha ≥ 5 dias. Lacunas (dias preenchidos com zero) acima de 30% da série ⇒ `insufficient_data`. Série com média zero ⇒ `insufficient_data`.
- **Outliers:** por dia da semana (ou período), valor é outlier se |x − mediana| > 3,5 × escala, com escala = máx(1,4826 × MAD; 5% da |mediana|; 1 centavo) — o piso evita sinalizar variações triviais quando o MAD é zero. Outliers são **excluídos do índice**, mas listados (data, valor, mediana). Todas as contas em BigInt/inteiros.
- **Suporte para afirmar sazonalidade:** a força é a razão entre a variação **entre** grupos e a variação total (η², em pontos-base: soma de quadrados entre grupos ÷ total, só com dados utilizáveis). Limiar fixo: ≥ 25% (2 500 bps). É um **tamanho de efeito heurístico, não um teste de hipótese**: o app diz "padrão semanal detectado (força X%)" e nunca atribui probabilidade/significância. Abaixo do limiar: `not_seasonal` ("sem padrão semanal claro"); sem amostra: `insufficient_data` com motivo.

## D3. Modelos (`models.ts`) — parâmetros fixos, sem busca de hiperparâmetros
Todos recebem a **mesma série de treino** (D1) e o mesmo horizonte; todos fixados, nada é ajustado olhando o desempenho futuro. Mínimo comum: ≥ 7 dias com venda.
| Modelo | Regra | Elegibilidade |
|---|---|---|
| `naive_last` | valor do último dia da série repetido | comum |
| `moving_average_7` | média dos últimos 7 dias, repetida | ≥ 7 dias de série |
| `seasonal_weekday_mean` | média das **últimas 4** ocorrências utilizáveis do mesmo dia da semana | sazonalidade semanal `seasonal` (D2) |
| `holt_winters_additive` | Holt-Winters aditivo, período 7, α = 0,2, β = 0,05, γ = 0,3 (bps 2000/500/3000), inicialização pelos 2 primeiros ciclos, aritmética inteira com arredondamento por passo, previsão piso 0 | ≥ 42 dias (6 ciclos) **e** lacunas ≤ 30% |
Modelo inelegível aparece com **motivo** e sem número. O baseline de média histórica da S02 permanece como comparação.

## D4. Backtesting rolling-origin (`backtest.ts`)
- Horizonte de avaliação **= horizonte exibido** (7, 14 ou 28 dias): o erro é medido na mesma distância em que a previsão é mostrada.
- Origens a cada 7 dias a partir de 28 dias de treino; cada dobra treina só com vendas ≤ origem e é avaliada nos `h` dias seguintes; dobra cujo período avaliado passa do último dia de dados **não existe**.
- **Realizado** = faturamento bruto realmente importado do dia (dia sem venda dentro do período = R$ 0, marcado como preenchido; com `ignore` o dia não é avaliado).
- **Comparação justa:** modelos são comparados só nas **dobras em que todos os modelos elegíveis no corte final são elegíveis** (mesmos pontos). Mínimo para comparar: ≥ 4 dobras. Abaixo disso, sem métrica comparativa e sem "menor erro".
- **Métricas:** MAE = média dos |erro| (centavos, arredondada); WAPE = Σ|erro| ÷ Σ realizado, em pontos-base; **denominador zero ⇒ WAPE indefinido** (`null`, nunca 0 nem infinito) e é exibido como "indefinido (realizado = R$ 0)". Cada métrica leva n de dias, n de dobras, janela de treino e de avaliação.
- O modelo de **menor WAPE** é só "menor erro no período avaliado" (empate ⇒ o mais simples na ordem da tabela); nunca "melhor" ou "mais preciso".
- **Previsões históricas:** o "previsto" de cada dobra é **recalculado de forma determinística** com os dados até a origem (previsão retrospectiva), não uma previsão gravada na época. Se vendas antigas forem corrigidas depois, a reconstrução muda. Não persiste nada (sem migração do IndexedDB). *Decisão de produto registrada na seção "Pendência".*

## D5. Faixas (`intervals.ts`)
- Resíduos = realizado − previsto, agrupados (todos os passos) do modelo escolhido, **só nas dobras comuns**. Mínimo: ≥ 28 resíduos **e** ≥ 4 dobras; senão sem faixa ("histórico de erro insuficiente").
- Faixa **empírica**: conservadora = previsão + 10º percentil dos resíduos; otimista = previsão + 90º percentil; central = previsão (percentil por posto mais próximo, inteiros). Piso 0.
- Rótulo honesto: "faixa dos erros passados (10º–90º percentis de N dias avaliados)". **Não** é intervalo de confiança/credibilidade, não promete cobertura futura; resíduos têm dependência e escala própria (dias de maior venda erram mais), o que a faixa não modela.

## D6. Unidades e dinheiro
Previsão é faturamento bruto (`gross_sales`). **Não** vira dinheiro disponível; a S03 **não** converte previsão em caixa nem a coloca no saldo projetado (S02 mantém previsão fora do saldo). Dinheiro em BigInt/centavos; WAPE em pontos-base inteiros (razão BigInt).

## Pendência (produto) — snapshots de previsões emitidas
Contrato diz que "previsões históricas mantêm seus valores originais". A S03 entrega previsão **retrospectiva reconstruída** (D4), reproduzível e sem persistência. Gravar a previsão emitida em cada data exigiria IndexedDB v3 e só preencheria o comparativo com o passar dos dias de uso real. Recomendação: manter retrospectiva na S03 e rotular claramente; snapshots reais ficam como evolução se o usuário quiser.
