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
COPY apps/api-gateway/package.json apps/api-gateway/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter api-gateway...

COPY apps/api-gateway apps/api-gateway
COPY packages/shared packages/shared
RUN pnpm --filter api-gateway deploy --legacy --prod /app

FROM base AS runtime

WORKDIR /app
COPY --from=builder --chown=node:node /app ./

USER node

EXPOSE 3000
CMD ["node", "-r", "./src/telemetry.js", "src/index.js"]
