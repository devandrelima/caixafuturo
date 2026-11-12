# Contrato CSV — v1

## Contas (S01)
UTF-8 com ou sem BOM; separador ; ou , com suporte verdadeiro a aspas. Colunas: tipo, descricao, valor, vencimento, categoria, identificador_externo. tipo: pagar/receber. valor: decimal pt-BR estritamente positivo, sem exponencial, ex. 1.234,56. vencimento: DD/MM/YYYY ou YYYY-MM-DD. Descrição obrigatória; categoria e ID externo opcionais. Preview antes de gravar, relatório por linha, erros explícitos sem registros parciais escondidos.

Chave idempotente: identificador externo quando fornecido (prefixo csv:external), senão SHA-256 de campos normalizados (prefixo csv:hash), com regras de normalização testadas. Linhas idênticas sem IDs diferentes representam o mesmo lançamento; exigir IDs externos distintos para duplicatas legítimas. Retorno informa criadas/ignoradas/erros. O parser não escreve storage.

## Vendas (S02)
Colunas: identificador_venda, data_venda, valor_bruto, meio_pagamento, categoria. Identidade de venda independente do recebível. Repasse líquido e data de disponibilidade calculados separadamente; a mesma venda não é recebida duas vezes. CSV de contas não compartilha namespace da chave de vendas.

## Exportação (S04)
Cabeçalho, filtros, datas ISO, centavos/BRL desambiguados e UTF-8; escapar aspas, quebras e delimitadores. Neutralizar fórmula-injection para texto iniciado por =, +, - ou @. Não transmitir arquivo para servidor.

