FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Tạo mã Prisma Client
RUN npx prisma generate
EXPOSE 3001
CMD ["node", "src/index.js"]