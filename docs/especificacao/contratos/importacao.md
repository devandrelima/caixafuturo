# Contrato CSV — v1

## Contas (S01)
UTF-8 com ou sem BOM; separador ; ou , com suporte verdadeiro a aspas. Colunas: tipo, descricao, valor, vencimento, categoria, identificador_externo, referencia_venda (opcional, S02). tipo: pagar/receber. valor: decimal pt-BR estritamente positivo, sem exponencial, ex. 1.234,56. vencimento: DD/MM/YYYY ou YYYY-MM-DD. Descrição obrigatória; categoria e ID externo opcionais. Preview antes de gravar, relatório por linha, erros explícitos sem registros parciais escondidos.

Chave idempotente: identificador externo quando fornecido (prefixo csv:external), senão SHA-256 de campos normalizados (prefixo csv:hash), com regras de normalização testadas. Linhas idênticas sem IDs diferentes representam o mesmo lançamento; exigir IDs externos distintos para duplicatas legítimas. Retorno informa criadas/ignoradas/erros. O parser não escreve storage. `referencia_venda` (até 100 caracteres, só para `receber`) liga a conta a uma venda do CSV de vendas ([ADR-0006](../../decisoes/0006-conciliacao-recebiveis.md)); `A|B` indica lote (não suportado, sinalizado). Ela **não** entra na chave idempotente: reimportar o mesmo arquivo com a referência nova numa conta já existente só atualiza a referência, sem duplicar. Arquivos sem a coluna continuam válidos.

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

Formato decidido em [ADR-0008](../../decisoes/0008-recorrencias-13-semanas-exportacao.md) (D10–D12): UTF-8 **com BOM**, separador `;`, decimal com vírgula, CRLF, datas `AAAA-MM-DD`, cabeçalhos fixos; dinheiro em `valor` (reais, vírgula) e `valor_centavos` (inteiro). Texto iniciado por `=`, `+`, `-`, `@`, TAB ou CR (após espaços à esquerda) recebe prefixo `'`. A exportação de lançamentos usa as colunas do CSV de contas; reimportação idempotente garantida só para origem `csv` (limites em D12). O arquivo é gerado no navegador e não é transmitido.


