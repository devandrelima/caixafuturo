# ADR-0009 — Simulador de cenários: base imutável, atraso, choques e comparação (Sprint 5)

Data: 2026-11-12
Status: **aceita (padrões conservadores adotados pelo executor)**. As cinco decisões de produto da seção 5 do prompt da S05 tinham uma recomendação explícita; todas foram adotadas sem consulta adicional e podem ser revistas na avaliação humana da Sprint 5.

## Contexto
A S05 entrega F21 (atrasar recebíveis), F22 (choque de vendas/despesas) e F27 (comparação de cenários). O contrato de simulação define `simulate(baseSnapshot, adjustments) -> baseProjection, alternativeProjection, deltaByDate, assumptions, warnings` e exige base imutável, sem gravar nos lançamentos reais e com o Original sempre visível. Não há valor "hipótese" em `tokens.json`.

## Decisões
**D1. Persistência: só memória.** Cenários vivem no estado da sessão (React). Nada vai ao IndexedDB; **sem migração v4**; recarregar a página descarta as hipóteses. Rejeitado: salvar cenários (exigiria migração e decidir o que fazer quando a base muda).

**D2. Base = fotografia reproduzível.** `BaseSnapshot = {id, settings, horizonDays, entries, saleBasis}`. `entries` são os lançamentos que alimentam o motor hoje (`planningEntries`: contas importadas/manuais + repasses derivados + ocorrências de recorrência), sem duplicados (mesma regra do `project()`), profundamente congelada. `id = "snap_" + 16 primeiros hex de SHA-256 puro (sha256Hex) do JSON canônico` (chaves ordenadas). Não usa `crypto.subtle` nem relógio. Previsão de faturamento da S03 **nunca** entra. O saldo real da data-base nunca é alterado.

**D3. Um só motor de saldo.** A base e a alternativa são calculadas por `project()` (mesmo horizonte). Não existe fórmula paralela. `deltaByDate[d] = alternativa.closing[d] − base.closing[d]`, em BigInt, para todo dia do horizonte.

**D4. Ajustes tipados e abertos.** Na S05 só existem `delay_receipt`, `scale_sales` e `scale_expense`; os demais tipos do contrato (`equipment_purchase`, `hiring`, `shift_vendor_due`, `advance_receivable`) são da S06 e, se aparecerem, são **ignorados com aviso** ("tipo ainda não suportado"). Cada ajuste tem `id` único, rótulo e valores em centavos (string) / basis points (inteiro).

**D5. Composição sem soma dupla.** Cada ajuste só *propõe* mudanças por (lançamento, campo: `dueDate` ou `amountCents`) **calculadas a partir do valor original da base**. O motor aplica no máximo uma mudança por (lançamento, campo): o primeiro ajuste da lista vence e os seguintes sobre o mesmo campo são ignorados **com aviso de conflito**. Um `id` de ajuste repetido é ignorado (idempotência). Atraso (muda a data) e choque (muda o valor) são independentes e se combinam; o período do choque refere-se ao vencimento **original**, nunca ao deslocado.

**D6. Atraso (F21).** Dias corridos (sem dias úteis/feriados — mesma limitação da ADR-0008), 0 a 365, aplicado a **um recebível por vez** (por id do lançamento). Vale para qualquer lançamento `in` agendado que conta no saldo: **importado/confirmado** (hipótese: o cliente paga depois) e **derivado de venda** (hipótese: o repasse atrasa). O valor sai da data original e aparece **uma única vez** na nova; soma total e id causal preservados. Atraso de 0 dia é "sem mudança" (avisado). Se a nova data passa do horizonte, o valor deixa de contar no horizonte e isso é **dito**. Liquidado, vencido até a data-base, inexistente ou de saída: ignorado com aviso. Atrasar por período/categoria fica fora do escopo.

**D7. Choque (F22).** Fator em **basis points inteiros** (10 000 = 100%, faixa 0–100 000) ou valor explícito por lançamento afetado (`deltaCents`), com período `[início, fim]` **inclusivo** no vencimento original.
- `scale_sales`: afeta só **repasses derivados de venda** (`origin: 'sale'`, que contam no saldo). Escala o **bruto** e recalcula o líquido pela regra de repasse da ADR-0006 (`líquido = bruto' − meio_sobe(bruto' × (taxa+comissão)/10000)`); por isso o motor recebe `saleBasis` (bruto e custo em bps por repasse). Contas **importadas** e vendas **conciliadas** (valem a conta importada) não entram: são dados confirmados. Vendas futuras e previsão não existem na base, portanto **não são simuladas**; o choque é sobre os repasses já esperados (isso é dito na tela).
- `scale_expense`: afeta lançamentos `out` agendados que contam no saldo, com filtro opcional por categoria exata.
- Arredondamento meio-sobe (`(x·2 + denom) / (2·denom)`); resultado ≤ 0 remove o lançamento da alternativa (avisado). Liquidados nunca mudam.
- A UI expõe o fator percentual; o valor explícito existe no motor e é testado, sem campo na tela nesta sprint.

**D8. Rótulo hipotético sem paleta nova.** Reutilizar `Cf*` e tokens existentes; hipótese = **texto** ("Hipótese", "Alternativa (hipotética)") + **forma** (borda tracejada/selo) — a cor nunca é o único sinal. Sem token novo (`validar_design.py` continua passando). Nenhum botão sugere execução real; CTA "Voltar ao original".

**D9. Uma alternativa; Original sempre visível.** Desktop: colunas lado a lado (Original | Alternativa) + diferença por dia. Mobile: abas Original/Alternativa rotuladas + a diferença sempre visível. Várias alternativas ficam para depois.

**D10. Sem exportação CSV da comparação** nesta sprint (fora do escopo planejado).

## Limitações documentadas
Dias corridos; um atraso por recebível; choque só sobre repasses derivados e despesas já agendadas; sem sazonalidade/vendas futuras; sem custo de antecipação (S06); hipóteses não são salvas.

## Alternativas rejeitadas
Escalar o líquido diretamente (diverge até 1 centavo da regra da ADR-0006 e esconde taxa); incluir importadas no choque de vendas (altera dado confirmado); encadear ajustes sobre o resultado do anterior (permite soma dupla); persistir cenários (migração e invalidação da base).

## Testes obrigatórios (gate da S05)
Base idêntica antes/depois (congelamento profundo); mesmo input ⇒ mesmo resultado; `delta = alt − base` em todos os dias (propriedade determinística); atraso sem duplicar (fim de mês, virada de ano, fora do horizonte, 0 dia, dois ajustes no mesmo recebível); novo risco criado e removido; choque em bps com meio-sobe exato e idempotente; rótulo hipotético; "Voltar ao original" sem perda.
