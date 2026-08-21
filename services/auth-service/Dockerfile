FROM node:20 AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/auth-service/package.json services/auth-service/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter auth-service...

COPY services/auth-service services/auth-service
COPY packages/shared packages/shared
RUN pnpm --dir services/auth-service exec prisma generate
RUN pnpm --filter auth-service deploy --legacy --prod /app

FROM node:20

WORKDIR /app
COPY --from=builder /app ./
RUN node_modules/.bin/prisma generate

EXPOSE 3002
CMD ["node", "src/index.js"]
