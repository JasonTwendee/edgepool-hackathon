# TÀI LIỆU THIẾT KẾ HỆ THỐNG: REAL-TIME ON-CHAIN WALLET TRACKER & TRANSACTION INTELLIGENCE
> **Dự Án**: Hệ Thống Theo Dõi Thông Tin Giao Dịch Ví Thời Gian Thực (Solana Mainnet)  
> **Kiến Trúc**: Full-Stack Node.js (Express + @solana/web3.js) + React (TypeScript + Tailwind CSS)  
> **Phiên Bản**: v1.0.0 (Production-Ready)  
> **Ngày Lập**: Tháng 09/2026  

---

## 1. TỔNG QUAN HỆ THỐNG (SYSTEM OVERVIEW)

### 1.1. Mục Tiêu Cốt Lõi (Core Purpose)
Hệ thống được thiết kế chuyên biệt để **theo dõi và phân tích giao dịch on-chain thời gian thực (Real-Time)** của các ví cá voi (Whale Wallets) và Top Master Traders từ hệ sinh thái `fomo.family` và Solana Mainnet:
- **Lắng nghe trực tiếp trên Blockchain (On-Chain Listening)**: Bắt các sự kiện swap, chuyển tiền, giao dịch mới nhất mà không phụ thuộc vào dữ liệu trễ của bên thứ ba.
- **Sổ cái 250 Giao dịch chuẩn (Standard Transaction Ledger)**: Lưu trữ và hiển thị 25 giao dịch gần nhất cho mỗi tài khoản (10 tài khoản $\times$ 25 = 250 giao dịch), đồng bộ từ thời điểm hiện tại ngược về trước.
- **Trích xuất chữ ký chuẩn xác (Full 88-char Base58 Signatures)**: Cung cấp đầy đủ mã băm giao dịch (Tx Hash), slot block, thời gian thực, cặp token (`$SOL`, `$WIF`, `$POPCAT`, `$MEW`, `$BONK`), khối lượng USD, sàn khớp (Phoenix CLOB, Titan Meta-DEX, Raydium, Orca).
- **Hỗ trợ thêm ví động (Dynamic Wallet Tracking)**: Người dùng có thể nhập bất kỳ địa chỉ ví Solana nào từ giao diện để Backend bắt đầu theo dõi ngay lập tức.
- **Tách bạch module (Modular Design)**: Tập trung 100% vào tính năng theo dõi & phân tích giao dịch on-chain; module tự động thực thi sao chép (Copy-Trade Execution) được đóng gói sẵn dưới dạng module mở rộng để kích hoạt sau.

---

## 2. KIẾN TRÚC TỔNG THỂ (SYSTEM ARCHITECTURE)

```
                    ┌────────────────────────────────────────┐
                    │          SOLANA MAINNET-BETA           │
                    │   (Validators, Blocks, Transactions)   │
                    └───────────────────┬────────────────────┘
                                        │
                         RPC JSON-RPC / WebSocket Stream
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                             BACKEND ENGINE                                 │
│  [server.ts + src/server/solanaService.ts]                                 │
│                                                                            │
│  1. Connection Manager:                                                    │
│     - Kết nối Solana Web3 Connection ('confirmed')                         │
│     - Quản lý Rate-Limit & Fallback High-Fidelity Records                  │
│                                                                            │
│  2. On-Chain Event Listener:                                               │
│     - Vòng lặp quét: getSignaturesForAddress(pubkey, { until: lastSig })   │
│     - Lọc và phân tích swap: Token in/out, Amount USD, Venue, Slippage     │
│                                                                            │
│  3. Real-Time Streaming Server:                                            │
│     - Server-Sent Events (SSE) stream: GET /api/onchain/stream             │
│     - Phát thông báo tức thì khi ví theo dõi phát sinh swap                │
│                                                                            │
│  4. RESTful API Server (Express):                                          │
│     - GET  /api/health                  (Trạng thái hệ thống & RPC)        │
│     - GET  /api/wallets                 (Danh sách ví đang theo dõi)       │
│     - POST /api/wallets                 (Thêm địa chỉ ví mới để lắng nghe) │
│     - GET  /api/portfolio/transactions  (250 Tx chuẩn: 25 Tx/ví x 10 ví)   │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        │
                         HTTP REST API / SSE Event Stream
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                             FRONTEND CLIENT                                │
│  [React 19 + TypeScript + Tailwind CSS]                                    │
│                                                                            │
│  1. Live On-Chain Status Bar: Hiển thị trạng thái RPC, SSE, số ví theo dõi │
│  2. SSE Toast Notification: Alert tức thì khi có giao dịch mới vừa phát sinh│
│  3. Sổ 250 Giao Dịch Chuẩn: Phân trang 10 trang x 25 Tx, bộ lọc theo ví    │
│  4. Bộ Công Cụ Thao Tác: Copy Tx Hash 88 ký tự 1-chạm, liên kết Solscan    │
│  5. Form Đăng Ký Ví Mới: Nhập ví Solana Base58 để Backend lắng nghe ngay    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. CHI TIẾT CÁC THÀNH PHẦN BACKEND (BACKEND SPECIFICATION)

### 3.1. Danh Sách 10 Ví Master Theo Dõi Mặc Định (Từ FOMO Leaderboard, cập nhật 2026-09-29)

| # | Master Handle | Tên hiển thị | Địa chỉ ví Solana On-Chain | PnL Lũy Kế ($) | Trạng Thái |
|:--|:---|:---|:---|:---|:---|
| **1** | `@unipcs` | Unipcs | `FJDy9FDRy6bwGEUKuAC98bUtN8MkpE2pT7Dj7HE3Z7Q1` | +$11,416,891.98 | Tracking |
| **2** | `@pointfarmcap` | point farm capital | `6cerGpSGzCrA1NeHUNtyoNm4rWQx5SnK3DSAXb4e615t` | +$7,351,168.45 | Tracking |
| **3** | `@DumbCrayonEater` | DumbCrayonEater | `43nktK56Bfk3yJK9iqr3Kzyt9npgEB6sPYKAeoYMxeug` | +$6,778,978.64 | Tracking |
| **4** | `@The__Solstice` | TheS◎Lstice | `GmfY52CC5BKt43xt9GSmZWNzsAv4ywE6qgguRM5fvAtN` | +$5,351,697.67 | Tracking |
| **5** | `@Salem1299534` | Salem | `CDY1JBoi2fKPPsHabyANmp6RP9Lkz8TcrkACsX3rHkka` | +$5,312,719.03 | Tracking |
| **6** | `@theveeman` | Vee | `EYveLtK4M3PsNnzH6zAGQgLnCGb2CqFqkKnEoNtRirDX` | +$4,710,812.68 | Tracking |
| **7** | `@AvgJoesCrypto` | AJC | `5zVedvk9ffJKwaoueQWKEAAAa1nutXKhaqmFxzwmvVkW` | +$4,227,970.78 | Tracking |
| **8** | `@frankdegods` | frank 🎒 | `A5SEXYJY4jTEi6sjMLfZs5KAP8SVFvLDPDV67GgSSZSk` | +$3,822,514.81 | Tracking |
| **9** | `@Natan_benish` | Nate | `GGHTozducaoSUh9TZLKJcZR4hAFETcsqJBokvW9mW5u9` | +$3,746,813.69 | Tracking |
| **10** | `@frogmanhaha` | Frogman | `6iTD9vugv5xhrYSPZF1cGTLbSx8XPV1WdnDXxMPG2boP` | +$3,686,064.48 | Tracking |

> PnL = FOMO all-time totalPnL (seed), Win Rate recompute từ cặp buy→sell thật
> (`GET /api/portfolio/pnl`). Danh sách cũ (Avast, PoorGoat, eric.eth, bluntz,
> Altcoinist, Stańczyk, rangevertical, Binkieee) đã thay thế vì địa chỉ stale —
> RPC trả về 0 history.

---

### 3.2. Cơ Chế Lắng Nghe Sự Kiện On-Chain (`src/server/solanaService.ts`)

Service khởi tạo kết nối `@solana/web3.js` tới RPC:
```typescript
import { Connection, PublicKey } from '@solana/web3.js';

export class SolanaOnChainListenerService {
  private connection: Connection;
  private trackedWallets: Map<string, TrackedWallet> = new Map();
  private lastSignatures: Map<string, string> = new Map();
  private pollIntervalMs: number = 8000;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }
}
```

#### Vòng lặp quét sự kiện (`pollWalletsForNewEvents`):
1. Lấy danh sách ví đang theo dõi.
2. Với mỗi ví, truy vấn chữ ký mới nhất kể từ lần quét trước:
   ```typescript
   const sigs = await this.connection.getSignaturesForAddress(pubkey, {
     limit: 3,
     until: lastSig
   });
   ```
3. Nếu phát hiện chữ ký mới, cập nhật `lastSignatures` và giải mã giao dịch thành `OnChainTransactionEvent`.
4. Phát sự kiện tới các Client đang kết nối qua kênh Server-Sent Events (SSE).

---

### 3.3. Dữ Liệu 250 Giao Dịch Chuẩn Portfolio

Hàm `getPortfolioTransactions(targetWallet?: string, limitPerWallet: number = 25)`:
- Nếu gọi không có tham số hoặc `targetWallet="ALL"`: Duyệt qua tất cả **10 ví**, lấy đúng **25 giao dịch thật gần nhất** của từng ví $\rightarrow$ Tổng cộng đúng **250 giao dịch**.
- Nếu gọi kèm `targetWallet="<SolanaAddress>"`: Trả về chính xác **25 giao dịch** của riêng ví đó.
- Dữ liệu được sắp xếp giảm dần theo thời gian (`blockTime` và `slot number`).

---

## 4. ĐẶC TẢ TÀI LIỆU API (API SPECIFICATION)

### 4.1. `GET /api/health`
Kiểm tra tình trạng hoạt động của Backend và kết nối RPC.

**Response (200 OK):**
```json
{
  "status": "ONLINE",
  "service": "FOMO-Wallet-Tracker-OnChain-Engine",
  "rpcEndpoint": "https://api.mainnet-beta.solana.com",
  "heliusEnabled": false,
  "activeWalletsCount": 10,
  "timestamp": "2026-09-29T07:45:00.000Z"
}
```

---

### 4.2. `GET /api/wallets`
Lấy danh sách tất cả các ví đang được hệ thống theo dõi.

**Response (200 OK):**
```json
{
  "success": true,
  "total": 10,
  "data": [
    {
      "address": "FJDy9FDRy6bwGEUKuAC98bUtN8MkpE2pT7Dj7HE3Z7Q1",
      "label": "Unipcs",
      "handle": "unipcs",
      "avatar": "https://prod-fomo-profile-pics.s3.amazonaws.com/...",
      "totalPnlUsd": 11438928.79,
      "winRate": 78.5,
      "isCopyEnabled": true,
      "allocationWeight": 2.0,
      "addedAt": "2026-09-29"
    }
  ]
}
```

---

### 4.3. `POST /api/wallets`
Đăng ký thêm một địa chỉ ví Solana mới vào danh sách lắng nghe on-chain.

**Request Body:**
```json
{
  "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "label": "My Whale Alpha",
  "allocationWeight": 1.5
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Đã kích hoạt lắng nghe on-chain thành công cho ví 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "data": {
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "label": "My Whale Alpha",
    "handle": "7xKXtg",
    "isCopyEnabled": true,
    "allocationWeight": 1.5,
    "addedAt": "2026-09-29"
  }
}
```

---

### 4.4. `GET /api/portfolio/transactions`
Lấy danh sách giao dịch on-chain chuẩn.

**Query Parameters:**
- `wallet` (optional): Địa chỉ ví Solana cụ thể (nếu bỏ trống hoặc bằng `ALL`, trả về toàn bộ 250 giao dịch của 10 ví).
- `limit` (optional, default: 25): Số lượng giao dịch tối đa cho mỗi ví.

**Response (200 OK):**
```json
{
  "success": true,
  "total": 250,
  "walletsCount": 10,
  "perWalletLimit": 25,
  "asOf": "2026-09-29T07:45:00.000Z",
  "data": [
    {
      "signature": "4G9k2zLp8vQmNx7rTy5uWb3cE8aD1rT7oW2eY4uI9oPsLm8wVqN6yFzP3uHcE8aD1rT7oW2eY4uI9oP3aZbC99Po",
      "slot": 289108390,
      "blockTime": 1790667900,
      "formattedTime": "14:45:00 29/09/2026",
      "wallet": "FJDy9FDRy6bwGEUKuAC98bUtN8MkpE2pT7Dj7HE3Z7Q1",
      "walletName": "@unipcs (Unipcs)",
      "action": "BUY",
      "symbol": "$WIF",
      "amountUsd": 28400,
      "dexVenue": "Phoenix CLOB",
      "slippageBps: 8,
      "status": "SUCCESS",
      "feeSol": 0.000005
    }
  ]
}
```

---

### 4.5. `GET /api/onchain/stream` (Server-Sent Events)
Luồng stream thời gian thực đẩy các sự kiện giao dịch mới nhất tới Client.

**Event Format:**
```
data: {"type":"CONNECTED","message":"SSE Stream Active - Listening to Solana on-chain swaps","timestamp":1790667900000}

data: {"type":"ONCHAIN_SWAP_EVENT","event":{"signature":"5K2p9wRxJt4B8sLmVqN6yFzP3uHcE8aD1rT7oW2eY4uI9oPsLm8wVqN6yFzP3uHcE8aD1rT7oW2eY4uI9oP11Aa","walletName":"@unipcs (Unipcs)","action":"BUY","symbol":"$POPCAT","amountUsd":18500,"dexVenue":"Titan Meta-DEX"}}
```

---

## 5. HƯỚNG DẪN CÀI ĐẶT VÀ CHẠY LOCAL (LOCAL SETUP GUIDE)

### Bước 1: Yêu cầu môi trường
- Node.js phiên bản $\ge 18.0.0$
- Trình quản lý gói `npm` hoặc `pnpm`

### Bước 2: Thiết lập file môi trường `.env`
Sao chép file `.env.example` thành `.env`:
```bash
cp .env.example .env
```

Nội dung cấu hình trong file `.env`:
```env
# 1. URL của ứng dụng
APP_URL="http://localhost:3000"

# 2. Solana RPC Endpoint
# Bạn có thể dùng RPC miễn phí của Solana hoặc RPC tốc độ cao (Helius, QuickNode, Triton)
SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"

# 3. (Tùy chọn) Helius API Key để giải mã swap chi tiết
HELIUS_API_KEY=""

# 4. Port server (Mặc định: 3000)
PORT=3000
```

### Bước 3: Cài đặt thư viện và khởi động
```bash
# Cài đặt toàn bộ dependencies
npm install

# Khởi chạy full-stack ở chế độ phát triển (Express BE + Vite React FE)
npm run dev
```
Truy cập trình duyệt tại địa chỉ: `http://localhost:3000`.

### Bước 4: Kiểm thử Backend qua cURL
```bash
# 1. Kiểm tra trạng thái server
curl -s http://localhost:3000/api/health

# 2. Lấy danh sách 250 giao dịch
curl -s http://localhost:3000/api/portfolio/transactions | grep -o '"total":[0-9]*'

# 3. Thêm ví mới để theo dõi
curl -X POST http://localhost:3000/api/wallets \
  -H "Content-Type: application/json" \
  -d '{"address":"FJDy9FDRy6bwGEUKuAC98bUtN8MkpE2pT7Dj7HE3Z7Q1","label":"Alpha Whale"}'
```

---

## 6. LỘ TRÌNH NÂNG CẤP COPY TRADE (KHI BẠN SẴN SÀNG TRIỂN KHAI)

Khi bạn muốn mở rộng từ **hệ thống theo dõi** sang **hệ thống tự động sao chép lệnh (Automated Copy Trading)**, kiến trúc đã được thiết kế sẵn sàng để tích hợp các module sau:

1. **Ví Bot Ký Lệnh (Execution Keypair):**
   - Thiết lập một ví Solana phụ nạp sẵn ~0.2 SOL để trả phí gas.
   - Khi Backend nhận được `ONCHAIN_SWAP_EVENT`, ví bot sẽ ký và phát lệnh swap tương ứng.
2. **Bảo Vệ MEV Bằng Jito Bundle:**
   - Kết nối với `https://mainnet.block-engine.jito.wtf`.
   - Đóng gói lệnh swap vào **Jito Bundle** kèm khoản tip nhỏ (~0.001 SOL) để loại bỏ 100% rủi ro bị các bot khác kẹp sandwich.
3. **Định Tuyến Thông Minh (Titan & Phoenix):**
   - Lệnh mua SOL/WIF ưu tiên khớp qua **Phoenix CLOB** (Zero slippage, orderbook).
   - Lệnh mua memecoins thanh khoản phân tán ưu tiên định tuyến qua **Titan Meta-DEX** (Raydium, Meteora, Orca).
4. **Smart Contract Non-Custodial Vault (Solana Anchor):**
   - Người dùng nạp tiền vào Vault PDA. Ví bot chỉ có quyền swap token trong kho, không có quyền rút tiền ra ngoài.

---
*Tài liệu được biên soạn phục vụ phát triển kỹ thuật và bàn giao mã nguồn hoàn chỉnh.*
