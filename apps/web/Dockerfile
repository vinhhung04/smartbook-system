FROM node:20-alpine AS builder

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter web...

COPY apps/web apps/web
WORKDIR /workspace/apps/web
RUN pnpm run build

FROM node:20-alpine

WORKDIR /app
RUN npm install -g serve@14.2.4
COPY --from=builder /workspace/apps/web/dist ./dist

EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
