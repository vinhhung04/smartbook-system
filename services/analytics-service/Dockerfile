FROM node:20-alpine AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/analytics-service/package.json services/analytics-service/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter analytics-service...

COPY services/analytics-service services/analytics-service
COPY packages/shared packages/shared
RUN pnpm --filter analytics-service deploy --legacy --prod /app

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app ./

EXPOSE 3006
CMD ["node", "src/index.js"]
