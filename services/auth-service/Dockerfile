FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install -g pnpm && pnpm install
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN pnpm prune --prod

FROM node:20
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 3002
CMD ["npm", "run", "start"]
