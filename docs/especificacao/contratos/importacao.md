# Contrato CSV — v1

## Contas (S01)
UTF-8 com ou sem BOM; separador ; ou , com suporte verdadeiro a aspas. Colunas: tipo, descricao, valor, vencimento, categoria, identificador_externo. tipo: pagar/receber. valor: decimal pt-BR estritamente positivo, sem exponencial, ex. 1.234,56. vencimento: DD/MM/YYYY ou YYYY-MM-DD. Descrição obrigatória; categoria e ID externo opcionais. Preview antes de gravar, relatório por linha, erros explícitos sem registros parciais escondidos.

Chave idempotente: identificador externo quando fornecido (prefixo csv:external), senão SHA-256 de campos normalizados (prefixo csv:hash), com regras de normalização testadas. Linhas idênticas sem IDs diferentes representam o mesmo lançamento; exigir IDs externos distintos para duplicatas legítimas. Retorno informa criadas/ignoradas/erros. O parser não escreve storage.

## Vendas (S02)
Colunas: identificador_venda, data_venda, valor_bruto, meio_pagamento, categoria. Mesmas regras de formato do CSV de contas (UTF-8/BOM, `;` `,` ou tab, aspas, preview antes de gravar, erro por linha, limite de linhas, datas DD/MM/AAAA ou AAAA-MM-DD, valor pt-BR).

- **identificador_venda obrigatório** (até 100 caracteres), sem hash de fallback: duas vendas legítimas idênticas no mesmo dia (ex.: dois Pix de R$ 30) não podem ser fundidas por assinatura, o que perderia faturamento. Linha sem identificador é erro.
- **valor_bruto** estritamente positivo. Estornos e cancelamentos (valor negativo ou zero) são recusados com erro explícito: **limitação documentada** desta versão.
- **meio_pagamento**: `pix`, `débito`, `crédito`, `dinheiro`, `voucher` (aceita sinônimos como "cartão de crédito", "espécie", "VR"; sem acento/caixa). Valor desconhecido é erro (não vira "outro" em silêncio, pois o meio define taxa e prazo).
- **Identidade**: chave `sale:<identificador_venda>` (namespace próprio, nunca `csv:`); id interno `sale_<sha256(chave)[0..20]>`, estável entre importações.
- **Idempotência**: mesma chave e mesmos dados (data, valor, meio) → ignorada (não duplica faturamento); a categoria não participa da comparação. Mesma chave com dados diferentes, no arquivo ou já gravada → erro/conflito explícito, **sem sobrescrever** o faturamento existente. Alterar uma venda já importada exige remoção/edição explícita (fora do escopo desta task).
- A venda **não** carrega data de recebimento nem valor líquido. Repasse líquido e data de disponibilidade são calculados separadamente (S02-P01-T02); a mesma venda não é recebida duas vezes. CSV de contas não compartilha namespace da chave de vendas.
- O parser não escreve storage; a gravação (S02-P01-T02) usa `planSalesImport` com as vendas já armazenadas.

## Exportação (S04)
Cabeçalho, filtros, datas ISO, centavos/BRL desambiguados e UTF-8; escapar aspas, quebras e delimitadores. Neutralizar fórmula-injection para texto iniciado por =, +, - ou @. Não transmitir arquivo para servidor.

