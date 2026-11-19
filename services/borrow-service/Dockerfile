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
COPY services/borrow-service/package.json services/borrow-service/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter borrow-service...

COPY services/borrow-service services/borrow-service
COPY packages/shared packages/shared
RUN pnpm --dir services/borrow-service exec prisma generate
RUN pnpm --filter borrow-service deploy --legacy --prod /app

FROM base AS runtime

WORKDIR /app
COPY --from=builder --chown=node:node /app ./
RUN node_modules/.bin/prisma generate

USER node

EXPOSE 3005
CMD ["node", "-r", "./src/telemetry.js", "src/index.js"]
