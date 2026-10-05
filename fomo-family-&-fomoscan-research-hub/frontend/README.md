# Frontend — Next.js App Router runtime (`fomo-frontend`)

Next.js 16 (Turbopack) + React 19 + Tailwind CSS v4. Dev split: FE `:3001`
proxy `/api/*` về BE `:3000` nên `lib/api.ts` giữ base same-origin `''`.

## Layout

```
frontend/
  app/
    layout.tsx   root layout (Metadata API, theme)
    page.tsx     `/` — tracker dashboard (sidebar + trader profile, live SSE)
  components/    WalletSidebar, TraderProfile, SwapsTable, PnlChart, WalletAvatar
  lib/
    api.ts       typed REST client (khớp docs/api/openapi.yaml)
    sse.ts       EventSource SSE client
    format.ts    time/USD/signature formatting
  hooks/
    useOnchainStream.ts   live prepend for the selected wallet
    usePortfolio.ts       25-tx ledger, follows selected wallet
  types/
    onchain.ts   TrackedWallet + OnChainTransactionEvent (mirror BE)
  public/        static serve (/vault_system_design_specification.html, /SYSTEM_DOCUMENTATION.md)
  globals.css    fonts + tailwind
  next.config.ts rewrites /api → BACKEND_URL (default http://localhost:3000)
  .env.example   NEXT_PUBLIC_API_URL (để trống = same-origin), BACKEND_URL
```

## Chạy

```bash
cd frontend
npm install
npm run dev        # next dev -p 3001 (cần BE chạy ở :3000 cho /api)
npm run typecheck  # tsc --noEmit -p tsconfig.json
npm run build      # next build (đã verify xanh)
```

## Quy ước

- `app/` chỉ routing; UI tái dùng ở `components/`; fetch ở `lib/`; shape ở `types/`.
- Không import từ `backend/`; contract duy nhất qua `docs/api/openapi.yaml` + `lib/api.ts`.
- Fonts load bằng CSS `@import` trong `globals.css` (không dùng `<head>` thủ công trong
  layout, không dùng `next/font` để tránh phụ thuộc network lúc build).
- Deploy cross-origin thật mới set `NEXT_PUBLIC_API_URL`; mặc định dùng rewrites.
