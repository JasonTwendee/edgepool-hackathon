#!/bin/sh
set -e
# Entrypoint BE: migrate DB rồi mới boot API. Idempotent — chạy lại an toàn.
# DATABASE_URL (nếu set) thắng POSTGRES_* ở cả Prisma CLI lẫn runtime adapter.
echo "[entrypoint] running prisma migrate deploy..."
npx prisma migrate deploy
echo "[entrypoint] starting API..."
exec node dist/main.js
