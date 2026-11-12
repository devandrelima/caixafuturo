# Contrato financeiro — v1

## Tipos e moeda
Valores monetários persistidos como string decimal de centavos inteiros (ex. "123456" = R$ 1.234,56); operar com BigInt, nunca number/float para dinheiro. JSON não serializa BigInt: converter explicitamente. Valores de lançamento são magnitude positiva e direção separada (in/out); saldos podem ser negativos.

CashSettings = {baseDate: ISODate, openingBalanceCents: CentString, minimumBalanceCents: CentString}. openingBalance é fotografia conciliada ao FINAL de baseDate. Datas são datas civis YYYY-MM-DD, não timestamps UTC de vencimento.

CashEntry = {id, direction:'in'|'out', amountCents, dueDate, description, category, origin:'manual'|'csv'|'demo'|'sale'|'recurring', sourceKey, state:'scheduled'|'settled', settledAt?, linkedSaleId?}. S01 projeta lançamentos scheduled depois da data-base. Títulos já liquidados e refletidos no saldo inicial não entram outra vez; vencidos antes da data-base são sinalizados para ajuste/conciliação manual, não somados implicitamente.

DailyPoint = {date, openingCents, incomingCents, outgoingCents, closingCents, entryIds[], risk, shortfallCents}. Horizonte: 30 datas civis a partir de baseDate+1. Equação: closing = opening + recebimentos scheduled - pagamentos scheduled; opening próximo dia = closing anterior. Risco negative se closing < 0; below_minimum se 0 <= closing < minimum (ou risco negativo com prioridade); shortfall = max(0, minimum-closing). Saldo exatamente no mínimo não gera alerta.

## Rastreio e conciliação
Vendas não são dinheiro disponível. Vendas geram expectativa de recebível líquido por regra de repasse, ligada à origem. Realizado/confirmado substitui ou concilia previsto, nunca soma ambos. Preservar IDs causais em saldo/alerta. Reimportar por chave estável não duplica eventos. Saldo real da data-base não é sobrescrito por hipótese, previsão ou cenário. Testar zero, negativo, reimportação, fim de mês e diferença entre datas.


## Conciliação entre origens (S02) — decidida em [ADR-0006](../../decisoes/0006-conciliacao-recebiveis.md)
Resolve a PEND-S02-001. Resumo normativo:
- `CashEntry.saleReference?` guarda o `identificador_venda` informado na coluna `referencia_venda` do CSV de contas (`A|B` = lote, não suportado). Vínculo automático **somente** por essa referência; nunca por valor+data.
- Recebível derivado de venda é **calculado** (não gravado) por regra de repasse: líquido = bruto − round_half_up(bruto × (taxa+comissão)/10000); data = venda + prazo (dias corridos). Mudar taxa/prazo muda data e valor do caixa.
- Prioridade: importado > derivado. Estados do derivado: `derived` (conta), `reconciled`, `pending`, `covered_batch`, `covered_installments`, `before_base_date`; só `derived` entra no saldo. Pendente = há conta importada sem referência a ≤ 3 dias do derivado; no saldo entra só a importada até decisão humana (`same` ou `standalone`).
- O resultado independe da ordem de importação (vínculo recalculado do estado). Editar/liquidar mantém o vínculo; excluir a conta devolve o derivado ao saldo.
- **Limitações:** parcelas e lotes não suportados (sinalizados); prazo em dias corridos; sem estorno/pagamento parcial.
- Regressão obrigatória do `project()` da S01 (demo 12/11 R$ 500 · 13/11 R$ 1.300 · 14/11 −R$ 700 · 15/11 R$ 3.300) inalterada: derivados chegam ao motor como `CashEntry` comuns (`origin: 'sale'`, `sourceKey: sale-settlement:<id>`).


## Recorrências e 13 semanas (S04) — decididas em [ADR-0008](../../decisoes/0008-recorrencias-13-semanas-exportacao.md)
- `RecurrenceRule = {id, direction, amountCents, description, category, frequency:'weekly'|'biweekly'|'monthly'|'yearly', startDate, endDate?, skippedDates?[]}`. Regra persistida; **ocorrências são calculadas** (função pura), não gravadas. Periodicidades em dias corridos; sem dias úteis/feriados (limitação).
- Mensal/anual preservam a âncora do dia: 31/jan → último dia de fev → 31/mar; 29/fev → 28/fev em ano não bissexto. `startDate` e `endDate` inclusivas.
- Ocorrência = `CashEntry` com `origin:'recurring'`, `state:'scheduled'`, `sourceKey = rec:<ruleId>:<data>`. Só datas **depois da data-base** (como o motor). Lançamento real com a mesma `sourceKey` (qualquer estado) suprime a ocorrência; lançamento equivalente (direção, vencimento, valor e descrição normalizada) também, **informando** a cobertura. Passado liquidado/conciliado/editado é imutável; excluir regra não apaga lançamentos.
- **13 semanas:** semana de segunda a domingo; a 1ª semana (que contém `baseDate+1`) pode ser parcial e a 13ª termina num domingo (horizonte ≤ 91 dias). Saldo de fechamento da semana = fechamento diário do último dia da semana no horizonte, do mesmo `project()`. Premissas: lançamentos + repasses derivados; nunca previsão de faturamento nem hipótese manual. A incerteza cresce com o horizonte.
- **Filtros:** só visualização; nunca alteram saldo nem escondem alertas globais; o somatório mostrado corresponde exatamente aos IDs listados.
