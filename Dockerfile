# Frontend Next.js (dashboard GeoForest Trace + routes API /api/v1 persistées en PostgreSQL)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# DATABASE_URL factice au build : les routes sont dynamiques, aucune connexion n'est ouverte à la compilation.
ENV DATABASE_URL=postgresql://postgres:postgres@db:5432/app_db
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle.config.json /app/next.config.ts /app/tsconfig.json ./
EXPOSE 3000
# Applique le schéma Drizzle puis démarre le serveur
CMD ["sh", "-c", "npx drizzle-kit push --force && npm run start"]
