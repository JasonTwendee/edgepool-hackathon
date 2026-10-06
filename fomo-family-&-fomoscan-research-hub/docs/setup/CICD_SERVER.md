# CI/CD + Deploy server (SSOT)

> File này là nguồn sự thật duy nhất cho deploy. Được trỏ tới từ
> `scripts/setup-server.sh`. Session mới: đọc file này trước, đừng đoán lệnh.

## 1. Bức tranh toàn cảnh

```text
laptop (/home/jason/Downloads/twendee/hackathon-solana)
  │  git push origin main
  ▼
GitHub Actions — CI `ci.yml` (ubuntu-latest, chạy trên cloud)
  │  xanh → workflow_run completed
  ▼
GitHub Actions — CD `deploy.yml` (self-hosted runner `edgepool` TRÊN server,
  runner dial OUT qua NAT cty nên không cần mở inbound SSH)
  │  rsync repo → DEPLOY_DIR (trừ .env) → sync-env → build + up → smoke
  ▼
Server Ubuntu: docker compose (prod overlay) → Caddy :80/:443 → FE :3001 → BE :3000
  ▼
Public: https://edgepool-dev.tailec308e.ts.net/ (Tailscale Funnel, URL cố định)
```

## 2. Server inventory

| Mục | Giá trị |
|---|---|
| SSH | `jason@100.110.155.108` qua Tailscale (`ssh -o StrictHostKeyChecking=no`) |
| `DEPLOY_DIR` | `/home/jason/Downloads/twendee/edgepool-hackathon` (mirror nguyên repo) |
| `PROJ_DIR` | `$DEPLOY_DIR/fomo-family-&-fomoscan-research-hub` (thư mục chạy compose) |
| Containers | `fomo-postgres` (healthy) · `fomo-backend` · `fomo-frontend` · `fomo-caddy` |
| Volumes | `fomo-postgres-data` (DB — cấm `down -v`), `fomo-caddy-data/config` |
| Server `.env` | `$PROJ_DIR/backend/.env` + `frontend/.env`, mode `600`, KHÔNG BAO GIỜ commit |
| Public URL | `https://edgepool-dev.tailec308e.ts.net/` (Funnel). LAN: `http://100.110.155.108/` |
| Runner label | `edgepool` (self-hosted, chạy job `deploy`) |
| Repo GitHub | `git@github.com:JasonTwendee/edgepool-hackathon.git` (SSH key `~/.ssh/id_ed25519_jason` trên laptop) |
| Nhánh | `main` = tích hợp+demo (luôn xanh) · `product` · `analyst` (xem `docs/setup/BRANCHING.md`) |

## 3. CI — `.github/workflows/ci.yml`

Chạy trên `push` vào `main|product|analyst` và PR vào `main`. Workdir:
`fomo-family-&-fomoscan-research-hub`. Steps theo thứ tự:

1. `npm ci` locked ở root + `backend` + `frontend` (lockfiles ĐƯỢC commit).
2. `npm run typecheck` (BE + FE).
3. OpenAPI valid: parse `docs/api/openapi.yaml`.
4. Env contract: `bash scripts/check-env-contract.sh` — mọi `process.env.X`
   trong code phải khai báo trong `.env.example` tương ứng.
5. Asserts: chạy mọi `backend/src/**/assert-*.ts` bằng `tsx` (mocked, không mạng).
6. `npm run build:frontend` (FE build phải xanh).

Chỉ khi CI của `main` xanh thì CD auto mới chạy.

## 4. CD — `.github/workflows/deploy.yml`

- Trigger: `workflow_run(ci, completed, main)` + `conclusion == success`,
  hoặc `workflow_dispatch` (chạy tay, luôn cho phép).
- `concurrency: deploy-main`, `cancel-in-progress: false` (deploy nối đuôi, không cắt nhau).
- Steps (chạy TRÊN server qua runner):
  1. `actions/checkout` vào `repo/` bằng ephemeral token
     (server không cần GitHub credentials).
  2. `rsync -a --delete --exclude backend/.env --exclude frontend/.env
     --exclude node_modules --exclude .next repo/ $DEPLOY_DIR/`
     → `.env` server được giữ nguyên.
  3. `sync-env.sh` cho BE + FE: chỉ APPEND key thiếu từ `.env.example`,
     không overwrite giá trị live.
  4. `docker compose -f docker-compose.yml -f docker-compose.prod.yml build backend frontend`
     rồi `up -d`.
  5. Smoke fail-deploy-nếu-đỏ: `curl -sf :3000/api/health`,
     `curl -sf :3001/` (10s sau up).
  6. TryCloudflare tunnel: CHỈ khi repo var `TUNNEL_ENABLED == 'true'`
     (mặc định TẮT — quick-tunnel đã bỏ, public đi Funnel cố định).

Prod overlay (`docker-compose.prod.yml`): chặn port host của BE/FE
(single-entry qua Caddy), `DATABASE_URL` prod lấy từ `backend/.env` server.

## 5. Env contract (3 file phối hợp)

- `.env.example` (được commit) = SSOT: thêm biến môi trường mới → bắt buộc
  thêm vào example trước, nếu không CI `check-env-contract.sh` đỏ.
- `scripts/check-env-contract.sh` = CI gate (chặn thiếu khai báo).
- `scripts/sync-env.sh <example> <target>` = CD propagator (append key mới
  vào `.env` server, giữ secrets cũ). Idempotent, chạy mỗi deploy.

## 6. Deploy thủ công qua SSH (fallback khi runner chết)

Dùng đúng lệnh CD làm (đừng tự chế biến thể):

```bash
# 1. Từ laptop: đồng bộ code (giữ .env server, bỏ build artifacts + git)
rsync -az --delete \
  --exclude 'backend/.env' --exclude 'frontend/.env' \
  --exclude 'node_modules' --exclude '.next' --exclude '.git' \
  -e "ssh -o StrictHostKeyChecking=no" \
  /home/jason/Downloads/twendee/hackathon-solana/ \
  jason@100.110.155.108:/home/jason/Downloads/twendee/edgepool-hackathon/

# 2. Verify file đã sang (rsync TỪNG im lặng bỏ file — kiểm tra 2 lần cũng rẻ):
ssh -o StrictHostKeyChecking=no jason@100.110.155.108 \
  'P="/home/jason/Downloads/twendee/edgepool-hackathon/fomo-family-&-fomoscan-research-hub"; \
   cd "$P" && grep -c "<marker-vừa-đổi>" <file-vừa-sửa> && ls frontend/app/pools/'

# 3. Trên server: sync env + rebuild + up (prod overlay)
ssh -o StrictHostKeyChecking=no jason@100.110.155.108 \
  'P="/home/jason/Downloads/twendee/edgepool-hackathon/fomo-family-&-fomoscan-research-hub"; \
   cd "$P" && bash scripts/sync-env.sh backend/.env.example backend/.env \
   && bash scripts/sync-env.sh frontend/.env.example frontend/.env \
   && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend frontend'

# 4. Smoke (đợi ~60s cho FE build/start), rồi check public:
curl -s -o /dev/null -w "pool %{http_code}\n" --max-time 30 \
  "https://edgepool-dev.tailec308e.ts.net/"
curl -s -o /dev/null -w "terminal %{http_code}\n" --max-time 30 \
  "https://edgepool-dev.tailec308e.ts.net/terminal"
curl -s --max-time 30 "https://edgepool-dev.tailec308e.ts.net/api/vaults/pools" \
  | python3 -c "import json,sys; print('pools:', len(json.load(sys.stdin)['data']))"
```

## 7. Gotchas (đã trả giá — đừng tái phạm)

1. `docker compose restart` KHÔNG đọc lại `env_file` → đổi `.env` phải
   `up -d <service>` để recreate container.
2. CẤM `docker compose down -v` trên server (xóa volume `fomo-postgres-data`
   = mất DB). `down` thường thì giữ data.
3. Rsync từng im lặng drop file (2 lần) → luôn grep-verify sau rsync.
   Runner auto-deploy có thể chạy đè SAU rsync tay (queue `deploy-main`
   không cancel) → sau rsync luôn check mtime/content trên server
   (đã gặp 1 lần 2026-10-06: file server cũ hơn local sau RSYNC_OK).
4. Boot sync: mỗi restart BE chạy lại boot sync — gom fix thành 1 deploy duy nhất.
5. Funnel URL cố định (`edgepool-dev…`); trycloudflare ephemeral đã bỏ.
6. FomoScan sponsor plan: batch PnL POST 403 với >1 handle → dùng single GETs
   (client tự throttle ≥1.1s); leaderboard limit 100.
7. Seeded logins + API keys SỐNG trong server `.env` (mode 600) — không paste
   vào doc/chat/log.

## 8. Rollback

```bash
# Trên server: về commit xanh gần nhất rồi up lại (giữ .env + volume)
ssh -o StrictHostKeyChecking=no jason@100.110.155.108 \
  'cd /home/jason/Downloads/twendee/edgepool-hackathon && \
   git log --oneline -3 && git stash list && \
   P="fomo-family-&-fomoscan-research-hub" && cd "$P" && \
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend frontend'
# Lưu ý: DEPLOY_DIR là mirror rsync, không phải checkout git tin cậy —
# cách chắc chắn: rsync lại từ laptop ở commit cũ (git checkout <sha> → rsync → up).
```

Backup DB trước deploy rủi ro:

```bash
docker run --rm -v fomo-postgres-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/pg-$(date +%F).tar.gz /data
```

## 9. Setup server mới (one-time)

```bash
# Trên server, user sudo:
APP_DIR=/home/jason/Downloads/twendee/edgepool-hackathon \
  bash fomo-family-\&-fomoscan-research-hub/scripts/setup-server.sh
# Rồi: 1) nano backend/.env (điền secrets)  2) đăng ký runner label `edgepool`
# (GitHub repo Settings > Actions > Runners)  3) compose up như §6 bước 3.
```

## 10. Checklist trước merge vào `main`

`npm run typecheck` xanh · asserts liên quan GREEN · `check-env-contract` xanh
(nếu thêm env) · smoke live matrix (`/`, `/pools/1`, `/terminal`, `/trader` 200)
· tracker/telemetry cập nhật · reviewer APPROVE.
Chi tiết branching: `docs/setup/BRANCHING.md`.
