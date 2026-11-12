# ADR-0006 — Conciliação de recebíveis: contas importadas × repasses derivados de vendas (PEND-S02-001)

Data: 2026-11-12
Status: **aceita pelo usuário em 12/11/2026** (três decisões, todas as opções recomendadas). Detalhes operacionais marcados "(proposto pelo executor)" derivam dessas decisões e podem ser revistos na avaliação da Sprint 2.

## Contexto
O mesmo repasse de cartão/Pix pode existir como conta a receber importada (CSV de contas, S01) e como recebível líquido calculado de uma venda (CSV de vendas, S02). IDs de arquivos distintos não impedem a dupla contagem. Ver [PEND-S02-001](../especificacao/pendencias/S02-conciliacao-recebiveis.md).

## Decisões do usuário
1. **Chave de vínculo:** coluna opcional `referencia_venda` no CSV de contas, igual ao `identificador_venda` da venda. Só ela vincula automaticamente. Valor + data **nunca** vinculam.
2. **Par ambíguo:** entra no saldo **somente o importado**; o repasse derivado fica *conciliação pendente* e fora do saldo até o usuário decidir.
3. **Escopo:** apenas **1:1** (1 venda ↔ 1 conta). Parcelas (1 venda → N repasses) e lotes (N vendas → 1 repasse) **não são suportados**: são sinalizados na UI e nos contratos, não fingidos.

## Modelo (proposto pelo executor, consequência das decisões)
**D1. Derivado é calculado, não gravado.** Recebível derivado = função pura de (vendas, regras, entradas, decisões). Mudar taxa/prazo muda data e valor do caixa. Regra por meio de pagamento: `feeBps` (taxa) + `commissionBps` (comissão) + `lagDays` (prazo em dias **corridos**). Líquido = bruto − arredondar_meio_sobe(bruto × (taxa+comissão) / 10 000), por venda. Data = data da venda + prazo. Pix e dinheiro padrão D+0, débito D+1, crédito D+30, voucher D+30 (editáveis; os padrões são hipóteses de configuração, não fatos de mercado).

**D2. Prioridade:** importado/confirmado > derivado/estimado. Um recebível derivado **coberto** por conta importada nunca é somado.

**D3. Estados do recebível derivado** (a UI mostra um rótulo textual para cada um):
| Estado | Significado | Entra no saldo? |
|---|---|---|
| `derived` (derivado) | sem conta importada correspondente nem pendência | **sim** (valor líquido na data calculada) |
| `reconciled` (conciliado) | exatamente uma conta importada referencia a venda, e essa conta referencia só ela; ou o usuário confirmou o par | não (vale a conta importada, que mantém seu valor/data; diferença para a estimativa é exibida) |
| `pending` (pendente) | há conta importada **sem referência** a ≤ 3 dias da data do derivado (ver D4) | **não** até decisão; a conta importada entra |
| `covered_batch` (lote não suportado) | conta importada referencia várias vendas (`A\|B\|C`) | não; a conta importada entra; aviso de limitação |
| `covered_installments` (parcelas não suportadas) | ≥ 2 contas importadas referenciam a mesma venda | não; as contas importadas entram; aviso de limitação |
| `before_base_date` | data calculada ≤ data-base (já está no saldo informado) | não (informativo) |
| `zero_net` | líquido zero após taxas (taxa+comissão = 100%) | não |

Conta importada: *importado* (sem vínculo), *conciliado* (vinculado), *referência sem venda* (a venda ainda não foi importada; a conta entra normalmente e o vínculo nasce quando a venda chegar), *lote/parcelas não suportados*.

**D4. Pendência.** Uma conta importada `in`, `scheduled`, **sem** `referencia_venda`, sem decisão `standalone` e não vinculada a um par, a ≤ 3 dias corridos da data de um recebível derivado, torna esse derivado `pending`. Isso sinaliza, não vincula. Rejeitado: vincular por valor/data (repasses coincidentes existem) e ignorar a proximidade (dupla contagem silenciosa).

**D5. Decisões humanas** (persistidas na store `reconciliation`, chave estável): `same {saleId, entryId}` (confirma o par; derivado vira conciliado) e `standalone {entryId}` ("esta conta não é de venda": deixa de gerar pendência; os derivados próximos voltam a contar). Decisão que aponta para conta inexistente é ignorada e sinalizada como obsoleta (nunca soma duas vezes).

**D6. Efeitos de operações.**
- *Reimportar* contas ou vendas: idempotente (chaves de origem); a ordem de importação não altera o resultado, pois o vínculo é recalculado do estado atual. Reimportar contas com `referencia_venda` nova numa conta já existente **atualiza apenas a referência** (enriquecimento), nunca duplica.
- *Editar* conta importada (valor/data): o vínculo permanece (a referência é preservada); o valor editado prevalece.
- *Liquidar* conta importada: continua cobrindo a venda; o derivado **não reaparece** (o dinheiro já está no saldo informado).
- *Excluir* conta importada: o vínculo desaparece e o derivado volta a contar (estimativa). Reimportar o mesmo arquivo recria a conta e o vínculo.
- *Venda alterada* (mesmo identificador, dados diferentes): conflito explícito na importação (T01); não sobrescreve.

**D7. Duas importações, um só caixa.** O motor (`project`) recebe, no máximo, uma entrada por recebimento econômico: contas importadas + derivados no estado `derived`. A explicação do saldo preserva as IDs causais (`rcv_<saleId>`, id da conta).

## Limitações documentadas (aparecem na UI e nos contratos)
Parcelas e lotes (acima); prazo só em dias corridos (sem feriados/dias úteis); sem pagamento parcial, estorno ou cancelamento de venda; taxa real diferente da configurada: prevalece o valor importado quando houver vínculo; antecipação de recebíveis não modelada; arredondamento por venda (a operadora pode arredondar por lote).

## Testes obrigatórios (gate da S02)
Contas→vendas e vendas→contas com resultado de caixa idêntico; reimportação de ambos sem duplicar; referência ausente com valor/data parecidos → pendente (não soma); lote e parcelas → sinalizados; editar/liquidar/excluir sem reaparecer dupla entrada; UI distingue importado / derivado / conciliado / pendente; migração IndexedDB v1→v2 sem perda de dados.

## Alternativas rejeitadas
Somente vínculo manual (sem prova de ordem inversa automática e mais trabalho do usuário); sugestão por valor/data com clique (mais UI; fora do prazo de 15/11); incluir lotes por lista de referências com soma líquida (mais código/testes; fica como evolução); contar só o derivado ou nenhum dos dois quando ambíguo (superestima caixa ou gera alarme falso).
