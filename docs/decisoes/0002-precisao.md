# Centavos e datas

Data: 2026-11-11
Status: proposta, depende de aceite humano

## Contexto e alternativas
Prazo 15/11, dados financeiros sensíveis, requisito de aplicação reproduzível. Alternativa mais complexa rejeitada no recorte atual.

## Decisão e motivo
BigInt e strings decimais inteiras em vez de ponto flutuante; data-base ao fim do dia e data civil ISO; ID por origem evita contagem dupla. Mudança impacta S01–S06 e exige regressão financeira completa.

## Impactos
Reavaliar memórias, contratos e tasks que dependam da decisão; registrar novo ADR para revisão.

