# ADR-0010 — Simulações avançadas: equipamento, contratação, vencimento de fornecedor e antecipação (Sprint 6)

Data: 2026-11-13
Status: **aceita (padrões recomendados adotados pelo executor)**. As cinco decisões de produto da seção 5 do prompt da S06 tinham recomendação explícita; todas foram adotadas, como na ADR-0009, e podem ser revistas na avaliação humana da Sprint 6.

## Contexto
A S06 entrega F23 (equipamento e parcelamento), F24 (contratação), F25 (vencimento de fornecedor) e F26 (antecipação de recebíveis) **dentro do Simulador da S05**. O motor da S05 só sabia mudar data/valor de lançamentos existentes; compra, contratação e antecipação precisam **criar lançamentos hipotéticos** e a antecipação também precisa **retirar** o recebível original. Nada é gravado nem executado: sem integração bancária, pagamento, renegociação, contratação ou antecipação reais.

## Decisões
**D1. Método do parcelamento = parcelas iguais com juros compostos mensais (tabela Price), em inteiros.** A parcela `PMT = P·r·(1+r)^n / ((1+r)^n − 1)` com `r = bps/10 000` é calculada **uma única vez** como fração exata em BigInt — `P·bps·(10000+bps)^n / (10000·((10000+bps)^n − 10000^n))` — arredondada meio-sobe; com taxa 0, `PMT = P/n` meio-sobe. Depois o saldo devedor é percorrido mês a mês: `juros_k = meio-sobe(saldo × bps / 10 000)`, `saldo −= PMT − juros_k`. **A última parcela é `saldo + juros_n` e absorve o resíduo.** Logo `Σ parcelas = principal + encargos` fecha **exatamente** por construção (`encargos = Σ parcelas − principal`). Sem float; sem "juros efetivos" ou CET prometidos: a tela mostra principal, encargos e total em texto. Faixas: 2 a 60 parcelas; 0 a 2 000 bps ao mês; erro claro se a parcela ficar abaixo de R$ 0,01 ou o saldo zerar antes da última parcela.
- **À vista**: uma saída do valor na data informada. **Adiada**: uma saída em data (depois da data-base) com **encargo único informado** (bps sobre o principal, meio-sobe, pode ser 0). **Parcelada**: N parcelas mensais a partir da primeira data, com a âncora do dia preservada (31/jan → 28/fev → 31/mar, ADR-0008; virada de ano e bissexto testados).
- Rejeitado: juros simples sobre o saldo (menos usual) e "usuário informa o valor da parcela" (esconde o encargo).

**D2. Antecipação: taxa ao mês em bps, proporcional aos dias corridos (dias/30).** `custo = meio-sobe(bruto × taxaBps × dias / (10 000 × 30))`, `dias = vencimento original − data da antecipação`; `líquido = bruto − custo`. Mostrado em R$ e em %. **Não há valor pré-preenchido**: o campo de taxa começa vazio, com exemplo ilustrativo rotulado como tal ("ex.: 2,5% ao mês; não é taxa de mercado"). Taxa 0 a 2 000 bps ao mês; custo ≥ bruto é recusado.
- **Elegibilidade**: recebível (`in`) **agendado** e que conta no saldo, com `data-base < data da antecipação < vencimento original`, **inteiro** (antecipação parcial fica fora). Valem derivados de venda **e** importados/manuais/recorrentes agendados (hipótese: o cliente/adquirente antecipa). Liquidado, vencido até a data-base, inexistente, saída, ou data fora do intervalo → ignorado com aviso.
- **Nunca duplica**: o original é **retirado** da data futura e o líquido entra **uma vez** na data antecipada (id `scn:<ajuste>:1`, `linkedSaleId` do original preservado para o rastro causal).

**D3. Contratação: tudo informado, nada estimado.** Entradas: custo mensal (salário ou valor) em centavos, **encargos em % informado** (bps, opcional) e **outros custos mensais fixos informados** (opcional), dia de pagamento (1–31), data inicial e data final opcional. Custo mensal total = `custo + meio-sobe(custo × encargosBps/10 000) + fixos`. Uma saída por mês, no dia de pagamento (com âncora de dia: 31 → 28/fev), **só em datas ≥ data inicial** (e ≤ data final), sem proporcional de mês parcial. **A tela não calcula 13º, férias, FGTS, rescisão, benefícios**: isso é aviso/premissa **fixa**. Encargos ou custos fixos não informados → "hipótese incompleta" sinalizada (o custo real tende a ser maior). Sem campo de "provisão" para 13º/férias nesta sprint.

**D4. Vencimento de fornecedor.** Move a data de **uma saída** agendada que conta no saldo, mantendo o valor; só a data muda. A trilha ("de 14/11 para 21/11") fica no texto da hipótese e no registro de mudanças do ajuste. Pode adiar ou antecipar; nova data igual à original, até a data-base, ou saída inexistente/liquidada/vencida → ignorado com aviso. Fora do horizonte é dito. Propriedade oposta à do atraso de recebível: **adiar uma saída nunca piora o saldo** (pode melhorar dias intermediários).

**D5. Motor estendido sem quebrar a regra de ouro (ADR-0009 D5).**
- `ApplierOutcome` ganha `additions` (lançamentos hipotéticos novos; `dependsOn` opcional) e `EntryChange` ganha `remove: true`. Retirar um lançamento **ocupa os três campos** (data, valor, presença): qualquer outro ajuste sobre ele, antes ou depois, conflita — **o primeiro vence e o conflito é avisado**; uma adição com `dependsOn` só vale se a retirada vale.
- Lançamentos criados têm **id e `sourceKey` determinísticos** `scn:<idDoAjuste>:<n>` (nunca aleatórios) → resultado reproduzível e o `project()` não os trata como duplicados. `id` de ajuste repetido segue ignorado.
- O resultado expõe `createdEntries`, `removedEntryIds` e, em cada efeito, o registro `changes` (campo, de → para) calculado pelo motor a partir do valor original.
- **Interação com S05**: atraso/choque e antecipação sobre o **mesmo recebível**: o primeiro da lista vence; o outro é ignorado com aviso (nunca soma dupla). Hipóteses das duas sprints coexistem na **mesma Alternativa**.
- Continua **uma só fonte de saldo**: `project()` para base e alternativa.

**D6. Origem dos lançamentos hipotéticos (menor impacto).** Não se cria valor novo em `EntryOrigin` (ripple em filtros, CSV e repositório). O lançamento hipotético usa `origin: 'manual'` **mas** o prefixo de id `scn:` o identifica (`isHypotheticalEntryId`); **nunca** é gravado nem exportado (a base e a alternativa vivem só na memória; nenhuma função de persistência recebe a alternativa). A UI o rotula "Hipótese". A base do app não pode conter ids com esse prefixo: se contiver, o motor recusa a criação e avisa.

**D7. Várias decisões na mesma Alternativa; sem exportação.** Uma só alternativa, com Original sempre visível (D9 da ADR-0009). Sem CSV da comparação.

**D8. Rotulagem.** Todo número é hipotético; **custo, taxa e datas em texto antes** de gráfico/tabela; sem CTA de execução ("Pagar", "Contratar", "Antecipar agora", "Confirmar compra"); rótulos neutros ("Adicionar hipótese de compra", "Simular antecipação"); selo "Hipótese" + borda tracejada (`cf-hypo`) — a cor nunca é o único sinal; sem token novo. As decisões entram em **painéis/accordions** dentro do Simulador (sem menu novo).

## Limitações documentadas
Dias corridos (sem dias úteis/feriados); sem legislação trabalhista; sem CET/IOF/tributos; sem antecipação parcial; parcelas fora do horizonte (30 dias) não entram no saldo projetado — isso é dito; hipóteses não são salvas.

## Testes obrigatórios (gate da S06)
Parcelas + encargos = total (à mão e por propriedade pseudoaleatória determinística; R$ 10.000,00 em 3× a 2% a.m.; R$ 1,00 em 3×; taxa 0); âncora do dia, virada de ano e bissexto; custo de contratação só depois da data inicial; só a data muda no fornecedor, com trilha; adiar saída nunca piora saldo; antecipação sem duplicar o futuro (soma e id causal); composição e conflito entre as quatro decisões e S05; base idêntica antes/depois (congelamento profundo); determinismo; rótulos hipotéticos; ausência de CTA de execução.
