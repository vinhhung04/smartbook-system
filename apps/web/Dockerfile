FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS base

# Supported LTS runtime and current vendor security patches. Release images are
# recorded/deployed by digest; no owner credentials or workspace .env is copied.
RUN apt-get update -y \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web...

COPY apps/web apps/web
WORKDIR /workspace/apps/web

# Vite inlines VITE_* at build time; these defaults match apps/web/.env.production and are overridden
# through docker-compose build.args (WEB_API_ORIGIN in .env).
ARG VITE_API_BASE_URL=http://localhost:3000
ARG VITE_AUTH_BASE_URL=http://localhost:3000
ARG VITE_AI_BASE_URL=http://localhost:3000/ai
ARG VITE_GATEWAY_BASE_URL=http://localhost:3000
ARG VITE_GATEWAY_HEALTH_URL=http://localhost:3000/health
ARG VITE_GATEWAY_READY_URL=http://localhost:3000/ready
ARG VITE_GATEWAY_SYSTEM_HEALTH_URL=http://localhost:3000/system/health
ARG VITE_AI_HEALTH_URL=http://localhost:3000/ai/health
ARG VITE_PACKING_RECORD_DELAY_SECONDS=15
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL \
    VITE_AI_BASE_URL=$VITE_AI_BASE_URL \
    VITE_GATEWAY_BASE_URL=$VITE_GATEWAY_BASE_URL \
    VITE_GATEWAY_HEALTH_URL=$VITE_GATEWAY_HEALTH_URL \
    VITE_GATEWAY_READY_URL=$VITE_GATEWAY_READY_URL \
    VITE_GATEWAY_SYSTEM_HEALTH_URL=$VITE_GATEWAY_SYSTEM_HEALTH_URL \
    VITE_AI_HEALTH_URL=$VITE_AI_HEALTH_URL \
    VITE_PACKING_RECORD_DELAY_SECONDS=$VITE_PACKING_RECORD_DELAY_SECONDS
RUN pnpm run build

FROM nginx:1.30.6-alpine3.24@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a AS runtime
RUN apk upgrade --no-cache

# Origins allowed by the Content-Security-Policy connect-src; overridden at runtime by docker-compose.
ENV API_ORIGIN=http://localhost:3000 \
    API_WS_ORIGIN=ws://localhost:3000 \
    NGINX_ENVSUBST_FILTER=^API_
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html

# Envsubst writes conf.d at startup; Nginx needs only its cache and /tmp PID.
# Compose allows low-port binding inside this container's network namespace.
RUN sed -i '/^user[[:space:]]/d; s@^[[:space:]]*pid[[:space:]].*;@pid /tmp/nginx.pid;@' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d
USER nginx

EXPOSE 80
