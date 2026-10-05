# syntax=docker/dockerfile:1
# BE image — build context là ROOT (xem docker-compose.yml), vì backend/tsconfig.json extends ../tsconfig.json.
# Phase 1: không refactor src/**, SyncService ở yên trong API.

FROM node:22-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY tsconfig.json /app/tsconfig.json
COPY backend/package.json backend/package-lock.json backend/tsconfig.json backend/tsconfig.build.json backend/prisma.config.ts ./
COPY backend/prisma ./prisma
COPY backend/src ./src
# Prisma 7 client output về src/generated/prisma (xem schema.prisma) — generate trước build để tsc thấy types.
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app/backend
ENV NODE_ENV=production
RUN apk add --no-cache openssl wget
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/src/generated ./src/generated
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
COPY backend/docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
