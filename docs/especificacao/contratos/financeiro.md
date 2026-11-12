# Contrato financeiro — v1

## Tipos e moeda
Valores monetários persistidos como string decimal de centavos inteiros (ex. "123456" = R$ 1.234,56); operar com BigInt, nunca number/float para dinheiro. JSON não serializa BigInt: converter explicitamente. Valores de lançamento são magnitude positiva e direção separada (in/out); saldos podem ser negativos.

CashSettings = {baseDate: ISODate, openingBalanceCents: CentString, minimumBalanceCents: CentString}. openingBalance é fotografia conciliada ao FINAL de baseDate. Datas são datas civis YYYY-MM-DD, não timestamps UTC de vencimento.

CashEntry = {id, direction:'in'|'out', amountCents, dueDate, description, category, origin:'manual'|'csv'|'demo'|'sale'|'recurring', sourceKey, state:'scheduled'|'settled', settledAt?, linkedSaleId?}. S01 projeta lançamentos scheduled depois da data-base. Títulos já liquidados e refletidos no saldo inicial não entram outra vez; vencidos antes da data-base são sinalizados para ajuste/conciliação manual, não somados implicitamente.

DailyPoint = {date, openingCents, incomingCents, outgoingCents, closingCents, entryIds[], risk, shortfallCents}. Horizonte: 30 datas civis a partir de baseDate+1. Equação: closing = opening + recebimentos scheduled - pagamentos scheduled; opening próximo dia = closing anterior. Risco negative se closing < 0; below_minimum se 0 <= closing < minimum (ou risco negativo com prioridade); shortfall = max(0, minimum-closing). Saldo exatamente no mínimo não gera alerta.

## Rastreio e conciliação
Vendas não são dinheiro disponível. Vendas geram expectativa de recebível líquido por regra de repasse, ligada à origem. Realizado/confirmado substitui ou concilia previsto, nunca soma ambos. Preservar IDs causais em saldo/alerta. Reimportar por chave estável não duplica eventos. Saldo real da data-base não é sobrescrito por hipótese, previsão ou cenário. Testar zero, negativo, reimportação, fim de mês e diferença entre datas.

