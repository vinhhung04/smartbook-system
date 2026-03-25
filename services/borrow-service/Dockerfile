FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts
COPY . .
RUN npx prisma generate
EXPOSE 3005
CMD ["npm", "run", "start"]
