# CaixaFuturo — especificação executável 2.0

Hierarquia oficial: PROJETO → SPRINT → PROMPT-MAPA → TASK. Mapas humanos orientam; tasks JSON são a execução operacional por agentes, com dependências, escrita autorizada, contextos e testes.

[Visão e decisões](00_visao_geral_e_decisoes.md) | [Plano JSON](plano.json) | [Sprints](sprints/S01/README.md) | [Memórias](memoria/global.md) | [Contratos](contratos/financeiro.md) | [Estado](../../ESTADO.json).

Six sprints cobrem as 31 funcionalidades sem exclusão. Sprint 1 é prioridade; nenhuma foi implementada até este momento. A próxima sprint somente começa após aprovação humana.

## CLI oficial (Python 3.10+)
Clonar a skill em diretório irmão, mantendo somente uma cópia da implementação do validador:

```bash
git clone https://github.com/devandrelima/planejamento-de-sistemas.git ../planejamento-de-sistemas
git -C ../planejamento-de-sistemas checkout 76c187894d15ff2ecd744a25cc195feb68d72b0d
python3 ../planejamento-de-sistemas/skills/planejamento-de-sistemas/scripts/fluxo.py --repo . validar
python3 ../planejamento-de-sistemas/skills/planejamento-de-sistemas/scripts/fluxo.py --repo . prontas
python3 ../planejamento-de-sistemas/skills/planejamento-de-sistemas/scripts/fluxo.py --repo . contexto S01-P01-T01
```
A CLI não executa testes de produto, não impõe isolamento de escrita e não autentica aprovação. Os comandos npm citados nos manifestos serão disponibilizados somente durante a implementação autorizada.
