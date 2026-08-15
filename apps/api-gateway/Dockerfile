FROM node:20-slim AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json apps/api-gateway/package.json
RUN pnpm install --frozen-lockfile --filter api-gateway...

COPY apps/api-gateway apps/api-gateway
RUN pnpm --filter api-gateway deploy --legacy --prod /app

FROM node:20-slim

WORKDIR /app
COPY --from=builder /app ./

EXPOSE 3000
CMD ["node", "src/index.js"]
