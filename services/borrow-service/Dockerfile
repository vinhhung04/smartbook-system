FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install -g pnpm && pnpm install
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
EXPOSE 3005
CMD ["npm", "run", "start"]
