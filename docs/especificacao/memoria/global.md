# Memória do domínio: global

Objetivo: gestão de caixa local-first sem API de IA. Invariantes: centavos inteiros, data civil, base real != previsão, venda != recebimento, origem idempotente, cenário isolado, demo sintética, sem ação financeira externa. Stack React/TypeScript/Vite + IndexedDB, Vitest e Playwright. Contratos em docs/especificacao/contratos; não duplicar suas regras. Task só recebe domínio necessário. Aprovação humana por sprint.

