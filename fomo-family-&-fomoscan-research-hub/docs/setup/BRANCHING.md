# Branching — product vs analyst

- `main`: nhánh tích hợp + demo. Luôn xanh, luôn chạy được (`compose up`).
- `product`: line phát triển nhánh Product (tiền: vault on-chain, execution,
  payout, custody). Runbook: `docs/setup/LAUNCH_RUNBOOK_PRODUCT.md`.
- `analyst`: line phát triển nhánh Analyst (dữ liệu + tín hiệu + UX/API).
  Runbook: `docs/setup/LAUNCH_RUNBOOK_ANALYST.md`.

## Hướng merge (bắt buộc)

- Feature → nhánh track của nó (`product` hoặc `analyst`) → PR vào `main`.
- KHÔNG merge trực tiếp feature vào `main` nếu chạm code track.
- KHÔNG merge `product` ↔ `analyst` với nhau. Chỉ merge vào `main`.
- Giữ track khỏi drift: mỗi tuần merge `main` vào track đang làm
  (`git merge main`), giải conflict ngay, không để dồn.

## Nếu 2 track sửa cùng file shared

Shared paths (đụng là phải báo): `auth/**`, `users/**`, `audit/**`,
`config/*`, `openapi.yaml`, `prisma/schema.prisma`, `frontend/lib/api.ts`.
Sửa shared trên track nào thì PR vào `main` trước, track còn lại merge `main`
về rồi mới tiếp tục.

## Kiểm tra trước khi merge vào main

- `npm run typecheck` (BE+FE) xanh · asserts liên quan GREEN · smoke live matrix
- Reviewer APPROVE · tracker/telemetry cập nhật
