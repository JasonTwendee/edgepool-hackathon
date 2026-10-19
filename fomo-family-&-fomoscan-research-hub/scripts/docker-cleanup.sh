#!/usr/bin/env bash
# Safe Docker cleanup for deploy servers (edgepool-dev, AWS mới).
# Chạy sau mỗi deploy + cron tuần. KHÔNG BAO GIỜ động vào volumes (DB sống ở đó).
# - image prune -a: xóa ảnh cũ không còn container nào dùng (kể cả :main cũ),
#   ảnh đang chạy LUÔN được giữ. until=KEEP để lỡ rollback còn ảnh gần nhất.
# - builder prune: xóa build cache (server pull-only thì gần như không có).
# - container/network prune: dọn xác container đã stop, network thừa.
# CẤM thêm `volume prune` vào đây — mất fomo-postgres-data = mất DB.
set -euo pipefail

KEEP="${KEEP:-168h}" # giữ ảnh dùng trong 7 ngày gần nhất

echo "--- docker disk before ---"
docker system df

docker container prune -f
docker image prune -af --filter "until=${KEEP}" || true
docker builder prune -af --filter "until=${KEEP}" || true
docker network prune -f || true

echo "--- docker disk after ---"
docker system df
