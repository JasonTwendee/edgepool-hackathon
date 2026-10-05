#!/usr/bin/env bash
# Sync missing keys from a committed .env.example into a live .env (server-side).
# NEVER overwrites existing values — only APPENDS keys absent from the target.
# Run on every deploy so new code keys appear automatically (empty/default value,
# operator fills secrets once). Idempotent.
#
# Usage: scripts/sync-env.sh <example> <target>
#   e.g. scripts/sync-env.sh backend/.env.example backend/.env
set -euo pipefail

EXAMPLE="${1:?usage: sync-env.sh <example> <target>}"
TARGET="${2:?usage: sync-env.sh <example> <target>}"
[ -f "$EXAMPLE" ] || { echo "missing example: $EXAMPLE"; exit 1; }
[ -f "$TARGET" ] || { echo "missing target (run setup-server.sh first): $TARGET"; exit 1; }

added=0
# Collect existing keys (KEY=... or `export KEY=...`, ignore comments).
existing=$(grep -oP '^\s*(?:export\s+)?\K[A-Z0-9_]+(?==)' "$TARGET" || true)

while IFS= read -r line; do
  # Match KEY=... lines (skip comments/blank).
  if [[ "$line" =~ ^[[:space:]]*([A-Za-z0-9_]+)= ]]; then
    key="${BASH_REMATCH[1]}"
    if ! grep -q "^${key}$" <<< "$existing"; then
      if [ "$added" -eq 0 ]; then
        echo "" >> "$TARGET"
        echo "# --- auto-added from $(basename "$EXAMPLE") on $(date -u +%F) (sync-env.sh) ---" >> "$TARGET"
      fi
      echo "$line" >> "$TARGET"
      echo "  + $key"
      added=$((added + 1))
      existing="${existing}"$'\n'"${key}"
    fi
  fi
done < "$EXAMPLE"

echo "sync-env: $added key(s) added to $TARGET"
