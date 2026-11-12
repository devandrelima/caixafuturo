# syntax=docker/dockerfile:1

# ---- Estágio 1: compila a SPA (Vite) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG GIT_SHA=desconhecido
RUN npm run build && printf '%s\n' "$GIT_SHA" > dist/version.txt

# ---- Estágio 2: serve apenas os arquivos estáticos com Nginx (sem root) ----
FROM nginxinc/nginx-unprivileged:1.29-alpine
ARG GIT_SHA=desconhecido
LABEL org.opencontainers.image.title="CaixaFuturo" \
      org.opencontainers.image.source="https://github.com/devandrelima/caixafuturo" \
      org.opencontainers.image.revision="$GIT_SHA"
COPY --chmod=0644 docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chmod=0755 /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
