# Evidências — S01-P02-T05 (Docker)

Execução real em 12/11/2026, na VPS de desenvolvimento (Ubuntu 24.04, Docker 29.7.2, Compose v5.3.1). Nada abaixo foi inferido: todos os resultados vêm de comandos executados.

## Porta
- `8080` já estava em uso pelo **code-server** (PID 2316340, responde 302 → `/login`). Não foi tocado.
- Porta publicada do CaixaFuturo: **8084** (`CAIXAFUTURO_PORT`), livre, documentada em ADR-0005, compose e README.

## Verificações (container em execução, `caixafuturo:8c55615`)
| Verificação | Resultado |
|---|---|
| `docker compose config -q` | OK |
| Estado do container | `Up (healthy)`, `restart=unless-stopped`, `ReadonlyRootfs=true`, usuário `101` (não-root) |
| `GET /`, `/movimentacoes`, `/calendario` | 200 (fallback de SPA devolve `index.html`) |
| `GET /assets/inexistente.js`, `/favicon.ico` | 404 |
| `GET /healthz` | 200 `ok` |
| `GET /version.txt` | commit implantado (`8c55615`) |
| `GET http://84.247.135.249:8084/` (IP público, a partir da própria VPS) | 200 |
| Cabeçalhos | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP; `index.html` com `Cache-Control: no-cache`; assets com `max-age=31536000`; gzip ativo |
| Conteúdo da imagem final | somente Nginx + `dist/` (+ `version.txt`); sem `node_modules` nem código-fonte; sem variáveis secretas |

## Defeitos encontrados e corrigidos durante a task
1. `default.conf` copiado com permissão herdada do host (ACL, modo 660) → nginx `Permission denied`. O smoke test do `deploy.sh` **reprovou a imagem antes da troca**. `COPY --chmod` não surtiu efeito neste builder; corrigido com `chmod` explícito no Dockerfile.
2. Assets sem `Cache-Control`: a regex de extensões prevalecia sobre `location /assets/`; corrigido com `location ^~ /assets/`.

## Testes de falha do `scripts/deploy.sh`
- **A. Config Nginx inválida (antes da troca):** `unknown directive` → "imagem nova não ficou saudável; versão estável preservada". O serviço continuou `healthy`, HTTP 200, mesmo commit.
- **B. Falha simulada depois da troca** (`DEPLOY_SIMULATE_POST_FAIL=1`): "FALHA após a troca; restaurando a versão anterior" → serviço voltou `healthy` com HTTP 200 a partir de `caixafuturo:previous`.
- Observação: no cenário B a imagem anterior era idêntica à atual (deploy imediatamente anterior do mesmo commit); a mecânica de restauração por tag foi exercitada, mas não com conteúdo diferente.

## Firewall
O UFW está ativo (política de entrada `deny`) e **não tem regra explícita para 8084**. O tráfego para portas publicadas pelo Docker segue DNAT → `FORWARD` (cadeias `DOCKER`/`DOCKER-BRIDGE`, que aceitam a porta 8080 do container), caminho que o UFW não filtra; outros contêineres desta VPS publicados em `0.0.0.0` (ex.: 8081, 8092) funcionam do mesmo modo. **Alcance a partir da internet não foi verificado a partir de fora da VPS.** O firewall não foi alterado. Se o navegador não conectar, a causa provável é um firewall do provedor; a abertura de `8084/tcp` deve ser decidida pelo proprietário.

## Limites
- Os testes foram feitos com a SPA atual (fundação visual); o fluxo financeiro será servido à medida que as tasks avançarem.
- A execução do `app-ci.yml` no GitHub Actions é registrada no relatório final após o push.
