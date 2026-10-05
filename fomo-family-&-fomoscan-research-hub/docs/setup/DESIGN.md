# FOMO SOCIAL TRADING TERMINAL — UI/UX MASTER DESIGN SPECIFICATION

> **Phiên bản**: 2.0.0 Production Master  
> **Mục tiêu**: Bản đặc tả thiết kế kỹ thuật UI/UX chi tiết 100% và khép kín (self-contained). Bất kỳ mô hình AI nào (GPT-4o, Claude 3.5/3.7, Gemini 2.0/3.0, DeepSeek, v.v.), Frontend Engineer hoặc UI Designer đều có thể đọc tài liệu này và tái lập chính xác 1:1 giao diện Web3 Social Trading Terminal của `fomo.family`.

---

## 1. TỔNG QUAN HỆ THỐNG VÀ NGUYÊN TẮC THIẾT KẾ (SYSTEM PHILOSOPHY)

### 1.1. Khái niệm cốt lõi (Core Concept)

`fomo.family` là nền tảng **Social Trading Terminal** thế hệ mới dành cho hệ sinh thái Web3 (Solana & EVM). Ứng dụng kết hợp giữa **Terminal giao dịch chuyên nghiệp** (Bloomberg / DexScreener / Photon) với **Mạng xã hội tài chính** (Twitter / Farcaster), cho phép người dùng theo dõi ví cá voi on-chain, đọc các luận điểm đầu tư (Thesis), phân tích PnL thời gian thực và sao chép lệnh tức thì (1-Click Copy-Trade).

### 1.2. Triết lý thẩm mỹ (Visual Aesthetic & Anti-AI Slop Rules)

- **Phong cách**: _Dark Cyberpunk Fintech & Social Consumer_. Gọn gàng, sắc sảo, độ tương phản cao, tràn đầy năng lượng tài chính nhưng không rối mắt.
- **Ràng buộc Viewport**: Cố định 100% chiều cao màn hình (`height: 100vh`, `width: 100vw`, `overflow: hidden`). Toàn trang không xuất hiện thanh cuộn trình duyệt (Window Scrollbar). Mỗi phân vùng nội dung cuộn độc lập (`overflow-y-auto`) với thanh cuộn siêu mỏng tùy biến (`scrollbar-thin`).
- **Phân cấp thị giác**:
  1. Con số PnL khổng lồ và đường sóng biểu đồ phát sáng màu xanh dạ quang (Neon Green) làm tâm điểm chú ý.
  2. Bảng xếp hạng Top Traders và danh sách Clans bên trái tạo tính cạnh tranh xã hội.
  3. Thẻ Luận điểm (Thesis) và lịch sử Swaps ở giữa kết hợp tính trực quan và phân tích dữ liệu.
  4. Bảng Chuyển tiền (Send) & Copy-Trade tức thì bên phải phục vụ hành động chuyển đổi nhanh (Call-to-Action).

---

## 2. BẢNG MÃ MÀU VÀ DESIGN TOKENS (COLOR SYSTEM)

Tất cả màu sắc được chuẩn hóa theo mã HEX và lớp tiện ích Tailwind CSS tương ứng:

| Nhóm Màu         | Tên Token       | Mã Hex    | Tailwind Class     | Ứng Dụng Thực Tế                                                   |
| :--------------- | :-------------- | :-------- | :----------------- | :----------------------------------------------------------------- |
| **Canvas**       | `bg-app`        | `#07080c` | `bg-[#07080c]`     | Màu nền bao quát toàn bộ ứng dụng                                  |
| **Sidebars**     | `bg-sidebar`    | `#08090d` | `bg-[#08090d]`     | Nền cột bên trái (Left Sidebar) & cột bên phải (Right Panel)       |
| **Surfaces**     | `bg-card`       | `#0f1119` | `bg-[#0f1119]`     | Nền các thẻ Card chính: Profile, PnL Hero, Positions, Thesis, Send |
| **Inputs/Sub**   | `bg-input`      | `#12141e` | `bg-[#12141e]`     | Nền ô Search, ô nhập số tiền, hàng danh sách con, bảng Swaps       |
| **Hover/Active** | `bg-hover`      | `#181a26` | `bg-[#181a26]`     | Nền item khi hover chuột hoặc hàng Trader đang được chọn           |
| **Borders**      | `border-layout` | `#181a24` | `border-[#181a24]` | Viền phân cách Header, Ticker chân trang, vách chia 3 cột chính    |
| **Borders**      | `border-card`   | `#1c1e2d` | `border-[#1c1e2d]` | Viền ngoài của các thẻ Card và Container                           |
| **Borders**      | `border-input`  | `#26283b` | `border-[#26283b]` | Viền ô Search, viền nút Share, viền ô nhập số tiền                 |
| **Neon Green**   | `accent-profit` | `#00e676` | `text-[#00e676]`   | PnL dương (+), đường cong biểu đồ SVG phát sáng, badge BUY         |
| **Rose Red**     | `accent-loss`   | `#ff3b69` | `text-[#ff3b69]`   | PnL âm (-), tỷ lệ giảm giá, badge SELL                             |
| **Royal Purple** | `accent-brand`  | `#7022ff` | `bg-[#7022ff]`     | Nút Follow chính, huy hiệu New, icon thương hiệu fomo              |
| **Amber Gold**   | `accent-gold`   | `#f59e0b` | `text-amber-400`   | Vương miện Top 1 (👑), biểu tượng All time ⚡, Bitcoin ₿           |
| **Typography**   | `text-main`     | `#ffffff` | `text-white`       | Tiêu đề chính, số dư lớn, tên trader, giá trị tài sản              |
| **Typography**   | `text-body`     | `#cbd5e1` | `text-slate-300`   | Nội dung bài viết thesis, mô tả chi tiết, nhãn số lượng            |
| **Typography**   | `text-muted`    | `#94a3b8` | `text-slate-400`   | Handle `@username`, thời gian (8m, 9m), nhãn phụ                   |
| **Typography**   | `text-faint`    | `#64748b` | `text-slate-500`   | Ký tự gợi ý, placeholder, đường ngăn cách                          |

---

## 3. QUY CHUẨN TYPOGRAPHY & FONT SPECIFICATION

Hệ thống sử dụng chiến lược font kép (Dual Font Hierarchy):

1. **Giao diện & Văn bản (Primary UI Sans-serif)**:
   - Font family: `'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`
   - Dùng cho: Logo thương hiệu `fomo`, tên Trader, bio, bài viết thesis, các nút bấm, tabs, nhãn danh mục.
   - Độ dày (Weights): Medium (500), SemiBold (600), Bold (700), ExtraBold (800), Black (900).

2. **Số liệu tài chính & On-chain (Financial Monospace)**:
   - Font family: `'JetBrains Mono', 'Roboto Mono', 'SF Mono', monospace`
   - Dùng cho: Tất cả các con số tiền mặt (`$5,939,794.87`), tỷ lệ phần trăm (`▲ 3,474.16%`), số lượng token (`20.8M STONK`), thời gian giao dịch (`8m`), vốn hóa thị trường (`$322.1B MC`).
   - Kỹ thuật: Bắt buộc bật `font-mono tabular-nums` để các con số thẳng cột khi hiển thị dạng bảng và tránh giật giao diện khi cập nhật realtime.

---

## 4. CẤU TRÚC KHÔNG GIAN BỐ CỤC (LAYOUT & VIEWPORT GEOMETRY)

```
+-------------------------------------------------------------------------------------------------------+
|  HEADER BAR (Fixed Top, Height: 56px / h-14, Width: 100vw, z-40, Border Bottom: #181a24)             |
|  [Logo fomo]       [====== Smart Search Pill Input (/ | Paste) ======]        [$0.00 cash | Avatar]   |
+-----------------------------------+---------------------------------------+---------------------------+
|  LEFT SIDEBAR                     |  CENTER DASHBOARD                     |  RIGHT ACTION PANEL       |
|  (Width: 330px, Fixed)            |  (Width: flex-1, Fluid)               |  (Width: 320px, Fixed)    |
|  Border Right: #181a24            |  Scrollable: overflow-y-auto           |  Border Left: #181a24     |
|                                   |                                       |                           |
|  - Top Tabs: Alerts/Tokens/       |  - Profile Header (Avatar, Badges,    |  - Send & Transfer Card:  |
|    Leaderboard/Feed               |    Bio, Social Stats, Follow CTA)     |    • Trader Recipient Pill|
|  - Clans 2-Column Grid            |  - Top Trades #1-#5 Carousel          |    • Big Amount Input     |
|  - Timeframe: 24H/7D/30D/ALL      |  - Big PnL & Glowing Wave Chart       |    • Note & Send Button   |
|  - "Your Rank" Profile Card       |  - 2-Column Lower Grid:               |    • Quick Copy-Trade CTA |
|  - Leaderboard Traders List:      |    • Col 1: Positions (Token list,    |  - "Your Positions" Card: |
|    1. Top 1 (Crown, Neon PnL)     |      amounts, PnL %)                  |    • Open/Closed toggle   |
|    2. Top 2 (Silver)              |    • Col 2: Thesis Card &             |    • Empty State Graphic  |
|    3. Top 3 (Bronze)              |      All Swaps (Buy/Sell Table)       |                           |
|    ... 4-10 traders               |                                       |                           |
|  - Bottom Split Views Actions     |                                       |                           |
+-----------------------------------+---------------------------------------+---------------------------+
|  MARKET TICKER FOOTER (Fixed Bottom, Height: 32px / h-8, Width: 100vw, z-30, Border Top: #161822)    |
|  [BTC $83k ▼]  [ETH $2.6k ▼]  [SOL $118 ▼]  [Base $85 ▼]   ...   [● Stable]  [Terms]  [Discord]       |
+-------------------------------------------------------------------------------------------------------+
```

---

## 5. BẢN VẼ CHI TIẾT TỪNG MODULE (COMPONENT BLUEPRINTS)

### 5.1. Module 1: Top Header Bar (`FomoHeader`)

- **Kích thước & Vị trí**: Chiều cao `h-14` (56px), cố định đầu trang `sticky top-0 z-40`, nền `#07080c`, viền đáy `border-b border-[#181a24]`, padding ngang `px-4`.
- **Thành phần bên trái**:
  - Logo thương hiệu: Chữ `fomo` viết thường, font sans-serif, cỡ `text-2xl`, trọng số `font-black text-white tracking-tight`. Khi hover có thể chớp nhẹ ánh sáng tím.
- **Thành phần trung tâm (Smart Search Bar)**:
  - Container dạng viên thuốc (Pill shape): `max-w-xl w-full mx-auto relative`.
  - Khung bao: `flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-[#12131b] border border-transparent focus-within:border-purple-500/40 focus-within:bg-[#151722] transition-all`.
  - Icon: Kính lúp `Search` màu xám `text-slate-500` kích thước `w-4 h-4`.
  - Input: Placeholder `"Search for tokens or traders..."`, `text-xs text-white placeholder-slate-500 bg-transparent outline-none flex-1`.
  - Phím tắt bên phải (Right Badges):
    - Badge nút dán: `"Paste"` nền xám tối `#1c1e2b`, chữ `text-[10px] text-slate-400 font-semibold px-2 py-0.5 rounded-full hover:text-white cursor-pointer`.
    - Phím gõ tắt: Ký tự `"/"` font mono đặt trong badge bo tròn xám tối `w-5 h-5 flex items-center justify-center text-[11px] text-slate-500 bg-[#1c1e2b] rounded-full`.
  - Dropdown kết quả (Live Search Dropdown): Khi người dùng gõ từ khóa, mở hộp thả xuống `absolute top-11 left-0 right-0 bg-[#0f1119] border border-[#23263b] rounded-xl shadow-2xl p-2 z-50`. Hiển thị danh sách Trader/Token khớp với avatar, tên, handle và PnL xanh ngọc.
- **Thành phần bên phải (Account & Balances)**:
  - Khối tiền mặt:
    - Dòng 1: `$0.00 cash` (font mono `text-xs font-bold text-white`).
    - Dòng 2: `"Deposit more"` (chữ tím nhỏ `text-[10px] text-purple-400 hover:text-purple-300 cursor-pointer font-medium`).
  - Vạch ngăn cách đứng: `h-7 w-[1px] bg-[#1f2130]`.
  - Khối crypto:
    - Dòng 1: `$0.00` (font mono `text-xs font-bold text-white`).
    - Dòng 2: `--` (font mono `text-[10px] text-slate-500`).
  - Avatar tài khoản:
    - Khối tròn `w-8 h-8 rounded-full bg-gradient-to-tr from-purple-700 via-indigo-600 to-fuchsia-600 p-[1.5px] cursor-pointer`.
    - Lõi tròn bên trong: `w-full h-full rounded-full bg-[#0d0f17] flex items-center justify-center text-xs font-bold text-white` (chữ lồng `"JJ"`).

---

### 5.2. Module 2: Cột Trái (Sidebar Clans & Leaderboard - `FomoLeftSidebar`)

- **Kích thước & Vị trí**: Chiều rộng cố định `w-[330px]`, chiều cao `h-[calc(100vh-56px-32px)]`, nền `#08090d`, viền phải `border-r border-[#181a24]`, cuộn dọc độc lập `overflow-y-auto scrollbar-thin`.
- **Thanh Tab trên cùng**:
  - Dãy 4 nút: `🔔 Alerts`, `Tokens`, `Leaderboard` (mặc định active), `Feed`.
  - Nút active (`Leaderboard`): Nền `#181a26`, chữ trắng đậm `text-white font-bold`, viền mờ bo góc 8px.
  - Các nút khác: Chữ xám `text-slate-400 hover:text-white font-medium`.
  - Icon thu gọn ở mép phải: `ChevronsLeft` (`<<`) màu xám `hover:text-white`.
- **Phần Clans (Hội nhóm đầu tư)**:
  - Tiêu đề mục:
    - Chữ `Clans` đậm `text-xs font-bold text-white uppercase tracking-wider`.
    - Huy hiệu `New ^` bo tròn nhỏ: Nền tím `#1e1738`, chữ tím sáng `text-[10px] text-purple-300 font-semibold px-2 py-0.5 rounded-full border border-purple-500/20`.
    - Đường dẫn bên phải: `View all >` chữ xám `text-[11px] text-slate-400 hover:text-white`.
  - Lưới 2 cột (Grid 2 cols) gồm 6 Clans mẫu:
    - Mỗi item clan là thẻ chữ nhật bo tròn 10px `bg-[#0f1119] border border-[#1a1c29] p-2 hover:border-[#2a2d42] transition-colors cursor-pointer`.
    - Avatar vuông bo góc `w-7 h-7 rounded-lg object-cover`.
    - Cột thông tin:
      - Tên Clan in đậm cắt cụt: `text-xs font-bold text-white truncate` (vd: `Fantom Trou...`, `Dabal`, `Conviction C...`, `chubbicorns`, `Troupe KZ`, `Reach`).
      - Hàng dưới: Biểu tượng 👥 + số thành viên `text-[10px] text-slate-400` và PnL xanh ngọc đậm `text-[11px] font-mono font-bold text-emerald-400` (vd: `+$11.4M`, `+$7.1M`).
- **Bộ lọc khung thời gian (Timeframe Bar)**:
  - Dải pill group nền tối `#10121a` bo tròn 8px `p-0.5 border border-[#1b1d2b] flex items-center justify-between`:
    - 4 nút: `24H`, `7D`, `30D`, `ALL`.
    - Nút được chọn (30D): Nền `#1d1f2e`, chữ trắng `text-xs font-bold text-white shadow-sm`.
    - Các nút còn lại: Chữ xám `text-xs text-slate-400 hover:text-slate-200 font-medium px-3 py-1`.
  - Icon chia sẻ: Nút icon `Share2` màu xám bo tròn cạnh phải.
- **Thẻ thứ hạng cá nhân ("Your rank")**:
  - Container nhỏ `p-2.5 rounded-xl bg-[#0f1119] border border-[#1c1e2d] flex items-center justify-between`:
    - Trái: Avatar tròn `JJ`, nhãn `Your rank` `text-[11px] text-slate-400 font-medium`, số thứ hạng `# --` font mono.
    - Phải: Nhãn `PnL` `text-[11px] text-slate-400 font-medium`, giá trị `--` font mono.
- **Danh sách Bảng Xếp Hạng Trader (Leaderboard List)**:
  - Danh sách cuộn gồm 10 Trader hàng đầu on-chain.
  - Cấu trúc mỗi hàng (`TraderRow`):
    - Cột 1: Thứ hạng:
      - Top 1: Vương miện vàng 👑 (`text-base text-amber-400`).
      - Top 2: Huy chương bạc 🥈.
      - Top 3: Huy chương đồng 🥉.
      - Top 4+: Số thứ tự font mono xám đậm `text-xs font-bold text-slate-500` (vd: `4.`, `5.`, `6.`).
    - Cột 2: Avatar tròn `w-9 h-9 rounded-full object-cover border border-[#222436]`.
    - Cột 3: Tên hiển thị & Handle:
      - Tên chính: `text-xs font-bold text-white flex items-center gap-1` kèm badge emoji (vd: `TheS@LstIce 🎴`, `qw ⚡`, `Gcr 🦇`, `Ansem 🐂`).
      - Handle: `text-[11px] text-slate-500 font-mono truncate` (vd: `@The__Solstice`).
    - Cột 4 (Mép phải):
      - Dòng 1: Con số PnL màu xanh dạ quang neon `#00e676` font mono `text-xs font-extrabold tracking-tight` (vd: `+$6,099,895.35`).
      - Dòng 2: Cụm icon đồng xu xếp chồng (`$`, `◎`) và số lượng huy hiệu `text-[10px] text-slate-400 font-medium` (vd: `44+`).
    - Hiệu ứng chọn (Selected State): Hàng đang được chọn có nền xám sáng hơn `#181a26`, viền trái dày 2px màu tím neon `border-l-2 border-purple-500` hoặc viền bao quanh tím nhạt.
- **Thanh công cụ đáy cột trái (Sidebar Split Controls)**:
  - 2 nút hành động nhanh: `⚏ Split bottom` và `▯ Split right` chữ xám `text-[11px] text-slate-500 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5`.

---

### 5.3. Module 3: Khu Vực Trung Tâm (Center Dashboard - `FomoCenterDashboard`)

- **Kích thước & Vị trí**: `flex-1`, chiều cao `h-[calc(100vh-56px-32px)]`, cuộn dọc độc lập `overflow-y-auto scrollbar-thin p-5 space-y-5`.
- **Phân đoạn 1: Trader Profile Header**:
  - Hàng trên:
    - Avatar tròn cỡ lớn: `w-16 h-16 rounded-full object-cover border-2 border-purple-500/40 shadow-lg`.
    - Tên hiển thị: `text-2xl font-black text-white flex items-center gap-2` (vd: `TheS@LstIce 🎴`).
    - Handle: `text-xs font-mono text-slate-400 mt-0.5` (`@The__Solstice`).
    - Bio: `"holder in a trader's world"` (font chữ thường `text-xs text-slate-300 italic mt-1.5`).
    - 3 thông số xã hội (Social Proof Counts):
      - `0 Mutuals` • `92 Following` • `362K Followers` (`text-xs font-bold text-white` kèm nhãn phụ xám).
    - 2 nút hành động góc trên phải:
      - Nút `Share`: `px-4 py-2 rounded-xl bg-[#141622] hover:bg-[#1a1d2e] border border-[#26283b] text-xs font-bold text-slate-200 flex items-center gap-1.5 transition-all`.
      - Nút `Follow`: `px-5 py-2 rounded-xl bg-[#7022ff] hover:bg-[#601ce0] text-xs font-bold text-white shadow-lg shadow-purple-600/30 transition-all flex items-center gap-1.5` (khi click chuyển đổi trạng thái thành `Following` màu xám tối).
  - Dải 4 huy hiệu siêu dữ liệu (Metadata Pills):
    - `⚡ All time` (icon sấm sét vàng, nền `#1a1924` viền `#2d271d` chữ vàng hổ phách).
    - `🕒 4d 20h avg. hold` (icon đồng hồ, chữ xám sáng).
    - `📊 482 trades` (icon cột biểu đồ, chữ xám sáng).
    - `📅 Joined Mar 2026` (icon lịch, chữ xám sáng).
  - Băng chuyền Top Trades (#1 đến #5):
    - Dải ngang gồm các thẻ bo tròn 12px `bg-[#0f1119] border border-[#1c1e2d] px-3.5 py-2 flex items-center gap-3 shrink-0`:
      - Thẻ #1 Trade: Nhãn `#1 Trade` màu vàng + Icon 📈 + Token `STONK` + PnL xanh `+$5,630,233.08` + Tỷ lệ `(▲ 3,474.16%)`.
      - Thẻ #2 Trade: Nhãn `#2 Trade` + Token `POPCAT` + PnL `+$328,485.03` + Tỷ lệ `(▲ 141.65%)`.
      - Thẻ #3 Trade: Nhãn `#3 Trade` + Token `WIF` + PnL `+$266,657.26` + Tỷ lệ `(▲ 377.92%)`.

- **Phân đoạn 2: Hero PnL & Glowing Wave Chart (Trọng tâm thị giác)**:
  - Khối thẻ lớn: `rounded-2xl bg-[#0f1119] border border-[#1c1e2d] p-5 shadow-2xl relative overflow-hidden`.
  - Header của thẻ PnL:
    - Trái:
      - Con số PnL khổng lồ: `$5,939,794.87` (font mono `text-4xl font-black text-white tracking-tight`).
      - Dòng thay đổi: `+$5,514,462.64 30d` (màu xanh dạ quang `#00e676` font mono `text-sm font-extrabold flex items-center gap-1.5`).
    - Phải: Bộ chọn khung thời gian `24H`, `7D`, `30D` (30D đang được bấm active với nền tím đậm `#261a47` viền tím sáng).
  - **Biểu đồ SVG Glowing Wave**:
    - Container: `w-full h-48 relative mt-3`.
    - SVG chuẩn: `viewBox="0 0 800 200" className="w-full h-full overflow-visible" preserveAspectRatio="none"`.
    - Bộ lọc phát sáng SVG (`<defs>`):

      ```xml
      <filter id="fomo-chart-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3.5" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <linearGradient id="fomo-chart-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#00e676" stop-opacity="0.22" />
        <stop offset="60%" stop-color="#00e676" stop-opacity="0.05" />
        <stop offset="100%" stop-color="#00e676" stop-opacity="0.0" />
      </linearGradient>
      ```

    - Đường sóng chính: `<path d="..." fill="none" stroke="#00e676" strokeWidth="2.8" strokeLinecap="round" filter="url(#fomo-chart-glow)" />`.
    - Vùng đổ bóng: `<path d="..." fill="url(#fomo-chart-fill)" />`.
    - Điểm chốt mốc cuối đường cong: Vòng tròn dạ quang nhấp nháy `<circle cx="796" cy="..." r="4" fill="#00e676" className="animate-pulse" />`.
  - Đáy đồ thị:
    - Vòng tròn `$` xanh xám + Nhãn `Total cash` `text-xs text-slate-400 font-medium` + Số tiền `$2.89` font mono trắng.

- **Phân đoạn 3: Khung Hai Cột Bên Dưới (Lower Two-Column Grid)**:
  - Sử dụng `grid grid-cols-1 xl:grid-cols-2 gap-5`.

  - **Cột Trái — Vị Thế (Positions 47)**:
    - Header:
      - Tiêu đề: `Positions 47` (`text-sm font-bold text-white`).
      - Bên phải: Checkbox `Show dust` (`text-xs text-slate-400`) + Dải nút `Open` (nền tím `#7022ff` chữ trắng) / `Closed` (chữ xám).
    - Danh sách token:
      - Hàng 1: Token `STONK` (dấu tích xanh ngọc verified), lượng holding `20.8M STONK`, giá trị `$5,783,271.76`, tỷ lệ tăng trưởng `▲ 3,480.02%` màu xanh ngọc.
      - Hàng 2: Token `STONKCATS`, lượng `19.5M STONKCATS`, giá trị `$34,731.98`, tỷ lệ tăng trưởng `▲ 2,858.40%`.
      - Hàng 3+: Token `WIF`, `POPCAT`, `BONK` với số liệu tương ứng.

  - **Cột Phải — Luận Điểm (Thesis) & Lịch Sử Khớp Lệnh (All Swaps)**:
    - **Thẻ Luận Điểm (Thesis Card)**:
      - Header thẻ:
        - Icon token tròn 📈 + Tên `STONK` (có dấu tích verified).
        - Huy hiệu 1: `Thesis` nền xám tối bo tròn `px-2 py-0.5 text-[10px] text-slate-300 font-semibold`.
        - Huy hiệu 2: `Most Liked` nền vàng tối `#2d2613` chữ vàng hổ phách `text-amber-400 border border-amber-500/20`.
      - Nội dung bài viết (Text Quote):
        > _"Without a shadow of doubt, stonkfun will win. Trust in yourselves. Trust in each other. Trust in the cool thing happening for once and we all get rich instead of pvping each other garbage. Dormant solana whales and entities didn't wake up from their slumber for nothing. Zcat didn't go higher than any pumpfun coin has gone in years for nothing. Hold your conviction bags."_
      - Footer tương tác:
        - Nút thả tim: `🤍 516` (click chuyển thành tim đỏ `❤️ 517` kèm hiệu ứng nảy).
        - Số phản hồi: `🔁 13 newer` chữ xám `text-slate-400`.
    - **Bảng Lịch Sử Khớp Lệnh (All Swaps Table)**:
      - 3 Tab con: `All swaps`, `Buys`, `Sells`.
      - Tiêu đề cột: `Token` (4 col), `Action` (2 col), `Amount` (3 col), `MCap ↕` (2 col), `Time` (1 col).
      - Huy hiệu Action:
        - `Buy`: Nền xanh mờ `bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase`.
        - `Sell`: Nền đỏ mờ `bg-rose-500/15 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase`.
      - Hàng dữ liệu mẫu:
        - `ETH` | `Sell` | `$10.70` | `$322.1B MC` | `8m`
        - `POD` | `Buy` | `$12.55` | `$1.8M MC` | `8m`
        - `LIT` | `Sell` | `$25.14` | `$4.2M MC` | `9m`
        - `COON` | `Sell` | `$52.27` | `$950K MC` | `9m`
        - `MCDX` | `Sell` | `$54.09` | `$2.1M MC` | `9m`
        - `TKALSHI` | `Buy` | `$53.91` | `$8.4M MC` | `10m`

---

### 5.4. Module 4: Cột Phải (Send & Quick Copy-Trade - `FomoRightPanel`)

- **Kích thước & Vị trí**: Chiều rộng cố định `w-[320px]`, chiều cao `h-[calc(100vh-56px-32px)]`, nền `#08090d`, viền trái `border-l border-[#181a24]`, cuộn dọc độc lập `overflow-y-auto scrollbar-thin p-4 space-y-4`.
- **Thẻ 1: Khung Chuyển Tiền / Đặt Lệnh (Send Card)**:
  - Header:
    - Tiêu đề: `Send` (`text-sm font-bold text-white`).
    - Pill người nhận (Recipient Pill): Avatar tròn nhỏ + tên `@The__Solstice ⚡` nằm trong pill xám đen bo tròn `bg-[#151722] border border-[#23263b] px-2.5 py-1 text-xs text-slate-300 flex items-center gap-1.5`.
  - Khung nhập số tiền (Amount Input Box):
    - Khối nền tối bo tròn 12px `bg-[#0f1119] border border-[#1e2030] p-3 flex items-center justify-between`:
      - Ký hiệu tiền: `text-xl font-bold text-slate-500 mr-1` (`$`).
      - Ô input số: `text-2xl font-mono font-extrabold text-white bg-transparent outline-none w-32 placeholder-slate-600`.
      - Phía phải: Menu thả xuống `$ Cash ⌄` (`text-xs font-bold text-slate-300 bg-[#171926] px-2 py-1 rounded-md border border-[#25283d]`) và dòng phụ `$0 available`.
  - Ô nhập ghi chú (Note Box):
    - Input `placeholder="Add a note"` + Bộ đếm ký tự `0/200` font mono chữ xám ở góc phải.
  - Nút bấm `Send`:
    - Nút lớn toàn chiều ngang: `w-full py-3 rounded-xl bg-[#1a1c2a] hover:bg-[#7022ff] text-slate-400 hover:text-white text-xs font-bold transition-all shadow-md`.
  - Nút Copy-Trade nhanh (Quick Copy-Trade Action):
    - Thẻ viền tím phát sáng `w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/40 hover:border-purple-400 transition-all flex items-center justify-center gap-2 cursor-pointer`:
      - Icon `Zap` màu vàng/tím + Chữ `Copy Next Trade From Solstice` `text-xs font-bold text-purple-200`. Khi click mở popup thông báo hoặc thiết lập hạn mức copy tự động.
- **Thẻ 2: Khung Vị Thế Người Dùng (Your Positions Card)**:
  - Header: Tiêu đề `Your positions` + Toggle 2 nút `Open` / `Closed`.
  - Trạng thái chưa có lệnh (Empty State):
    - Khối nền `#0f1119` bo tròn 12px `p-6 border border-[#1a1c28] flex flex-col items-center justify-center text-center space-y-2`:
      - Icon ví rỗng `Inbox` hoặc `Layers` màu xám tối.
      - Dòng văn bản: `"No open positions. Trades you execute or copy will appear here in real-time."` (`text-xs text-slate-500 max-w-[220px]`).

---

### 5.5. Module 5: Thanh Ticker Chân Trang (Market Ticker Footer - `FomoBottomTicker`)

- **Kích thước & Vị trí**: Chiều cao `h-8` (32px), cố định chân trang `fixed bottom-0 left-0 right-0 z-30`, nền `#07080c`, viền đỉnh `border-t border-[#161822]`, padding ngang `px-4 flex items-center justify-between text-xs select-none`.
- **Phía trái (Dải ticker giá tiền mã hóa trực tiếp)**:
  - `₿ $83,280.61 ▾ 0.80%` (Icon vàng `text-amber-400`, số giá trắng, % âm màu đỏ hồng).
  - `Ξ $2,669.64 ▾ 1.56%` (Icon xanh dương `text-sky-400`, số giá trắng, % âm màu đỏ hồng).
  - `◎ $118.46 ▾ 0.83%` (Icon tím Solana `text-purple-400`, số giá trắng, % âm màu đỏ hồng).
  - `Base $85.69 ▾ 2.96%` (Icon xanh cyan `text-cyan-400`, số giá trắng, % âm màu đỏ hồng).
- **Phía phải (Trạng thái hệ thống & Liên kết)**:
  - Trạng thái kết nối: Chấm tròn xanh lá chớp nhẹ (`animate-pulse`) kèm chữ `● Stable` `text-emerald-400 font-mono text-[11px] font-semibold`.
  - Liên kết phụ: `Privacy`, `Terms`, `Help / Spec` (màu xám `text-slate-500 hover:text-white cursor-pointer transition-colors text-[11px]`).
  - Biểu tượng Discord: Icon SVG màu xám `hover:text-white cursor-pointer`.

---

## 6. BỘ DỮ LIỆU CHUẨN JSON (READY-TO-USE MOCK DATA SCHEMA)

Bất kỳ AI model nào có thể sao chép trực tiếp schema TypeScript và đối tượng dữ liệu dưới đây để khởi tạo state mà không cần gọi API ngoài:

```typescript
export interface ClanItem {
  id: string;
  name: string;
  avatar: string;
  membersCount: number;
  totalPnl: string;
}

export interface TraderTopTrade {
  rankLabel: string;
  tokenName: string;
  tokenIcon: string;
  pnlUsd: string;
  pctGain: string;
}

export interface TraderPosition {
  id: string;
  token: string;
  name: string;
  tokenIcon: string;
  verified: boolean;
  amountHolding: string;
  valueUsd: string;
  unrealizedGainPct: string;
  isOpen: boolean;
}

export interface TraderSwap {
  id: string;
  token: string;
  tokenIcon: string;
  action: "Buy" | "Sell";
  amountUsd: string;
  mcap: string;
  timeAgo: string;
}

export interface TraderThesis {
  token: string;
  badge1: string;
  badge2: string;
  content: string;
  likesCount: number;
  commentsCount: number;
}

export interface FomoTrader {
  id: string;
  rank: number;
  displayName: string;
  handle: string;
  badgeEmoji?: string;
  avatar: string;
  pnlDisplay: string;
  pnlValue: number;
  badgesCount: number;
  bio: string;
  mutuals: number;
  following: number;
  followers: string;
  allTimeHold: string;
  tradesCount: number;
  joinedDate: string;
  chartPnlDisplay: string;
  chartPnlChange: string;
  chartTimeframe: string;
  totalCash: string;
  chartPoints: number[];
  topTrades: TraderTopTrade[];
  positions: TraderPosition[];
  thesis: TraderThesis;
  swaps: TraderSwap[];
}
```

### Đối tượng mẫu chuẩn của Trader đang được chọn (`@The__Solstice`)

```json
{
  "id": "the-solstice",
  "rank": 3,
  "displayName": "TheS@LstIce",
  "handle": "@The__Solstice",
  "badgeEmoji": "🎴",
  "avatar": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
  "pnlDisplay": "+$6,099,895.35",
  "pnlValue": 6099895.35,
  "badgesCount": 44,
  "bio": "holder in a trader's world",
  "mutuals": 0,
  "following": 92,
  "followers": "362K",
  "allTimeHold": "4d 20h avg. hold",
  "tradesCount": 482,
  "joinedDate": "Joined Mar 2026",
  "chartPnlDisplay": "$5,939,794.87",
  "chartPnlChange": "+$5,514,462.64 30d",
  "chartTimeframe": "30D",
  "totalCash": "$2.89",
  "chartPoints": [
    30, 42, 38, 55, 60, 48, 72, 85, 95, 110, 105, 130, 150, 140, 175, 190, 205
  ],
  "topTrades": [
    {
      "rankLabel": "#1 Trade",
      "tokenName": "STONK",
      "tokenIcon": "📈",
      "pnlUsd": "+$5,630,233.08",
      "pctGain": "▲ 3,474.16%"
    },
    {
      "rankLabel": "#2 Trade",
      "tokenName": "POPCAT",
      "tokenIcon": "🐱",
      "pnlUsd": "+$328,485.03",
      "pctGain": "▲ 141.65%"
    },
    {
      "rankLabel": "#3 Trade",
      "tokenName": "WIF",
      "tokenIcon": "🐕",
      "pnlUsd": "+$266,657.26",
      "pctGain": "▲ 377.92%"
    }
  ],
  "positions": [
    {
      "id": "p1",
      "token": "STONK",
      "name": "StonkFun",
      "tokenIcon": "📈",
      "verified": true,
      "amountHolding": "20.8M STONK",
      "valueUsd": "$5,783,271.76",
      "unrealizedGainPct": "▲ 3,480.02%",
      "isOpen": true
    },
    {
      "id": "p2",
      "token": "STONKCATS",
      "name": "Stonk Cats",
      "tokenIcon": "🐱",
      "verified": false,
      "amountHolding": "19.5M STONKCATS",
      "valueUsd": "$34,731.98",
      "unrealizedGainPct": "▲ 2,858.40%",
      "isOpen": true
    },
    {
      "id": "p3",
      "token": "POPCAT",
      "name": "Popcat Sol",
      "tokenIcon": "🐱",
      "verified": true,
      "amountHolding": "420K POPCAT",
      "valueUsd": "$18,450.12",
      "unrealizedGainPct": "▲ 141.65%",
      "isOpen": true
    }
  ],
  "thesis": {
    "token": "STONK",
    "badge1": "Thesis",
    "badge2": "Most Liked",
    "content": "Without a shadow of doubt, stonkfun will win. Trust in yourselves. Trust in each other. Trust in the cool thing happening for once and we all get rich instead of pvping each other garbage. Dormant solana whales and entities didn't wake up from their slumber for nothing. Zcat didn't go higher than any pumpfun coin has gone in years for nothing. Hold your conviction bags.",
    "likesCount": 516,
    "commentsCount": 13
  },
  "swaps": [
    {
      "id": "s1",
      "token": "ETH",
      "tokenIcon": "Ξ",
      "action": "Sell",
      "amountUsd": "$10.70",
      "mcap": "$322.1B MC",
      "timeAgo": "8m"
    },
    {
      "id": "s2",
      "token": "POD",
      "tokenIcon": "🪙",
      "action": "Buy",
      "amountUsd": "$12.55",
      "mcap": "$1.8M MC",
      "timeAgo": "8m"
    },
    {
      "id": "s3",
      "token": "LIT",
      "tokenIcon": "🔥",
      "action": "Sell",
      "amountUsd": "$25.14",
      "mcap": "$4.2M MC",
      "timeAgo": "9m"
    },
    {
      "id": "s4",
      "token": "COON",
      "tokenIcon": "🦝",
      "action": "Sell",
      "amountUsd": "$52.27",
      "mcap": "$950K MC",
      "timeAgo": "9m"
    },
    {
      "id": "s5",
      "token": "MCDX",
      "tokenIcon": "🍔",
      "action": "Sell",
      "amountUsd": "$54.09",
      "mcap": "$2.1M MC",
      "timeAgo": "9m"
    },
    {
      "id": "s6",
      "token": "TKALSHI",
      "tokenIcon": "⚡",
      "action": "Buy",
      "amountUsd": "$53.91",
      "mcap": "$8.4M MC",
      "timeAgo": "10m"
    }
  ]
}
```

---

## 7. QUY TẮC TƯƠNG TÁC NGƯỜI DÙNG (INTERACTIONS & MICRO-STATES)

1. **Chọn Trader (Select Trader)**:
   - Click vào bất kỳ hàng nào trong danh sách Leaderboard ở cột trái sẽ lập tức cập nhật:
     - Avatar, tên, bio, thông số xã hội và các huy hiệu trên Profile Header.
     - Số PnL khổng lồ và đường sóng biểu đồ SVG phát sáng ở giữa.
     - Danh sách Positions, bài viết Thesis và lịch sử Swap của trader đó.
     - Recipient Pill ở cột phải để sẵn sàng Send hoặc Copy-Trade.
2. **Tìm kiếm thời gian thực (Smart Search Input)**:
   - Gõ bất kỳ ký tự nào vào ô Search ở Header Bar sẽ lọc tức thì danh sách Trader & Token và hiển thị Dropdown kết quả.
   - Bấm phím `/` ở bất kỳ đâu trên trang sẽ focus tự động vào ô Search.
3. **Thả tim Thesis (Like Interaction)**:
   - Click nút tim sẽ chuyển đổi từ `🤍 516` sang `❤️ 517` kèm hiệu ứng scale nhẹ (`scale-110 active:scale-95`).
4. **Follow / Unfollow**:
   - Nút `Follow` màu tím `#7022ff` chuyển sang `Following` màu xám tối và ngược lại.
5. **Bộ lọc Swaps (All / Buys / Sells)**:
   - Chuyển tab lập tức lọc danh sách bảng theo `action === 'Buy'` hoặc `action === 'Sell'`.
6. **Sao chép lệnh nhanh (Copy-Trade CTA)**:
   - Bấm nút `Copy Next Trade` sẽ hiển thị thông báo đã liên kết ví để theo dõi lệnh tự động từ trader đã chọn.

---

## 8. HƯỚNG DẪN PROMPT ĐỂ MỌI MÔ HÌNH AI TÁI LẬP GIAO DIỆN (PROMPT REPLICATION GUIDE)

Nếu bạn muốn bất kỳ mô hình AI nào (ChatGPT, Claude, Gemini, DeepSeek, v.v.) tự động viết code React để tái tạo giao diện này, hãy sao chép toàn bộ nội dung file `design.md` và gắn kèm câu lệnh sau:

```markdown
Bạn là Senior Frontend Architect chuyên sâu về Web3 & Fintech UI.
Nhiệm vụ của bạn: Đọc toàn bộ file đặc tả thiết kế kỹ thuật `design.md` ở trên và hiện thực hóa một ứng dụng React 19 + TypeScript + Tailwind CSS hoàn chỉnh 100% tái hiện giao diện "FOMO Social Trading Terminal".

Yêu cầu kỹ thuật bắt buộc:

1. Bố cục: Viewport-locked 100vh (`h-screen overflow-hidden`), đúng 5 khối (Header 56px, Left Sidebar 330px, Center Dashboard flex-1 cuộn độc lập, Right Panel 320px cuộn độc lập, Bottom Ticker 32px).
2. Màu sắc & Tokens: Tuân thủ đúng bảng mã hex (#07080c canvas, #0f1119 card, #00e676 neon green, #7022ff purple).
3. Đồ thị: Biểu đồ SVG phát sáng Glowing Wave Chart sử dụng cubic bezier curve và feGaussianBlur filter.
4. Tương tác: Bấm vào Trader ở Leaderboard sẽ đổi toàn bộ thông tin Dashboard trung tâm và Recipient của bảng Send bên phải. Nút thả tim thesis, nút Follow, bộ lọc Buys/Sells hoạt động mượt mà.
5. Code hoàn chỉnh, không dùng placeholder hay "TODO", đảm bảo biên dịch không lỗi TypeScript.
```

---

_Tài liệu kỹ thuật được chuẩn hóa cho toàn bộ kiến trúc sản phẩm FOMO Social Trading Terminal._
