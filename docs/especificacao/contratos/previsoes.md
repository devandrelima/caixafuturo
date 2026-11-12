# Contrato de previsões — v1

SalesPoint: data, valor bruto em centavos e IDs de vendas. ForecastPoint: data, estimativa central, inferior e superior opcionais, método, data final do treino, amostra, métricas e indicador de hipótese. Dia sem venda exige política explícita (zero verdadeiro versus falta de dado).

S02: média, tendência simples, previsão manual marcada como hipotética. S03: baseline ingênuo, média móvel, sazonalidade semanal e Holt-Winters SOMENTE se amostra suficiente e periodicidade suportada; se não houver, sinalizar insuficiência. Comparar modelos com rolling-origin backtesting: treino anterior ao período avaliado; MAE e WAPE, com denominador zero tratado. Bandas conservadora/central/otimista só com erros históricos suficientes, sem anunciar nível probabilístico não medido. Previsões históricas mantêm seus valores originais para comparação previsto x realizado.

Conversão para caixa só acontece pela regra de liquidação com taxas e prazos; série prevista/confirmada/hipotética identificada. Nunca prometer rentabilidade, acurácia ou disponibilidade garantida.

