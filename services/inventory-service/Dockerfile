FROM node:20 AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/inventory-service/package.json services/inventory-service/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter inventory-service...

COPY services/inventory-service services/inventory-service
COPY packages/shared packages/shared
RUN pnpm --dir services/inventory-service exec prisma generate
RUN pnpm --filter inventory-service deploy --legacy --prod /app

FROM node:20

WORKDIR /app
COPY --from=builder /app ./
RUN node_modules/.bin/prisma generate

EXPOSE 3001
CMD ["node", "src/index.js"]
