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

### 3.1. Danh Sách 10 Ví Master Theo Dõi Mặc Định (Từ FOMO)

| # | Master Handle | Tên hiển thị | Địa chỉ ví Solana On-Chain | PnL Lũy Kế ($) | Win Rate | Trạng Thái |
|:--|:---|:---|:---|:---|:---|:---|
| **1** | `@unipcs` | Unipcs | `FJDy9FDRy6bwGEUKuAC98bUtN8MkpE2pT7Dj7HE3Z7Q1` | +$11,438,928 | 78.5% | Tracking |
| **2** | `@frogmanhaha` | Frogman | `6iTD9vugv5xhrYSPZF1cGTLbSx8XPV1WdnDXxMPG2boP` | +$3,738,725 | 72.8% | Tracking |
| **3** | `@0xAvast` | Avast | `F69rpud3jENtWWfQBprczzEbwGGpEwsJNgE4GNn8SPiR` | +$3,209,912 | 74.1% | Tracking |
| **4** | `@PoorGoat_` | PoorGoat | `HXCYBexdXRrNTa3NHHJiKh5wsjb6zfW79MxQYGsszouu` | +$2,771,734 | 69.4% | Tracking |
| **5** | `@econoar` | eric.eth | `HZrxCXCms81ryxwvYNycwcPmynXmPgcKV4C2FeDJA86e` | +$1,547,433 | 66.2% | Tracking |
| **6** | `@bluntz_capital`| bluntz | `2r8Z99rdDQNuiGHBoK1bbfVvifiYUwofc8e7wUz7S7Qm` | +$988,076 | 67.5% | Tracking |
| **7** | `@Altcoinist` | Altcoinist | `Cu5hFXWAXcTkkpUwavv3P7eFw22GQCHTV32SSv2o7WSH` | +$632,849 | 65.0% | Tracking |
| **8** | `@0xstanczyk` | Stańczyk | `5GyNgAwe9kJQGDQ2yswCCgcwHo2brdAgENUEc5MMKeZm` | +$842,100 | 64.2% | Tracking |
| **9** | `@CeruleanRange`| rangevertical | `6TDerr3xpKiHUfXSSW8TjadASu5pGD6dsewigfCHFRAA` | +$590,400 | 63.8% | Tracking |
| **10**| `@Binkieee` | Binkieee | `5PVeHkHCodbNyF4M194zoWtMWbkCLKyNKWvG19ouMt3H` | +$1,850,000 | 71.0% | Tracking |

---

## 4. ĐẶC TẢ TÀI LIỆU API (API SPECIFICATION)

### 4.1. `GET /api/health`
Kiểm tra tình trạng hoạt động của Backend và kết nối RPC.

### 4.2. `GET /api/wallets`
Lấy danh sách tất cả các ví đang được hệ thống theo dõi.

### 4.3. `POST /api/wallets`
Đăng ký thêm một địa chỉ ví Solana mới vào danh sách lắng nghe on-chain.

### 4.4. `GET /api/portfolio/transactions`
Lấy danh sách giao dịch on-chain chuẩn: trả về 250 giao dịch (25 tx/ví x 10 ví).

### 4.5. `GET /api/onchain/stream` (Server-Sent Events)
Luồng stream thời gian thực đẩy các sự kiện giao dịch mới nhất tới Client.

---

## 5. HƯỚNG DẪN CÀI ĐẶT VÀ CHẠY LOCAL (LOCAL SETUP GUIDE)

### Bước 1: Yêu cầu môi trường
- Node.js phiên bản $\ge 18.0.0$
- Trình quản lý gói `npm` hoặc `pnpm`

### Bước 2: Thiết lập file môi trường `.env`
```bash
cp .env.example .env
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

Khi bạn muốn kích hoạt tính năng tự động sao chép lệnh:
1. **Ví Bot Ký Lệnh (Execution Keypair)**: Cấu hình ví phụ nạp 0.2 SOL để trả phí gas.
2. **Jito MEV Bundles**: Đóng gói lệnh vào Jito Bundle để chống sandwich 100%.
3. **Định Tuyến Thông Minh**: Phoenix CLOB (Orderbook) + Titan Meta-DEX (AMM Pools).
4. **Anchor Vault Contract**: Quản trị tài sản an toàn không ủy thác.
