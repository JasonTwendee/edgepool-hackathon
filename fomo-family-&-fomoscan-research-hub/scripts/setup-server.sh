#!/usr/bin/env bash
# One-time setup for the company Ubuntu box (run ON the server as a sudo user).
# Installs: Docker + compose plugin, Node 22 (for CI asserts), ufw rules,
# /opt/edgepool checkout dirs. Safe to re-run (idempotent-ish).
set -euo pipefail

APP_DIR="${APP_DIR:-/home/jason/Downloads/twendee/edgepool-hackathon}"
REPO_SSH="${REPO_SSH:-git@github.com:JasonTwendee/edgepool-hackathon.git}"

echo "==> 1/5 Docker"
if ! command -v docker >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi
docker --version
docker compose version

echo "==> 2/5 Node 22 (CI asserts run on the runner)"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

echo "==> 3/5 Firewall (22 ssh, 80/443 web — adjust to your policy)"
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw --force enable || true

echo "==> 4/5 Code checkout -> $APP_DIR"
sudo mkdir -p /opt/edgepool
sudo chown "$USER:$USER" /opt/edgepool
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_SSH" "$APP_DIR"
fi

echo "==> 5/5 Env templates (YOU fill secrets next — files stay on server, never committed)"
PROJ="$APP_DIR/fomo-family-&-fomoscan-research-hub"
[ -f "$PROJ/backend/.env" ] || cp "$PROJ/backend/.env.example" "$PROJ/backend/.env"
[ -f "$PROJ/frontend/.env" ] || cp "$PROJ/frontend/.env.example" "$PROJ/frontend/.env"
chmod 600 "$PROJ/backend/.env" "$PROJ/frontend/.env" || true

echo "OK. Next:"
echo "  1) nano $PROJ/backend/.env   # fill secrets (see docs/setup/OPERATOR.md)"
echo "  2) Register self-hosted runner below (GitHub repo Settings > Actions > Runners)"
echo "  3) docker compose up: cd $PROJ && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
