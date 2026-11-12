# 0005 — Execução em Docker (Nginx estático) e contexto HTTP sem `crypto.subtle`

Data: 2026-11-12
Status: aceita por determinação do usuário em 12/11/2026 para a Sprint 1.

## Contexto
O usuário exige acompanhar o aplicativo pelo navegador, em um endereço estável na VPS, durante o desenvolvimento. A SPA é 100% cliente (IndexedDB); não há servidor de aplicação, banco ou credenciais. O endereço será `http://IP_PUBLICO:PORTA`, ou seja, **contexto não seguro** do navegador (sem HTTPS): `window.crypto.subtle` fica `undefined`, embora IndexedDB continue disponível.

## Decisão
1. **Docker é requisito operacional da S01, não uma funcionalidade.** As 31 funcionalidades não mudam. Nova task `S01-P02-T05` cria `Dockerfile` multi-stage (Node compila o Vite; Nginx serve `dist/`), `compose.yaml`, `.dockerignore`, `docker/nginx.conf` (fallback de SPA, cabeçalhos básicos, gzip, cache de assets com hash), `scripts/deploy.sh` (build → verificação → troca somente do serviço CaixaFuturo, com preservação da última imagem estável) e a seção de operação no README.
2. **Porta publicada estável: 8084** (variável `CAIXAFUTURO_PORT`, padrão 8084). A 8080 pretendida já é usada pelo code-server desta VPS e não será alterada. Container com `restart: unless-stopped` e `healthcheck`.
3. **SHA-256 do importador não pode depender de `crypto.subtle`.** `S01-P01-T03` implementa SHA-256 puro e síncrono em TypeScript, verificado contra vetores oficiais e contra `node:crypto`. Não se usa hash fraco como substituto. O contrato `importacao.md` (SHA-256) permanece inalterado.
4. **HTTP público não é adequado a dados financeiros reais.** Demonstração só com dados fictícios; dados ficam no IndexedDB do navegador, não no container, e não sincronizam entre dispositivos. HTTPS é pré-requisito para uso real (fora do escopo da S01).
5. Nenhuma chave de API ou credencial é exigida para build ou execução. Nenhum serviço interno da VPS é exposto; o firewall não é alterado pelo projeto.

## Impactos e reversibilidade
Novas tasks/arquivos: `S01-P02-T05`; `S01-P01-T03` ganha `sha256.ts`; `S01-P02-T03` passa a depender da T05 e inclui E2E contra a URL por IP (contexto não seguro). Reversível por novo ADR; a SPA continua executável por `npm run dev`.
