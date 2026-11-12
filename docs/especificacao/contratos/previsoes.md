# Contrato de previsões — v1

SalesPoint: data, valor bruto em centavos e IDs de vendas. ForecastPoint: data, estimativa central, inferior e superior opcionais, método, data final do treino, amostra, métricas e indicador de hipótese. Dia sem venda exige política explícita (zero verdadeiro versus falta de dado).

S02: média, tendência simples, previsão manual marcada como hipotética. S03: baseline ingênuo, média móvel, sazonalidade semanal e Holt-Winters SOMENTE se amostra suficiente e periodicidade suportada; se não houver, sinalizar insuficiência. Comparar modelos com rolling-origin backtesting: treino anterior ao período avaliado; MAE e WAPE, com denominador zero tratado. Bandas conservadora/central/otimista só com erros históricos suficientes, sem anunciar nível probabilístico não medido. Previsões históricas mantêm seus valores originais para comparação previsto x realizado.

**Regras implementadas na S02 (`src/domain/forecast/baseline.ts`):**
- Série de faturamento bruto por dia. Política de dia sem venda explícita e configurável: `zero` (padrão; dia sem movimento, R$ 0, marcado como *preenchido* e avisado) ou `ignore` (falta de dado, o dia não entra).
- Média diária = soma / dias da série, em centavos, arredondada ao centavo mais próximo (meio sobe). Também média por dia da semana e tendência simples: média dos últimos 7 dias vs 7 anteriores, em pontos-base; |variação| < 5% = estável; sem 14 dias ou com período anterior zerado = desconhecida.
- Baseline = média diária repetida no horizonte (padrão 30, máx. 90). **Menos de 7 dias com venda: nenhuma previsão, só aviso.** Menos de 28 dias: aviso de série curta. Dias preenchidos com zero e última venda > 7 dias antes da data-base também avisam.
- Pontos sem faixa inferior/superior (só com erro histórico medido, S03), `validated: false` sempre, unidade `gross_sales` (faturamento, **nunca** caixa).
- Projeção manual (valor diário ou ajuste percentual do baseline) sempre `isHypothesis: true`, rótulo "Hipótese manual — não é previsão validada", sem dados de treino.

Conversão para caixa só acontece pela regra de liquidação com taxas e prazos; série prevista/confirmada/hipotética identificada. Nunca prometer rentabilidade, acurácia ou disponibilidade garantida.


## Regras da S03 — decididas em [ADR-0007](../../decisoes/0007-modelos-e-backtesting.md)
- Todo cálculo recebe **data de corte**; só vendas ≤ corte entram; alterar o futuro não muda o passado.
- **Sazonalidade** (dia da semana e período do mês) só com amostra mínima (≥ 28 dias e ≥ 4 observações utilizáveis por dia da semana; ≥ 3 meses para período), lacunas ≤ 30%, outliers excluídos e listados, força ≥ 25% (tamanho de efeito, **não** teste de hipótese). Sem suporte ⇒ `insufficient_data`/`not_seasonal` com motivo.
- **Modelos:** `naive_last`, `moving_average_7`, `seasonal_weekday_mean`, `holt_winters_additive` (α 0,2 · β 0,05 · γ 0,3; período 7; ≥ 42 dias). Parâmetros fixos; inelegível = motivo e nenhum número.
- **Backtesting rolling-origin** (origens semanais a partir de 28 dias; horizonte avaliado = horizonte exibido); comparação só nas dobras comuns (≥ 4). **MAE** (centavos) e **WAPE** (bps; denominador zero ⇒ `null`, "indefinido").
- **Faixas** empíricas (10º/90º percentis dos resíduos) só com ≥ 28 resíduos e ≥ 4 dobras; sem rótulo de probabilidade. Faturamento bruto; nunca vira caixa/saldo.
- Tipos ampliados: `ForecastPoint.lowerCents/upperCents: bigint | null`; novos métodos de modelo.
