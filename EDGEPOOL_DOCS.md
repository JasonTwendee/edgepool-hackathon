# Edgepool

## 1. Định vị

**Automated Solana vaults powered by performance-ranked traders.**

Các diễn đạt thay thế: `Put your capital behind proven on-chain strategies.` / `Select a vault. Allocate capital. Follow every trade on-chain.`

Edgepool là vault tự động non-custodial trên Solana, copy-trading theo trader được xếp hạng. Mỗi vault bám theo một trader đã được kiểm chứng on-chain. Người gửi vốn không cần tự canh chart 24/7, không tự chia vốn, không tự cắt lỗ cảm tính — toàn bộ thực thi, chia vốn và quản trị rủi ro chạy bằng luật cứng của bot.

Giai đoạn hiện tại: Prototype, Colosseum submission. MVP là single-trader vault. Giai đoạn sau mở rộng thành multi-trader baskets.

Đối tượng:
- Depositor: người có SOL/USDC muốn ủy thác theo chiến lược on-chain minh bạch.
- Partner Trader: trader giỏi vừa cung cấp chiến lược vừa phân phối vault.
- Vận hành / Admin: giám sát, bật/tắt copy, emergency pause.

## 2. Vấn đề

The signal is public. Capturing it is not.

Luồng trễ điển hình: Trader buys → Follower notices → Copies CA → Scans risk → Buys late. Giá trader khớp ở vùng thấp, giá follower khớp ở vùng cao hơn nhiều sau khi đã qua các bước thủ công.

Bốn rào cản:
- Late entries: mua trễ so với giá fill thật của trader.
- DIY infra: tự dựng hạ tầng theo dõi on-chain tốn kém, dễ miss tín hiệu.
- 24/7 screen time: tín hiệu xuất hiện bất kỳ lúc nào.
- Emotional execution: cắt lỗ / chốt lời theo cảm xúc.

Edgepool trả lời bằng 4 cơ chế: bot canh on-chain 24/7 vào lệnh ngay khi phát hiện trader mua; công thức chia vốn cứng; luật chốt/cắt cứng; kế toán non-custodial pro-rata theo share.

## 3. Insight cốt lõi

Trader PnL is not copyable PnL.

Lợi nhuận headline của trader không bằng lợi nhuận mà follower copy được. Phần copy được là phần còn lại sau khi trừ: độ trễ tín hiệu, thanh khoản khớp được, chi phí giao dịch, kiểm duyệt rủi ro.

Waterfall: Trader PnL → trừ Signal latency → trừ Executable liquidity → trừ Trading costs → trừ Risk eligibility = Copyable PnL.

Vì vậy Edgepool xếp hạng theo copyable PnL ở 3 khung 24h / 7d / 30d, không xếp theo PnL headline. Ví dụ: lãi 6M USD nhưng pool 5k USD thanh khoản mỏng bị loại; lãi 500k USD thanh khoản sâu được xếp top.

Ba khung xếp hạng:
- 24h momentum: động lượng ngắn hạn.
- 7d repeatability: khả năng lặp lại.
- 30d consistency: ổn định dài hạn.

Bối cảnh thị trường FOMO: 625K+ users, $4B+ volume, 110M+ interactions.

## 4. Khái niệm Vault

Each ranked trader powers a dedicated investable vault.

Cấu trúc: Partner Trader A phát tín hiệu on-chain → Trader A Vault bám theo → nhiều Depositor nạp SOL vào vault, nhận lại Vault shares.

Ví dụ minh họa: NAV 10.00 SOL, Shares 4.00, NAV/share 2.500 SOL.

Ba nguyên tắc chia sẻ: shared execution, shared risk rules, pro-rata ownership.

## 5. Toán học Vault

### 5.1 Kế toán SOL

Share price = Vault NAV / Shares outstanding.

SOL là tài sản kế toán và settlement duy nhất. USDC chỉ dùng để hiển thị estimate. Mọi dòng tiền settle ở giá flat hoặc checkpoint.

Ví dụ: NAV 10.00 SOL / 4.00 shares = 2.500 SOL/share. Nạp 2.5 SOL nhận 1 share. Khi Net NAV lên 10.80, mỗi share trị giá 2.700 SOL.

HWM (High Water Mark): đỉnh giá share cao nhất từng đạt. Phí hiệu suất chỉ thu trên phần lợi nhuận mới vượt đỉnh cũ.

### 5.2 Chia vốn mỗi lệnh

Trade size = min(1% NAV, 0.1 SOL, liquidity cap).

- Vault 1 SOL → 0.01 SOL/lệnh.
- Vault 5 SOL → 0.05 SOL/lệnh.
- Vault từ 10 SOL trở lên → kịch trần 0.1 SOL/lệnh.
- 0.1 SOL là mức trần, không phải size cố định.
- Tối đa 10 vị thế mở, tổng exposure ≤ 10% NAV.

### 5.3 Settle Epoch

price = (nav - pendingIn) / totalShares. Vault mới bootstrap price = 1, làm tròn 9 decimals.

Nếu bật feeBps và price vượt HWM: feeSol = (price - hwm) x totalShares x feeBps / 10000. Trừ fee khỏi nav, tính lại price, nâng HWM lên mức mới.

Deposit: minted = amountSol / price, chuyển QUEUED → SETTLED. Nạp theo giá settle nên không ăn lãi retro.

Withdraw: payoutShares = min(shares yêu cầu, shares đang giữ). gross = payoutShares x price. fee = gross x withdrawFeeBps / 10000 chuyển vào treasurySol. payout = gross - fee.

Mỗi lần settle tạo một EpochCheckpoint snapshot navSol, sharePrice, sharesOutstanding, feeSol.

Treasury policy T2: reserveBps, withdrawFeeBps, lockHours mặc định 0 là tắt. Ví dụ fee rút 10%: rút 10 shares giá 1 → payout 9, treasury 1. Lock chặn rút nếu settledAt + lockHours chưa qua. Reserve giữ sàn thanh khoản: floor = nav x (10000 - reserveBps) / 10000; lệnh rút làm afterNav tụt dưới floor bị từ chối.

Withdraw windows: cặp settlePeriodHours / settleLengthMin cùng bằng 0 là luôn mở, hoặc cùng lớn hơn 0 là mở theo cửa sổ. windowState tính pos = (now - createdAt) % period, open khi pos < length. Settle chỉ chạy trong cửa sổ mở; deposit/withdraw ngoài cửa sổ vẫn xếp hàng đợi.

Multi-vault: tối đa 5 trader active mỗi vault. Assign yêu cầu địa chỉ base58 hợp lệ và weightBps 0..10000. Remove là soft off isActive = false.

Status vault trả về: id, name, environment, feeBps, hwmSharePrice, totalShares, treasurySol, policy, window open/nextOpensAt, lastEpoch, queuedDeposits/Withdrawals.

## 6. Pipeline từ tín hiệu đến vị thế

8 bước. Không đủ điều kiện trong 30 phút → Skip.

1. Rank: xếp hạng copyable PnL 24h / 7d / 30d.
2. Detect: phát hiện fill price thật on-chain realtime. Ví dụ swap 2 SOL lấy 40K TOKEN-X lúc 14:02:11 giá 0.00005.
3. Confirm momentum: chỉ vào nếu giá tăng tiếp +10% so với giá trader khớp.
4. Wait for pullback: nhánh còn lại đợi giảm -10% từ đỉnh sau tín hiệu rồi vào. Quá 30 phút → Skip.
5. Qualify: RugCheck + thanh khoản + slippage + mcap. Rớt một tiêu chí → bỏ.
6. Size: áp công thức min(1% NAV, 0.1 SOL, liquidity cap).
7. Execute: bắn lệnh qua Jito protected chống frontrun.
8. Manage: nuôi theo thang chốt lời / cắt lỗ.

Solution v2 sau feedback: múc immediate ngay khi qua Qualify, bỏ chờ 30 phút; stop theo ATR clamp(2 x ATR(1h,14) / giá, 8%, 40%); time-stop 24h không chạm TP1 thoát 50%; kill-switch vault -15%/tuần và -5%/ngày; cap 2 lớp per-trader 20% budget và per-mint 2% NAV; kế toán epoch queued → settled; fallback matrix cho RPC / giá / RugCheck / execute / oracle.

## 7. Quản trị vị thế

Nguyên tắc: Size first. Stop losses second. Profits third.

Entry 2 cửa trong tối đa 30 phút: momentum tăng từ 10% trên giá trader khớp, hoặc pullback giảm 10% từ đỉnh hậu tín hiệu. Hết giờ → Skip, không FOMO.

Thang chốt:
- -50% stop → cắt toàn bộ. Stop là trigger, không đảm bảo khớp đẹp.
- +60% TP1 bán 40%, còn 60%.
- +100% TP2 bán thêm 40%, tổng đã chốt 64%, còn 20% runner.
- Sau TP2, mỗi +50% dời stop khóa thêm +25%.
- +150% thoát runner, +300% thoát sạch.

5 cầu dao full-exit, gặp một là thoát hết: trader xả trên 50% vị thế; thanh khoản bị rút hoặc unlock; RugCheck xấu đi; mất route khớp; price impact vượt ngưỡng.

Bản ladder triển khai trong engine: TP1_SHARE 0.5, TRAIL 20%, TP2_MULT 2x, TIME_STOP 24h. Hàm evaluateManage: giảm sâu hơn stop → STOP_HIT; tăng vượt tp1 → TP1_HIT; còn lại HOLD. Thứ tự xử lý mỗi tick: STOP toàn bộ remainder theo giá market → TP1 theo giá target entry x (1 + tp1) → TP2 toàn bộ remainder theo target2 khi move đạt tp1 x tp2Mult → TRAIL khi đã TP1 và move tụt khỏi đỉnh quá trailPct → TIME_STOP khi quá 24h. Mỗi leg ghi CopyOrderLeg gồm leg TP1/TP2/STOP/TRAIL/TIME, fraction, exitPriceUsd, realizedPnlUsd. Đóng hết remainder thì chốt order với closeReason tương ứng. Mỗi order cho phép override tp1ShareBps, trailPct, tp2MultPct.

## 8. Tuyển chọn và lọc tín hiệu

Chuẩn production: Realized PnL 30d trên $15k, Win-rate trên 58% với tối thiểu 30 lệnh, Wash-score dưới 0.05, Liquidity trên $80k, Max slippage dưới 2.5%. Copy delay, execution venue, price impact đều log vào Trade Audit Ledger.

ATR regime từ DataStream FluxBeam: atrFraction = ATR(14) / close với TR = max(h-l, |h-pc|, |l-pc|). suggestStopPct = clamp(2 x ATR, 8%, 40%). tp1Pct = min(120, max(20, stop x 2)). trailPct = min(30, max(10, stop)). regime calm dưới 1%, normal 1-3%, wild trên 3%. Trả null khi dưới 15 nến. Engine tự điền stop/tp còn thiếu và ghi tuneNote gồm atr-regime, fallback-no-candles, feed-error, fixed-defaults, explicit-params. Mặc định 60/30 khi không có dữ liệu.

RugCheck: GET report theo mint, cache 24h. Verdict gồm score, rugged, riskNames, topHolderPct, liquidityUsd. Chế độ strict mặc định chặn khi rugged hoặc riskNames vượt ngưỡng; lenient ghi verdict và tiếp tục.

## 9. Thực thi kép Titan + Phoenix

- Phoenix CLOB: SOL/USDC và majors, orderbook sâu, 0% maker, dưới 100ms, atomic single-slot.
- Titan Argos Meta-DEX: gom Jupiter + Raydium + Meteora + OKX cho memecoin Pump / Raydium CPMM / Meteora DLMM, win-rate quote 87%, Prime Mode, gửi Jito Bundle kèm tip tự động.

Logic chọn: có Phoenix market đủ depth → Phoenix, ngược lại → Titan quote kèm mevProtection.

Jupiter quote read-only qua lite-api, validate outAmount. Proof devnet: transfer dust 0.0001 SOL tự gửi cho chính mình, confirm ở mức confirmed. Chỉ chạy devnet, kiểm tra genesis hash, từ chối mainnet.

Copy sizing khi có epoch: solPrice từ bulkPrices WSOL; navUsd = navSol x solPrice; sizedCap = min(maxUsd, navUsd x 1%, 0.1 x solPrice). Chưa có epoch thì dùng maxUsd. Dynamic allocation: nếu master thuộc vaultTrader active thì share = weightBps / total, traderCap = sizedCap x share; thiếu weights thì fail-open full budget. copyUsd = min(masterUsd, cap) — tự scale nhỏ, không từ chối. Drag guard từ chối khi delayDragPct trên 25. Exposure 24h: mỗi trader tối đa 3 lệnh, mỗi mint tối đa 2 lệnh. Slippage gate mặc định 50 bps.

Allocation rebalance: score = 0.6 x winRate + 0.4 x pnlRank. winRate tính khi đủ 3 mẫu, ngược lại 0.5 để chống nhiễu. weight = round(score / total x 10000), kẹp trong 500..4000, vault 1 trader nhận 10000, chênh lệch bù dần cho trader còn biên đến khi tổng bằng 10000. Rebalance manual-first, quét orders đóng 30 ngày, cập nhật weightBps và audit.

Auto-fire: mỗi 5 phút quét BUY mới có tokenMint trong cửa sổ 1..120 phút, tối đa 10 lệnh mỗi tick. Chỉ fire cho bot mode AUTO đầu tiên mà vault chứa ví master. Dedupe theo masterTxHash. Gọi executePaper với entryMode immediate, tp1 60, stop 30. Ghi audit theo bot. Bản watch-signals là dry-run in trạng thái WOULD-FIRE / SKIP, không ghi DB.

Shadow momentum backtest: quét high/low sau tín hiệu trong 1800s, đo hit +10%, minutesToHit, maxAdversePct, hit -10%. Kết quả mẫu 25 BUY: hit 52%, median 0.9 phút, MAE -14%, ủng hộ entry-immediate và lấy pullback làm leg 2.

Flag manipulation: nhóm theo ví và symbol 30 ngày, phát hiện BUY bơm từ 20% đến 5000% rồi SELL từ 50% lượng đã mua, notional tối thiểu $20 mỗi chiều, loại stablecoin, basisAge trong 2h. Từ 2 sự kiện đánh dấu suspect. Mặc định dry-run, cờ --write mới ghi vào ownerNotes, không tự disable.

## 10. Phí và flywheel

20% trên new net profit above HWM. No management fee. Chia 80% depositors, 15% partner trader, 5% Edgepool.

Ví dụ NAV 10 → 11 SOL, lãi mới 1.00: +0.80 depositors, +0.15 partner, +0.05 Edgepool.

Vòng tròn: Trader partners → Promotes vault → Followers deposit → Performance builds ranking → More traders join.

Spec rộng ghi 10-15% trả Master cộng treasury dự phòng; sample Product UI ghi 0.8% mgmt + 10% perf dùng làm placeholder. Số chốt cho landing là 20% theo deck.

Phí chỉ thu khi vượt đỉnh cũ, áp dụng HWM.

## 11. Lộ trình

NOW Prototype: tracking, portfolio, RugCheck, copy execution.
NEXT Single-trader: vault-share accounting, sizing validation, onboarding, live fill data.
LATER Multi: baskets 24h / 3d / 7d, consensus entry-exit, user-created vaults, mobile.

Traction hiện tại: prototype, chưa claim users, deposits hay revenue.

Hướng on-chain khi sẵn sàng: Anchor program riêng giữ fee/HWM/epoch, SPL share mint decimals 9, PDA vault, shares, treasury. Accounts Vault gồm manager, share_mint, treasury, nav_lamports, shares_supply, hwm_price, fee_bps, epoch, paused. Lệnh initialize, deposit ghi pending, settle_epoch mint/burn theo giá settle, execute_copy qua Jupiter CPI/Phoenix, pause/unpause kill-switch ngày -5% tuần -15%, collect_fees split 80/15/5. Kế hoạch: off-chain xong → skeleton + local validator → devnet đối chiếu → audit ngoài + fuzz → mainnet.

## 12. Vai trò và vòng đời hệ thống

Bốn trụ cột: FOMO Harvester & Resolver, Solana Smart Vault Core, Dual Execution Router Titan + Phoenix, Web App Live Dashboard.

Vai trò:
- Depositor: nạp USDC/SOL nhận vSHARE (SPL), rút gốc cộng lãi bất kỳ lúc nào theo pro-rata.
- Master / Partner Trader: ra tín hiệu, nhận 15% perf fee, đồng thời là kênh phân phối.
- Execution Delegate / Backend bot: được ủy quyền swap và route lệnh.
- Admin / Governance: bật tắt copy trader, emergency pause, circuit breaker.
- Edgepool protocol: nhận 5% perf fee.

Vòng đời một vault: Deposit mint vSHARE theo NAV lúc đó → Ingest tín hiệu qua SSE FOMO, FOMOScan 60s, Geyser gRPC dưới 80ms → Filter Anti-Sybil → Route Titan/Phoenix kèm Jito → Portfolio tối đa 10 tokens, mỗi lệnh tối đa 5% NAV theo spec rộng → TP/SL động kèm Trade Audit Ledger → NAV update mỗi 10s → Withdraw đốt vSHARE lấy USDC → Emergency Pause khi cần.

Treasury và NAV: NAV = tổng token holdings x Oracle Pyth/Switchboard cộng USDC cash. Share Price = NAV / total vSHARE.

Rủi ro trong spec: allocation tối đa 5% mỗi lệnh, stop cứng -8% mỗi vị thế, trailing TP kích hoạt +25%, circuit breaker -15% NAV mỗi giờ → pause, hủy lệnh Phoenix, xả memecoin về USDC qua Titan, alert Telegram/Discord.

Hạ tầng đề xuất: microservices Node.js TS cộng Rust ký và tính toán, Redis Streams/BullMQ, RPC Helius/Triton/QuickNode cộng Yellowstone gRPC, scheduler NAV 10s. Postgres/Timescale gồm fomo_master_traders, vault_portfolio, trade_history với tx_signature, master_handle, execution_venue, slippage_bps, copy_latency_ms, realized_pnl, vault_nav_history dạng hypertable.

## 13. Backend

### 13.1 Stack và cấu hình

NestJS 12 + Express 4 + Prisma 7 + Postgres + @solana/web3.js 1.99. Không test-runner, kiểm chứng bằng assert tsx với DB mock.

Cấu hình tập trung duy nhất: PORT 3000, SOLANA_RPC_URL mainnet, LANTERN_URL read-cache, HELIUS_API_KEY, JITO_BLOCK_ENGINE_URL, VAULT_PRIVATE_KEY, COPY_TRADE_PAPER_ENABLED mặc định false, COPY_TRADE_MAX_USD 100, DEVNET_RPC_URL, APP_URL, GEMINI_API_KEY, POSTGRES localhost 5433. Không log object cấu hình.

Solana config: commitment confirmed, poll 8s, SSE heartbeat 15s, sync 20s. Read RPC ưu tiên LANTERN, WS luôn dùng RPC chính. Che api-key/token/key khi log URL.

Schema Postgres: tracked_wallets với allocationWeight, winRate, cumulativePnlUsd; transactions với signature PK, action BUY/SELL/TRANSFER/UNKNOWN, amountToken, amountUsd, dexVenue, slippageBps, feeSol; realtime_events; copy_orders lifecycle PENDING → QUATED → SENT → CONFIRMED hoặc FAILED, mode paper, kèm entryMode, delayDragPct, tp1Pct, stopPct, ladder tp1ShareBps/trailPct/tp2MultPct, shadow entryPriceUsd/peakPriceUsd/exitPriceUsd/closeReason/closedAt/realizedPnlUsd; copy_order_legs unique theo orderId và leg; vaults với feeBps, hwmSharePrice, totalShares, reserveBps/withdrawFeeBps/lockHours, treasurySol, settlePeriodHours/settleLengthMin, environment SANDBOX/PRODUCTION; vault_deposits QUEUED/SETTLED; vault_withdrawals; vault_epochs; users với role USER/KOL/ADMIN; auth_nonces TTL 5 phút; sessions token SHA256 TTL 7 ngày; audit_logs append-only; vault_traders unique theo vaultId và wallet; bots mode AUTO/PAUSED.

### 13.2 Xác thực và phân quyền

Luồng: POST nonce với ví trên 32 ký tự → validate base58 → cấp nonce hex 24 byte TTL 5 phút kèm message Sign to log in to FOMO Fund. POST verify với ví và chữ ký → tìm nonce mới nhất chưa dùng, hết hạn hoặc sai chữ ký ed25519 trả 401, consume nonce, findOrCreate USER, ví đầu tiên trong ADMIN_WALLETS thành ADMIN khi chưa có ADMIN, cấp token hex 32 byte lưu SHA256 TTL 7 ngày, trả body kèm httpOnly cookie fomo_session Path /, Max-Age 7d, SameSite Lax.

Guards: AuthGuard 401 khi thiếu/sai/hết hạn và gắn req.user; OptionalAuthGuard gắn nếu có nhưng không chặn, dùng cho deposit/withdraw legacy; RolesGuard 401 khi chưa login, 403 khi sai role. Validate DTO gọi thủ công vì tsx/esbuild không emit decorator metadata.

Users: findOrCreate, list, setRole. Audit: record actor/action/target/reason/metaJson và list theo actor/action/limit 1..100. Decorator Audit ghi sau khi handler thành công, target lấy từ params wallet/id/address, reason từ body.reason, bỏ qua anonymous, lỗi audit không phá vỡ nghiệp vụ. Không update/delete audit.

Health: GET /api/health trả ONLINE, service, rpcEndpoint đã che, heliusEnabled, activeWalletsCount, timestamp.

### 13.3 Copy-trade execute

POST /api/copy-trade/execute. Bản legacy trả sim với vaultTxHash/jitoBundleId/slot/copyDelayMs 68-93ms/slippage 6/CONFIRMED. Bản paper yêu cầu mode paper, confirm true, maxSlippageBps 1..10000, paperAmountSol 0.000001..0.01, entryMode immediate/scaled/patient, tp1Pct, stopPct 1..90, ladder tp1ShareBps/trailPct/tp2MultPct, autoTune mặc định true.

Luồng executePaper: kiểm tra gate paperEnabled/confirm/maxUsd → sizing theo NAV → dynamic allocation theo weightBps → ATR auto-tune điền field thiếu → drag guard → exposure caps → tạo row PENDING → kiểm tra devnet → qualify RugCheck và mcap tối thiểu 50000 USD → quote Jupiter SOL→USDC kèm qualify/liquidity/sized/alloc → slippage gate so priceImpact với maxSlippage → proof dust devnet chuyển SENT → CONFIRMED. Thất bại ghi FAILED kèm error tối đa 500 ký tự. GET history lọc theo wallet limit 100. POST auto-fire/tick và manage/tick cho ADMIN. POST allocation/rebalance cho ADMIN.

### 13.4 Demo Simulator

Trigger thủ công của ADMIN trên sandbox, tag demo để tách khỏi live.

POST seed: lấy N ví active, tạo vault demo kèm weights tổng 10000, tạo bot demo, deposit và settle giá 1, audit demo.seed. POST replay: lấy BUY có mint theo blockTime, cap 3 mỗi ví, executePaper strict false maxUsd 10M không broadcast, chạy manage.tick, force close phần còn lại theo giá spot, tính demoRealized quy ra SOL, deposit 20 và settle, giữ một withdrawal QUEUED pending. POST reset: xóa vaults/bots/orders/legs/deposits/withdrawals/epochs/traders có prefix demo, giữ audit và ghi demo.reset. GET bot performance: gộp orders theo bot, trả orders/open/closed/wins/losses/winRate/totalRealizedUsd/equity.

### 13.5 Wallets, onchain, sync

Wallets: Postgres là source of truth, sync Map listener. Khởi động seed 10 master nếu trống gồm Unipcs, point farm capital, DumbCrayonEater, The Solstice, Salem, Vee, AJC, frank, Nate, Frogman kèm PnL all-time và avatar. CRUD GET/POST/DELETE/PATCH, validate PublicKey, watch/unwatch WS ngay.

Onchain: pipeline WS → fetch 10 signatures → dedupe → enrich → persist → realtime_events → SSE. Sự kiện quá 15 phút không fan-out. GET /api/onchain/events lọc wallet limit 100. SSE CONNECTED rồi ONCHAIN_SWAP_EVENT kèm PING 15s. Webhook Helius verify secret, khớp counterparty ví tracked, ingest bất đồng bộ và ACK nhanh.

Helius: parseTransactions tối đa 100 mỗi call concurrency 4, token meta qua DAS getAsset cache 5 phút, fallback DexScreener rồi Jupiter v3. Enrich xác định hướng từ fund-flow, ưu tiên định giá chân SOL, SOL-only là TRANSFER, map venue pump/raydium/orca/phoenix/jupiter, dựng copySignal với canCopy khi SUCCESS, isCopyEnabled và không UNKNOWN, kèm recommendedVenue, estimatedDelayMs 65 cộng slot mod 70, targetSwap bằng amountUsd nhân allocationWeight.

Sync safety-net 20s: backfill khi boot không chặn, mỗi ví sync 120 ngày tối đa 1000 tx, heal bản ghi thiếu USD dưới 2 lần thử theo batch 200 kèm nến 1H, paginate newest→oldest dừng ở known/cutoff/cap, chỉ publish live bản fresh.

Transactions: dedupe PK, advance lastScannedSlot/Signature/totalTradesCount, query ledger mặc định chỉ BUY/SELL, getRange tối đa 100k cho PnL/chart.

### 13.6 Portfolio, market, bots

Portfolio: GET transactions với wallet ALL hoặc địa chỉ cụ thể, page/pageSize tối đa 2000, action, days tối đa 3650, hideZero. GET pnl yêu cầu ví cụ thể, GET pnl/overview, GET holdings.

PnL FIFO theo mint để chống scam clone ticker: cost full-history, chỉ cặp đóng trong window tính realized/pairs/series/perSymbol, bỏ dust SELL dưới $1, bỏ SELL không basis. winRate bằng cặp lãi trên tổng cặp, top 5 swaps lớn nhất.

Holdings: SOL cộng SPL và Token-2022 qua Lantern read, gộp theo mint sort balance, giá tối đa 150 mints top qua DataStream bulk trước Helius/DAS fallback, dust tail liệt kê không giá.

Market proxy giữ key ở backend: GET ticks CoinGecko BTC/ETH/SOL/USDC kèm change24h, lỗi trả stale; GET prices tối đa 50 mints qua DataStream bulk.

Bots record-only: GET list, POST tạo yêu cầu name và vaultId tồn tại mode AUTO, POST set mode AUTO/PAUSED, response luôn environment sandbox, audit bot.create/set_mode. Logic chạy nằm ở auto-fire và manage.

Tx parse thuần RPC không Helius: getTransaction jsonParsed cộng chênh lệch pre/post balance và giá DataStream, venue soi log jupiter/phoenix/titan/raydium/orca/pump. Solana transport retry 4 lần backoff 500 x 2^attempt ms. Stream onLogs mỗi ví kèm watchdog 30s resubscribe khi quiet quá 120s.

## 14. Frontend Terminal

### 14.1 Kiến trúc

Next.js 16 Turbopack + React 19 + Tailwind v4 + Phosphor Icons. Một route duy nhất / là tracker dashboard. Quy ước app chỉ routing, UI tái dùng ở components, fetch ở lib, shape ở types. Cấm import từ backend, contract duy nhất qua openapi.yaml và lib/api.ts.

Dev frontend port 3001, rewrite /api sang BACKEND_URL mặc định http://localhost:3000. lib/api.ts dùng NEXT_PUBLIC_API_URL rỗng để single-origin, chỉ set khi cross-origin thật. Docker gồm postgres 17 host 5433, backend 3000, frontend 3001, lantern và cloudflared opt-in.

Layout shell metadata edgepool — Automated Solana vaults, favicon /brand, lang vi, nền #161826.

### 14.2 Bố cục 3 cột

FomoHeader gồm brand edgepool, smart-search, Live/Sync, bell, cash demo, tracked value. DemoBanner SIMULATED no real funds. FomoLeftSidebar, main TraderProfile, FomoRightPanel. FomoBottomTicker giá BTC/ETH/SOL/USDC.

State: wallets, selectedAddress, range 30d, swapsTab, swapsPage, showZero, liveSwaps, pnl/pnlMap, holdings, notifications 30, hiển thị panel.

Luồng: boot restore session, listWallets auto-chọn ví top PnL, pnlOverview 120 ngày poll 60s, portfolio table 25 poll 30s và chart 1000 poll 60s, nạp pnl và holdings khi đổi ví. Chọn ví dùng viewTransition, reset liveSwaps và page. Live lọc backfill theo bootAt, prepend notifications và liveSwaps đúng ví đúng page 1, throttle refresh ledger 5s, không refresh pnlOverview vì FIFO nặng. Merge hiển thị dedupe liveSwaps và portfolio tối đa 25 dòng cho bảng, full cho chart.

### 14.3 API client và realtime

fetchJson và fetchJsonAuth Bearer kèm cookies. Ánh xạ: health, wallets CRUD, portfolio transactions/pnl/overview/holdings, onchain events, copy-trade execute/history, vaults status/deposit/withdraw/list/create/traders/policy, bots list/create/mode/auto-fire tick, auth nonce/verify/me/logout/users/role/audit, market ticks. Session lưu localStorage fomo.session gồm token và expiresAt.

SSE qua EventSource /api/onchain/stream, parse CONNECTED và ONCHAIN_SWAP_EVENT, tự retry khi lỗi. Hook useOnchainStream giữ callback ref chống stale closure. Hook usePortfolio SWR in-memory key theo wallet/page/size/action/days/hideZero, stale-while-revalidate và poll. Hook useMarketTicker poll 60s qua backend proxy, fallback snapshot, stale khi quá 3 phút.

### 14.4 Đăng nhập ví và component chính

lib/solana.ts không thêm dep, dùng window.solana của Phantom/Solflare, connect lấy address, sign message bằng TextEncoder và base58 tự viết.

AuthPanel 3 flow: sign bằng ví trình duyệt qua nonce → ký → verify → lưu session; manual nhập address lấy message rồi dán chữ ký Base58; dev dán token rồi gọi me. Logout best-effort rồi xóa session.

FomoHeader tìm kiếm theo label/handle/address tối đa 7 kết quả kèm PnL. FomoLeftSidebar tabs alerts/tokens/leaderboard/feed, chỉ leaderboard thật, form Add address/label/weight, list sort theo realized khi có pairs ngược lại seed PnL, badge rank, Follow, xóa confirm. TraderProfile trung tâm gồm avatar/handle/Solscan/copy/share/Follow, pills hero, top-5 carousel, hero PnL kèm PnlChart, Positions từ holdings tokens có Show dust, ThesisCard, SwapsTable. PnlChart canvas DPR-aware cao 230, nội suy monotone cubic Fritsch-Carlson, gradient fill, now-line đứt nét, hover crosshair tooltip, downsample còn 800 điểm. SwapsTable tabs all/buys/sells, grid Token/Action/Amount/Venue/Time, link Solscan, Hide $0, phân trang. FomoRightPanel card Send UI-only, Copy Next Trade mở CopyConfirmModal, positions 5 tokens, CopyHistory, VaultCard. CopyConfirmModal preview Trader/Signal/Notional/Venue, nhập paperAmountSol và slippage, gọi executePaperTrade, hiện CONFIRMED và devnetSignature link explorer. CopyHistory 10 lệnh poll 60s badge PENDING/QUATED/SENT/CONFIRMED/FAILED. VaultCard tự nạp status vault 1 poll 60s, hiện Share/HWM/Queued/policy, nút queueDeposit/requestWithdraw. NotificationsBell 30 alerts ACTION SYMBOL $, click nhảy ví. AdminPanel tabs users/audit/vaults/bots/engine, UI chặn non-ADMIN, auth thật ở backend. ThesisCard summary dẫn xuất kèm like local. FomoBottomTicker giá và %24h, cached khi stale. WalletAvatar ảnh thật ngược lại initial tím.

lib/format.ts gồm formatUsd/UsdSigned/CompactUsd, shortSignature/Address, timeAgo, formatDateTimeShort/Full vi-VN. Types onchain mirror backend gồm TrackedWallet, OnChainTransactionEvent với dex Phoenix/Titan/Raydium/Orca/Pump/Native/Jupiter và copySignal, CopyOrder mode paper. Types fund gồm FundUser, AuthNonce/Session, AuditLog, VaultTrader/Policy, Bot, AutoFireTickResult.

## 15. Kiến trúc tổng thể và vận hành

```
Solana Mainnet-Beta RPC/WS confirmed
→ backend NestJS: health, wallets, portfolio, onchain SSE, copy-trade, market, vaults, auth, audit
→ server solana.service singleton + config + common + Prisma
→ HTTP REST + SSE theo openapi.yaml
→ frontend Next.js: layout, page, components, lib, hooks, types
```

Data flow: poll loop 8s sample 2 ví mỗi cycle lấy 3 signatures mới nhất tới lastSig rồi tạo event và phát SSE; portfolio ledger GET wallet ALL limit 25 duyệt 10x25 = 250, mỗi ví lấy signatures rồi map event, thiếu bù fallback 88 ký tự, sort slot desc; SSE CONNECTED rồi ONCHAIN_SWAP_EVENT kèm PING 15s; wallets CRUD validate PublicKey và listen ngay; copy-trade sim trả random vaultTxHash và CONFIRMED, paper mở rộng Jupiter quote và dust devnet proof lifecycle đầy đủ.

Data layer split đã verify live: FluxRPC EU đọc head/WS/send; Helius history backfill và DAS vì ledger Flux chỉ giữ khoảng 70s; Lantern read-path cached holdings không dùng cho sub vì chết WS; DataStream keyless prices/candles/ATR/shadow; CoinGecko keyless qua backend proxy; RugCheck Qualify gate.

ADR-001 tách FE/BE rõ ràng và spec-first: frontend Next App Router, backend NestJS modular, docs chuẩn plugin, giữ server cũ chạy được và deprecated, openapi là contract duy nhất. Không big-bang rewrite gãy demo, không giữ monolith, không Turborepo thừa.

Local: Node từ 20.19, copy backend/.env.example và frontend/.env.example, npm i từng bên, docker compose up postgres, backend tự migrate và seed 10 masters, chạy backend 3000 và frontend 3001, smoke health, portfolio limit 2, SSE, typecheck/build. Biến backend qua configuration duy nhất gồm SOLANA_RPC_URL, PORT, HELIUS_API_KEY, JITO_URL, FLUXRPC, DATASTREAM, RUGCHECK, VAULT_PRIVATE_KEY, POSTGRES, DATABASE_URL. Biến frontend public gồm NEXT_PUBLIC_API_URL trống là same-origin và BACKEND_URL.

Docker: compose build gồm postgres 17 map 5433:5432 kèm pg_isready, backend chạy node dist/main.js kèm migrate deploy, frontend next start port 3001 với BACKEND_URL http://backend:3000, lantern và cloudflared opt-in. Logs compose logs -f, down giữ data cấm -v, smoke 3000/health và 3001/health, 3001 đỏ là sai BACKEND_URL.

DESIGN spec UI tái lập fomo.family: viewport-locked 100vh overflow-hidden, tokens #07080c/#0f1119/#00e676/#7022ff, fonts Plus Jakarta và JetBrains Mono tabular-nums, layout Header 56px + Left 330px + Center flex-1 + Right 320px + Ticker 32px, SVG glow chart, JSON mock schema.

## 16. Nhận diện cho landing page

Ý tưởng: calm, precise, accountable. Single signal colour, constructed mark, numbers as main content. Nền Nocturne dark.

Màu lấy từ support.js, không hard-code lẻ:
- Midnight #161826 45% foundation, Abyss #0D0F18 10% deepest cho icon/social, Surface #232532 15% cards, Slate 500 #9397AB 6% secondary text, Slate 800 #3F424D 4% borders, Cool White #E9E9ED 12% primary text contrast 14.5:1 trên Midnight, Edge Aqua #49E6D7 6% signal duy nhất cho dot/lead line/primary action/focus 11.4:1, Aqua Deep #00968B cho dot/line trên nền sáng, Signal Violet #9184D9 2% secondary series/benchmark/tags.
- Aqua ramp 100 #E0FCF8 tới base 400 #49E6D7 tới 600 #00968B tới 900 #032D2A. 900-800 cho fills/badges, 100-300 cho text trên tints.
- Trạng thái chỉ dùng cho UI, không dùng cho logo: Gain #73DEA4, Loss #F28881, Caution #F0BE67. Luôn kèm icon +/− và label, không dùng màu đơn độc. Risk scale slate → amber → coral, không dùng Aqua.
- Tokens Nocturne: bg #161826, surface #232532, text #e9e9ed, accent blurple #9184d9, radius 4/8/14, border 1px #3F424D, shadow tuned dark.

Typography toàn bộ open-source OFL:
- Display Inter Tight Medium 500 cho Headlines. Hero 64/1.04 -3% Follow every trade on-chain. Section 32/1.15 -2%.
- UI/body Inter Regular 400 và Medium 500. Body 15/1.55 #CFD3E5, Button 14/1.2 Aqua, Label 11 +8% caps #9397AB.
- Numeric JetBrains Mono tabular. Perf 40 cho Gain/Loss, Address 13 #B2B6CA dạng 7xKX...gAsU slot 291,044,812.

Logo The Edge E: 1 nét liên tục 6u round caps, bo 10u trên grid 40x40, Basin là pool cộng Follower arm dừng ngắn cộng Edge dot đường kính 6u hở 3u màu Aqua duy nhất. Đọc là E trước, pool sau. Lockups gồm horizontal-dark mặc định, stacked cho ô vuông, symbol cho app/avatar/in-product, wordmark only, small-size symbol dưới 24px dot nhập thành full Aqua arm, one-colour black/white, grayscale chỉ SVG, Powered-by lockup/badge. Wordmark custom lowercase edgepool monoline x-height 21%, bowls lặp như basin, không retype, không EdgePool, running text Title Case Edgepool vaults. Clear space bằng x là chiều cao chữ o, symbol bằng nửa width. Min horizontal 96px/25mm, stacked 64px/18mm, symbol tối thiểu 24px/6mm. Cấm recolour dot, stretch, shield/hexagon, glow/gradient/bevel, rotate, đặt trên Aqua/low-contrast, pair với $EDGE pump 100x.

Motif và đồ họa: Flow motif routes converge 1 Aqua 2px + slate 1.25px + dot, chỉ dùng hero không làm texture sau data. Pool contour pattern opacity 3-7% tile 96-160px. Icons Phosphor Regular 20/24px round, neutral 300 mặc định Aqua chỉ active. Charts chỉ gridlines ngang, vault Aqua kèm dot, compare Violet/slate thứ tự Aqua400 Violet500 Slate400 Slate600. Surfaces ground → surface → elevated. Gradient chỉ one-hue depth/chart fills/fading rules, không gradient hues/type/logo. Motion Pending segment travels + dot breathes, Confirmed E draws + dot lands 1.6s ease-in-out. Minh họa diagrammatic lines routes/basins/splits + Aqua path, cấm characters/coins/rockets/3D/stock crypto, ảnh nền tối lighten blend.

Voice và messaging: Primary Automated Solana vaults powered by performance-ranked traders. CTA Explore vaults, View traders, Review performance, Deposit into vault. Points automated execution, transparent history, non-custodial, clear risk controls. Principles Precise gồm numbers + periods/sources/dates, Plain gồm Allocate withdraw follow, Calm không hype, Accountable risk cạnh return cùng size. Dùng performance-ranked, selected traders, automated allocation, transparent on-chain, past performance. Cấm guaranteed, risk-free, passive income, moon, pump, 100x, can't lose. Mọi return kèm period và Past performance does not indicate future results.

Sample Product UI mang tính minh họa: Vault card Kestrel Momentum Vault Follows @kestrel Rank #3/142 Perps SOL TVL $2.48M 30d +6.82% MaxDD -9.4% Risk 3/5 Moderate 1284 depositors 0.8% mgmt 10% perf. Trader card @kestrel 7xKX…gAsU 90d +18.3% win 57% 412 trades avg hold 14h SOL-PERP JUP Trend following Following 14 mirrored last sync 12s. Metrics tiles, Risk 1 Conservative spot tới 5 High trên 5x. Deposit/Withdraw tabs Amount USDC Max, fee 0.000005 SOL, states hover/disabled, badges Active/Rebalancing/Paused/Withdrawals only/Closed. Modal Before you deposit lose part/all kèm I understand.

Social và exports: App icon 1024, avatar 400 circle-safe, favicon 16/32/48/180/512, powered-by badge, X header 1500x500 clear 400x200, OG 1200x630, announcement 1200x675, square 1080x1080, trader spotlight, vault launch, performance update. Exports svg/png/pdf horizontal/stacked/wordmark/symbol/small/powered-by kèm motif/pattern/loaders.

## 17. API hiện có

REST prefix /api: GET /health; wallets GET/POST/DELETE/PATCH; portfolio GET transactions/pnl/overview/holdings; onchain GET events và SSE /stream; webhooks POST /helius; copy-trade POST execute/auto-fire tick/manage tick/allocation rebalance và GET history; market GET ticks/prices; vaults GET list/status/traders, POST create/deposit/withdraw/settle/traders/policy; bots GET/POST/mode; auth POST nonce/verify/logout và GET me; users GET và POST role; audit GET. Contract duy nhất docs/api/openapi.yaml. Env cần SOLANA_RPC_URL, HELIUS_API_KEY, JITO_BLOCK_ENGINE_URL, VAULT_PRIVATE_KEY.

## 18. Tuyên bố rủi ro

Mọi số liệu hiệu suất kèm kỳ đo lường. Past performance does not indicate future results. Gửi vốn có thể mất một phần hoặc toàn bộ. Prototype chưa có người dùng, deposits hay revenue được tuyên bố.
