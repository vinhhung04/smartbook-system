FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install -g pnpm && pnpm install
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
COPY . .
RUN pnpm prune --prod

FROM node:20
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
ENV SERVICE_NAME=auth-service
EXPOSE 3002
CMD ["npm", "run", "start"]
