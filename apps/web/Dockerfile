FROM node:20-alpine AS builder

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

FROM nginx:1.27-alpine

# Origins allowed by the Content-Security-Policy connect-src; overridden at runtime by docker-compose.
ENV API_ORIGIN=http://localhost:3000 \
    API_WS_ORIGIN=ws://localhost:3000 \
    NGINX_ENVSUBST_FILTER=^API_
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 80
