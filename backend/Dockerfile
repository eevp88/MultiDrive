FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npx prisma generate

EXPOSE 4000

CMD ["sh", "-c", "npm run db:migrate:deploy && npm run seed:google-config:docker && { npm run seed:microsoft-config || echo 'OneDrive config seed failed; Google Drive is unaffected.'; } && { npm run encrypt-share-tokens || echo 'Share token encryption failed; plain tokens stay readable and it is retried on the next start.'; } && node dist/server.js"]
