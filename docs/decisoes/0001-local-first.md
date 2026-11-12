# Arquitetura local-first

Data: 2026-11-11
Status: proposta, depende de aceite humano

## Contexto e alternativas
Prazo 15/11, dados financeiros sensíveis, requisito de aplicação reproduzível. Alternativa mais complexa rejeitada no recorte atual.

## Decisão e motivo
Vite, React, TypeScript e IndexedDB sem backend/login, por prazo e custo. Rejeita sincronização multi-dispositivo nesta fase; exportação futura é possível. Alterações exigem revisão de contratos de dados e tasks.

## Impactos
Reavaliar memórias, contratos e tasks que dependam da decisão; registrar novo ADR para revisão.

