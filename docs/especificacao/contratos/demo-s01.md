# Contrato — dataset sintético reproduzível da Sprint 1

**Somente demonstração fictícia.** Restaurante inventado. Valores em centavos inteiros, transações abertas (scheduled), datas ISO civis, sem conta ou pessoa real. A escolha é explícita: clicar "Carregar demonstração" e confirmar antes de substituir dados locais; reset com confirmação.

CashSettings: baseDate = 2026-11-11; openingBalanceCents = "300000" (R$ 3.000,00 conciliados ao final do dia); minimumBalanceCents = "100000" (R$ 1.000,00).

| ID | Data | Direção | Descrição fictícia | Centavos |
|---|---|---|---|---:|
| demo-despesa-01 | 2026-11-12 | out | Fornecedor fictício de alimentos | 250000 |
| demo-receita-01 | 2026-11-13 | in | Recebimento agendado fictício | 80000 |
| demo-despesa-02 | 2026-11-14 | out | Aluguel fictício | 200000 |
| demo-receita-02 | 2026-11-15 | in | Recebimento agendado fictício | 400000 |

Resultados **esperados de especificação**, ainda não executados no app:
- 12/11: 300000 - 250000 = 50000 centavos => saldo R$ 500; abaixo do mínimo por R$ 500.
- 13/11: 50000 + 80000 = 130000 centavos => saldo R$ 1.300; sem alerta.
- 14/11: 130000 - 200000 = -70000 centavos => saldo **-R$ 700**; abaixo do mínimo por **R$ 1.700**, risco negativo.
- 15/11: -70000 + 400000 = 330000 centavos => saldo R$ 3.300; sem alerta.
- Dias 16/11 até 11/12 (completa janela de 30 dias contada do dia seguinte à data-base) sem novas entradas seguem com R$ 3.300, salvo lançamento manual/importado.

Casos de teste: importação repetida não duplica; editar valor muda alerta; excluir conta elimina seu efeito; gráfico/tabela/calendário reproduzem os mesmos saldos; origem de cada dia é rastreável; todos os valores são reais calculados a partir de dados **fictícios**, não KPIs estáticos. Preferir manter datas fixas para repetibilidade em auditorias.

## Posse do dataset e integração (decisão da auditoria)
- **S01-P02-T02** cria `src/demo/restaurant.ts` com função exportada de geração determinística (nomes concretos definidos pela implementação), utilizando as configurações e lançamentos exatos deste contrato, e cria seus testes unitários em `src/demo/__tests__/restaurant.test.ts`. **Na mesma task**, `src/app/App.tsx` liga `Onboarding.onExploreDemo` ao carregamento intencional de fixture no repositório IndexedDB e à projeção real. A interface mostra dados fictícios e dá opção de confirmação antes de qualquer sobrescrita.
- **S01-P02-T03** não cria/edita fixture nem integração; lê `src/demo/restaurant.ts` e `src/app/App.tsx` e apenas valida por E2E, review visual e logs. Problemas levam a ajustes formalizados na T02; não ultrapassar `writes`.
- Teste de contrato obrigatório na T02: 4 eventos sintéticos, IDs estáveis, base em 11/11/2026, data mínima e saldos esperados; o retorno da fixture não deve possuir referência compartilhada mutável entre cargas. Teste E2E da T03 observa a UI depois de carregar e de recarregar a página.
