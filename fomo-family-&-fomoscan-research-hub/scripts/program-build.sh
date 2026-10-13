#!/usr/bin/env bash
# Build SBF program với arch v2 — bắt buộc cho test harness LiteSVM 0.7
# (loader solana 2.3 chỉ hỗ trợ ≤ v2; devnet/mainnet Agave 4.x vẫn chạy v2 bình thường).
# Dùng script này thay cho `anchor build` trần trong mọi phase.
#
# Lưu ý: `anchor build -- --arch v2` sẽ phun args vào cả bước host-build IDL
# (cargo test) và hỏng IDL — nên tách 2 bước: SBF (--no-idl, có arch) rồi IDL.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

anchor build --no-idl -- --arch v2
anchor idl build
cp target/idl/edgepool_vault.json idls/edgepool_vault.json

ARCH_FLAGS=$(readelf -h target/deploy/edgepool_vault.so | grep -i flags | awk '{print $NF}')
echo "OK: target/deploy/edgepool_vault.so (ELF flags ${ARCH_FLAGS}) + idls/edgepool_vault.json"
