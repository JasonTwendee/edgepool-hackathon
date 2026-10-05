#!/usr/bin/env bash
# Contract check (runs in CI): every process.env.X read in code MUST be declared
# in the matching .env.example. Forces devs to update the example (SSOT) whenever
# they add a new env read — deploy sync-env.sh then propagates it to servers.
# Extra keys in the example (compose-set, legacy) are allowed.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
check() {
  local tree="$1" example="$2"
  local reads keys missing
  reads=$(grep -rhoP 'process\.env\.\K[A-Z0-9_]+' "$tree" --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=generated 2>/dev/null | sort -u || true)
  keys=$(grep -oP '^[A-Z0-9_]+(?==)' "$example" | sort -u)
  missing=""
  for k in $reads; do
    if ! grep -qx "$k" <<< "$keys"; then
      missing="${missing} $k"
    fi
  done
  if [ -n "$missing" ]; then
    echo "MISSING from $example:$missing"
    fail=1
  else
    echo "OK: $example covers $(echo "$reads" | wc -w) env reads"
  fi
}

check "backend" "backend/.env.example"
check "frontend" "frontend/.env.example"
exit $fail
