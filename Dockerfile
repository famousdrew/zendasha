FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY db ./db

RUN npx tsc

RUN npm prune --omit=dev

CMD ["node", "dist/index.js"]
