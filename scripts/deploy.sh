#!/usr/bin/env bash
# Atualiza SOMENTE o serviço CaixaFuturo com a versão atual do repositório.
#   build da imagem -> smoke test em contêiner descartável -> troca do serviço
#   -> espera "healthy" + HTTP -> em falha, restaura a imagem estável anterior.
# Nunca executa "docker compose down" e não mexe em outros contêineres.
#
# Variáveis: CAIXAFUTURO_PORT (padrão 8084), CAIXAFUTURO_PUBLIC_HOST (padrão: 1º IP da máquina)
# Teste de falha: DEPLOY_SIMULATE_POST_FAIL=1 reprova a verificação após a troca (exercita o rollback).
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${CAIXAFUTURO_PORT:-8084}"
export CAIXAFUTURO_PORT="$PORT"
SERVICE=caixafuturo
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then SHA="${SHA}-dirty"; fi
export GIT_SHA="$SHA"
HOST_IP="${CAIXAFUTURO_PUBLIC_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}"

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERRO: %s\n' "$*" >&2; exit 1; }

exec 9>/tmp/caixafuturo-deploy.lock
flock -n 9 || die "outro deploy está em andamento."

wait_healthy() { # $1 = contêiner, $2 = segundos
  local end=$((SECONDS + $2)) status
  while [ "$SECONDS" -lt "$end" ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo missing)"
    [ "$status" = healthy ] && return 0
    sleep 2
  done
  return 1
}

http_ok() { # $1 = URL base
  curl -fsS -m 5 -o /dev/null "$1/" \
    && curl -fsS -m 5 "$1/movimentacoes" | grep -q '<div id="root">' \
    && curl -fsS -m 5 "$1/healthz" | grep -q '^ok'
}

# 1) Build da nova imagem (tag = commit).
log "build da imagem caixafuturo:${SHA}"
docker build --pull=false -q -t "caixafuturo:${SHA}" --build-arg "GIT_SHA=${SHA}" . >/dev/null
docker image inspect "caixafuturo:${SHA}" >/dev/null || die "imagem não encontrada após o build."

# 2) Smoke test da imagem nova em contêiner descartável (loopback, porta efêmera).
SMOKE="caixafuturo-smoke-$$"
trap 'docker rm -f "$SMOKE" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$SMOKE" -p 127.0.0.1::8080 "caixafuturo:${SHA}" >/dev/null
if ! wait_healthy "$SMOKE" 40; then
  docker logs --tail 30 "$SMOKE" >&2 || true
  die "a imagem nova não ficou saudável; versão estável preservada (nada foi trocado)."
fi
SMOKE_PORT="$(docker port "$SMOKE" 8080/tcp | head -1 | sed 's/.*://')"
http_ok "http://127.0.0.1:${SMOKE_PORT}" || die "smoke HTTP falhou; versão estável preservada."
docker rm -f "$SMOKE" >/dev/null
log "imagem nova verificada."

# 3) Guarda a imagem estável atual como :previous, se houver contêiner em execução.
PREV_ID="$(docker inspect -f '{{.Image}}' "$SERVICE" 2>/dev/null || true)"
if [ -n "$PREV_ID" ]; then
  docker tag "$PREV_ID" caixafuturo:previous
  log "versão estável anterior guardada como caixafuturo:previous"
fi

# 4) Troca somente este serviço.
log "atualizando o serviço ${SERVICE} (porta ${PORT})"
CAIXAFUTURO_TAG="$SHA" docker compose up -d --no-build --no-deps "$SERVICE"

verify() {
  wait_healthy "$SERVICE" 60 && http_ok "http://127.0.0.1:${PORT}" && [ "${DEPLOY_SIMULATE_POST_FAIL:-0}" != 1 ]
}

if verify; then
  docker tag "caixafuturo:${SHA}" caixafuturo:latest
  log "OK: commit ${SHA} em produção local."
  log "URL: http://${HOST_IP}:${PORT}"
  exit 0
fi

# 5) Rollback para a versão estável anterior.
log "FALHA após a troca; restaurando a versão anterior."
if [ -n "$PREV_ID" ]; then
  CAIXAFUTURO_TAG=previous docker compose up -d --no-build --no-deps "$SERVICE"
  if wait_healthy "$SERVICE" 60 && http_ok "http://127.0.0.1:${PORT}"; then
    die "nova versão (${SHA}) reprovada; versão anterior restaurada e saudável."
  fi
  die "nova versão reprovada e a restauração também falhou; verifique 'docker logs ${SERVICE}'."
fi
docker rm -f "$SERVICE" >/dev/null 2>&1 || true
die "nova versão reprovada e não havia versão anterior para restaurar."
