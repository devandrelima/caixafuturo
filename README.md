# CaixaFuturo

Projeto open source para projetar o caixa de pequenos comércios/restaurantes e simular decisões com cálculos verificáveis, **sem IA externa no runtime**, sem servidor de aplicação e sem login.

**Status (12/11/2026):** Sprint 1 em execução. Já existem a base de dinheiro/datas (centavos em BigInt, datas civis) e a fundação visual (tokens, navegação, onboarding). **As vistas financeiras (projeção de 30 dias, importação CSV, calendário e demonstração) ainda não estão ligadas.** O estado real de cada task está em [`ESTADO.json`](ESTADO.json); nada é declarado pronto sem teste e commit registrados.

- [Especificação v2, seis sprints e tasks](docs/especificacao/README.md)
- [Decisões, arquitetura e riscos](docs/especificacao/00_visao_geral_e_decisoes.md)
- [Identidade visual, tokens, componentes e telas](docs/especificacao/design/README.md)
- [ADR-0005: Docker e contexto HTTP](docs/decisoes/0005-docker-e-contexto-http.md)
- [Skill Planejamento de Sistemas 2.0](https://github.com/devandrelima/planejamento-de-sistemas), revisão 76c187894d15ff2ecd744a25cc195feb68d72b0d

Prioridade candidatura iFood AI Builder 15/11/2026: S01 primeiro fluxo de caixa com 30 dias e risco; S02 só após aprovação humana da S01. As 31 funcionalidades do produto completo constam do planejamento.

## Desenvolvimento local

Requer Node.js 20.19+ (testado com 22).

```bash
npm ci
npm run dev                                  # servidor de desenvolvimento (Vite)
npm run test:unit -- --run --coverage        # testes unitários + cobertura (mínimo 80%)
npm run test:e2e                             # Playwright (quando houver testes E2E)
npm run build                                # typecheck + build de produção em dist/
```

## Executar com Docker

O app é uma SPA estática: o Docker compila com Node e serve `dist/` com Nginx (sem root, sistema de arquivos somente leitura). **Não são necessárias chaves de API nem credenciais.**

```bash
docker compose up -d --build     # constrói e inicia (primeira vez)
```

Acesse **`http://IP_DO_SERVIDOR:8084`**. A porta do host é `CAIXAFUTURO_PORT` (padrão **8084**; a 8080 é ocupada pelo code-server na VPS de desenvolvimento e não foi alterada). Para outra porta: `CAIXAFUTURO_PORT=8090 docker compose up -d`.

| Ação | Comando |
|---|---|
| Atualizar com verificação e *rollback* automático | `./scripts/deploy.sh` |
| Ver estado e saúde | `docker compose ps` (coluna *healthy*) |
| Ver logs | `docker compose logs -f caixafuturo` |
| Commit implantado | `curl http://IP:8084/version.txt` |
| Parar (sem apagar nada) | `docker compose stop caixafuturo` |
| Iniciar novamente | `docker compose start caixafuturo` |

`scripts/deploy.sh` constrói a imagem com o commit como *tag*, testa-a em um contêiner descartável, troca **somente** o serviço `caixafuturo`, espera ficar saudável e responder HTTP e, se falhar, restaura a imagem estável anterior (`caixafuturo:previous`). Nunca usa `docker compose down` nem toca em outros contêineres. O contêiner tem `restart: unless-stopped` e continua rodando após o fim da sessão do operador.

### Limitações importantes

- **Seus dados ficam no IndexedDB do navegador**, não no contêiner. Recriar ou reiniciar o contêiner não apaga esses dados; limpar os dados do site no navegador apaga. **Não há sincronização entre dispositivos nem backup automático.**
- **HTTP público por IP não é adequado para informações financeiras reais** (sem criptografia em trânsito). Use apenas os **dados fictícios** da demonstração. Para uso real é necessário HTTPS (fora do escopo da Sprint 1).
- Em HTTP por IP o navegador não oferece `crypto.subtle`; por isso o SHA-256 do importador é implementado em TypeScript puro (ADR-0005), sem trocar por hash fraco.

## Frontend
Estilo **clean, minimalista, warm e levemente cartoonesco**, com identidade original (off-white, areia, grafite, dourado). [Guia visual](docs/especificacao/design/README.md), [tokens JSON](docs/especificacao/design/tokens.json) e [telas da S01](docs/especificacao/design/telas/S01.md).
