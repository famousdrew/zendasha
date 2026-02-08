FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY db ./db

RUN npx tsc

CMD ["node", "dist/index.js"]
