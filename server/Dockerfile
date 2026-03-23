FROM node:22-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npx prisma generate

ENV NODE_ENV=production

ENTRYPOINT ["node", "src/index.js"]
