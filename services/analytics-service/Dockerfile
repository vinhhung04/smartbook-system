FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install -g pnpm && pnpm install --prod

COPY src ./src

EXPOSE 3006

CMD ["pnpm", "start"]
