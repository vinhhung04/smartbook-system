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
COPY services/inventory-service/package.json services/inventory-service/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter inventory-service...

COPY services/inventory-service services/inventory-service
COPY packages/shared packages/shared
RUN pnpm --dir services/inventory-service exec prisma generate
RUN pnpm --filter inventory-service deploy --legacy --prod /app

FROM base AS runtime

WORKDIR /app
COPY --from=builder --chown=node:node /app ./
RUN node_modules/.bin/prisma generate

RUN mkdir -p /app/evidence/packing /app/evidence/procurement \
    && chown -R node:node /app/evidence
USER node

EXPOSE 3001
CMD ["node", "-r", "./src/telemetry.js", "src/index.js"]
