# Frontend Next.js (dashboard GeoForest Trace + routes API /api/v1 persistées en PostgreSQL)
# Aligné sur `.nvmrc` et CI (Node 22).
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Aucune URL de base ni identifiant dans l'image : le pool d'administration est
# différé et aucune connexion SQL n'est ouverte à la compilation.
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/drizzle.config.ts /app/next.config.ts /app/tsconfig.json ./
COPY --from=builder --chown=node:node /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=builder --chown=node:node /app/scripts/sql/post-migrate ./scripts/sql/post-migrate

RUN mkdir -p /app/var/storage /app/var/alertes && chown -R node:node /app/var

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Ne jamais exécuter `drizzle-kit push` au démarrage : les migrations versionnées
# et les scripts post-migrate (RLS, privilèges, journal d'audit) se jouent via
# `npm run db:migrate` dans une étape dédiée avec `DATABASE_URL_ADMIN`.
CMD ["npm", "run", "start"]
