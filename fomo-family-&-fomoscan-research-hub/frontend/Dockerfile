# syntax=docker/dockerfile:1
# FE image — build context là ROOT (xem docker-compose.yml), vì frontend/tsconfig.json extends ../tsconfig.json.
# BACKEND_URL là DNS nội bộ compose (http://backend:3000), đọc lúc runtime qua next.config.ts rewrites.

FROM node:22-alpine AS deps
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app/frontend
COPY --from=deps /app/frontend/node_modules ./node_modules
COPY tsconfig.json /app/tsconfig.json
COPY frontend/package.json frontend/package-lock.json frontend/tsconfig.json ./
COPY frontend/next.config.ts frontend/postcss.config.mjs frontend/globals.css frontend/next-env.d.ts ./
COPY frontend/app ./app
COPY frontend/components ./components
COPY frontend/hooks ./hooks
COPY frontend/lib ./lib
COPY frontend/types ./types
COPY frontend/styles ./styles
COPY frontend/public ./public
ARG BACKEND_URL=http://backend:3000
ENV BACKEND_URL=${BACKEND_URL}
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Next parser không resolve `extends: ../tsconfig.json` trong Docker context —
# flatten thành 1 file self-contained lúc build (không sửa repo).
RUN node -e "const fs=require('fs');const base=JSON.parse(fs.readFileSync('/app/tsconfig.json','utf8'));const ext=JSON.parse(fs.readFileSync('./tsconfig.json','utf8'));const merged={...base,...ext,compilerOptions:{...base.compilerOptions,...ext.compilerOptions}};delete merged.extends;fs.writeFileSync('./tsconfig.json',JSON.stringify(merged,null,2));console.log('tsconfig flattened for docker build');"
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app/frontend
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache wget \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /root/.npm /tmp/* /var/cache/apk/*
# Standalone: chỉ copy file trace + static, không ôm cả node_modules (~200MB thay vì ~570MB).
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./.next/static
COPY --from=builder /app/frontend/public ./public

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=30s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["node", "server.js"]
