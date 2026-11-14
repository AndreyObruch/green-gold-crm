FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Запуск миграции при старте контейнера (опционально, лучше делать отдельно)
# CMD ["sh", "-c", "node db/pg-migrate.js && node server-pg.js"]
CMD ["node", "server-pg.js"]