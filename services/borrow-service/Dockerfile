FROM node:20-slim AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/borrow-service/package.json services/borrow-service/package.json
RUN pnpm install --frozen-lockfile --filter borrow-service...

COPY services/borrow-service services/borrow-service
RUN pnpm --dir services/borrow-service exec prisma generate
RUN pnpm --filter borrow-service deploy --legacy --prod /app

FROM node:20-slim

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app ./
RUN node_modules/.bin/prisma generate

EXPOSE 3005
CMD ["node", "src/index.js"]
