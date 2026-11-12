# ADR-0008 — Recorrências calculadas, fluxo de 13 semanas, filtros e exportação CSV (Sprint 4)

Data: 2026-11-12
Status: **aceita**. As decisões D9–D10 (formato do CSV) foram respondidas pelo usuário em 12/11/2026 (opções recomendadas). As demais (D1–D8) são padrões conservadores adotados pelo executor, seguindo o princípio da [ADR-0006](0006-conciliacao-recebiveis.md); podem ser revistas na avaliação da Sprint 4.

## Contexto
A S04 acrescenta recorrências (F05), visão semanal de até 13 semanas (F15), filtros/detalhe (F29) e exportação CSV (F30). O contrato financeiro já prevê `origin: 'recurring'` e `sourceKey`, mas não define periodicidades, âncora do dia 31 nem o que acontece com o passado quando a regra muda.

## Decisões
**D1. Regra persistida, ocorrência calculada.** O que se grava é a *regra* (`RecurrenceRule`). As ocorrências futuras são uma função pura de (regras, lançamentos existentes, janela); não se gravam N lançamentos duplicáveis. Isso exige uma store nova (`recurrence`) e migração **v3** do IndexedDB (v2 → v3 só acrescenta a store; nenhum dado existente é tocado).

**D2. Periodicidades:** `weekly` (7 dias), `biweekly` (14 dias), `monthly`, `yearly`. Sem dias úteis, feriados nem "último dia útil": **limitação documentada** (dias corridos/datas civis).

**D3. Dia 31 em mês curto: usa o último dia do mês, preservando a âncora.** A n-ésima ocorrência mensal é `min(dia_da_âncora, último_dia_do_mês)`: 31/jan → 28 ou 29/fev → 31/mar (não 28/mar). Anual a partir de 29/fev → 28/fev em ano não bissexto e volta a 29/fev em bissexto. "Pular o mês" foi rejeitado: uma despesa de aluguel que some do fluxo é pior que uma que antecipa 1–3 dias.

**D4. Datas inicial e final inclusivas.** `endDate` ausente = sem fim (a janela da projeção limita a expansão). `endDate < startDate` é erro de validação.

**D5. Identidade estável.** `sourceKey = rec:<ruleId>:<AAAA-MM-DD>`; id interno `rec_<sha256(sourceKey)[0..20]>`. A mesma ocorrência nunca entra duas vezes: se já existe um lançamento real (qualquer estado) com a mesma `sourceKey`, a ocorrência calculada é suprimida. A supressão é por chave, não por data: se o usuário editar o lançamento materializado (mudar vencimento/valor), a ocorrência calculada original continua suprimida.

**D6. O passado liquidado é imutável.** Ocorrência liquidada/conciliada/editada vira um lançamento real (`origin: 'recurring'`, mesma `sourceKey`) e passa a valer sozinho. Mudar ou excluir a regra afeta apenas ocorrências *calculadas* futuras. A expansão só cobre datas **depois da data-base** (mesma convenção do motor: o que vence até a data-base já está no saldo inicial); ocorrências anteriores sem lançamento real não são fabricadas. Excluir uma regra não apaga lançamento algum. Pular uma única ocorrência é `skippedDates` da regra.

**D7. Equivalência com lançamento manual/importado.** Uma ocorrência calculada **não** entra se já existir lançamento (qualquer origem/estado) com mesma direção, mesmo vencimento, mesmo valor e mesma descrição normalizada (mesma normalização do importador). A supressão **não é silenciosa**: a função devolve a lista `covered` com o motivo (`materialized` ou `equivalent`) e o id do lançamento que cobre. Não há vínculo por valor+data isoladamente.

**D8. Editar ocorrência: fora do escopo da S04.** Não há "editar esta e as seguintes". Para mudar o futuro, altera-se a regra (as ocorrências calculadas mudam; as já gravadas não). Para tratar uma ocorrência específica, liquida-se/edita-se o lançamento materializado ou pula-se a data.

**D9. Início da semana (13 semanas): segunda-feira.** Semana = segunda a domingo (datas civis). A 1ª semana é a que contém `baseDate+1`; a visão cobre no máximo 91 dias a partir de `baseDate+1`, recortando a última semana parcial no limite do horizonte (rótulo "parcial"). O saldo de fechamento da semana é, **exatamente**, o fechamento diário do último dia da semana no horizonte, vindo do **mesmo** `project()` (sem fórmula paralela de saldo). Premissas exibidas: lançamentos (incluindo recorrências calculadas) + repasses derivados das vendas; **nunca** previsão de faturamento nem hipótese manual. A incerteza cresce com o horizonte e a tela diz isso.

**D10. Formato do CSV exportado (decidido pelo usuário): Excel BR.** UTF-8 **com BOM**, separador `;`, decimal com **vírgula** (`1234,56`), fim de linha CRLF, datas ISO `AAAA-MM-DD`, cabeçalhos fixos e documentados. Colunas de dinheiro sempre em pares sem ambiguidade (`valor` em reais com vírgula **e** `valor_centavos` inteiro). Campos de texto com `;`, `"`, quebra de linha ou CR são envolvidos em aspas com `"` duplicado.

**D11. Injeção de fórmula.** Todo campo **de texto** cujo primeiro caractere (após remover espaços à esquerda, que algumas planilhas ignoram) seja `=`, `+`, `-`, `@`, TAB (`\t`) ou CR (`\r`) recebe um apóstrofo `'` como prefixo (OWASP CSV Injection), de modo que a célula é lida como texto. "-5% desconto" continua legível: sai como `'-5% desconto`. Campos numéricos gerados pelo próprio sistema (valor, centavos, saldos) não são texto livre e não são prefixados; um valor negativo (`-700,00`) é número legítimo — por isso saldos negativos só aparecem em colunas numéricas dedicadas, nunca em colunas de texto. **Limitação documentada:** o apóstrofo aparece em planilhas que o exibem literalmente e não é removido na reimportação por este app (ver D12).

**D12. Reimportável (decidido pelo usuário) — com limite honesto.** A exportação de **lançamentos** (Movimentações) usa as colunas do importador de contas (`tipo;descricao;valor;vencimento;categoria;identificador_externo;referencia_venda`), de modo que o arquivo é **sempre aceito** pelo importador (valor `1234,56`, datas ISO, BOM e `;` já suportados). A idempotência depende da origem, porque o importador deriva a chave `csv:external:<id>` ou `csv:hash:<assinatura>`: lançamentos de origem `csv` reimportam com a **mesma chave** (identificador externo original, sem o prefixo `csv:external:`; quando não havia identificador, a assinatura normalizada gera o mesmo hash) e portanto não duplicam nem mudam saldos. Lançamentos de origem `manual`, `recurring`, `sale` e `demo` **não** têm chave reproduzível pelo importador: reimportá-los **no mesmo banco** criaria novos lançamentos. Isso é limitação documentada e a UI avisa; o arquivo serve para levar contas a outro ambiente/planilha, não para "restaurar" no mesmo. A exportação inclui só lançamentos **agendados** do filtro atual. Outras exportações (projeção diária/semanal) têm formato próprio de leitura/análise e **não** são reimportáveis. Os resultados reais do teste de ida e volta com o importador serão registrados em `docs/evidencias/s04.md`.

## Consequências
- Nova store IndexedDB `recurrence` (v3), migração testada a partir de um banco v2 populado.
- `project()` permanece a única fonte de saldo; recorrências chegam ao motor como `CashEntry` comuns (`origin: 'recurring'`), como os derivados de venda.
- Filtros (F29) são só visualização: não alteram saldos nem escondem alertas globais.
