# Edgepool Vault — Solana Program System Design (v1)

> Trạng thái: **DRAFT chờ user review** (2026-10-13) · **patch v1.1** (min_payout, trần marks,
> reconciliation 3 tầng + funding policy — xem §4, §5.4, §7.5). Thay thế `VAULT_CONTRACT_DESIGN.md`.
> Intent: `docs/codexminimal/idsd/2026-10-13-solana-vault-program-intent.md`.
> Runtime mục tiêu: **devnet-first**, mainnet Jupiter **code-complete + feature-gate OFF**.

## 1. Mục tiêu & phạm vi

| # | Mục tiêu | Devnet | Mainnet |
|---|---|---|---|
| G1 | Vault giữ tiền (treasury PDA, program là authority duy nhất chi tiền) | ✅ | ✅ (khi bật) |
| G2 | Nạp/rút SOL: user ký + gửi tx từ ví; vSHARE = SPL mint decimals 9 | ✅ | ✅ |
| G3 | Copy-trade sim: BE chạy tín hiệu/ladder từ data mainnet; program lưu state tối thiểu + event audit | ✅ | ✅ |
| G4 | Trade qua Jupiter v6 bằng CPI từ program (SOL thật) | — | 🔒 gated |

Nguyên tắc xuyên suốt: **tối ưu byte/rent/tx**, không account thừa, không logic nào on-chain
mà BE đã làm tốt hơn (ladder/NAV pricing inputs), dual-mode không phá hệ thống off-chain.

## 2. Kiến trúc tổng thể

```
┌─ Off-chain (giữ nguyên, đã verified) ─────────────────────────────────────┐
│ BE NestJS: onchain tracker (mainnet signals) → copy-trade ladder (manage)  │
│            vaults module (off-chain pools) ── dual-mode                    │
│ New chain module: keeper | indexer | faucet | event mirror                 │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ keeper ops (marks/settle/pause/sim records) — BE key ký
               │ indexer: poll program events → mirror DB
               ▼
┌─ Solana (devnet; mainnet gated) ───────────────────────────────────────────┐
│ Program edgepool_vault (Anchor 0.31.1)                                     │
│  ├─ Vault (PDA, ~165B): params + marks + hwm + fee_credit                  │
│  ├─ ShareMint (PDA [shares]) ← vault_authority mint authority              │
│  ├─ Treasury (PDA [treasury], system-owned) ← giữ SOL                      │
│  ├─ VaultAuthority (PDA [authority]) ← owner ATA + signer CPI token/swap   │
│  └─ CPI: System → SPL Token → (mainnet) Jupiter v6 + WSOL ATA              │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ user-signed tx (deposit/withdraw) — ví Phantom/Solflare
               ▼
┌─ FE Next.js ───────────────────────────────────────────────────────────────┐
│ lib/chain.ts: connection devnet + Anchor client + IDL                      │
│ Deposit/Withdraw modal (chain pool) → wallet popup → sign & send → confirm │
└────────────────────────────────────────────────────────────────────────────┘
```

Luồng tiền duy nhất: SOL đi vào/ra qua `treasury` PDA. Program không giữ keypair —
mọi quyền hạn là PDA seeds + role (manager/keeper).

## 3. Account model (byte-optimized)

### 3.1 PDA map

| Account | Seeds | Loại | Ghi chú |
|---|---|---|---|
| `Vault` | `[b"vault", name≤24B]` | Program-owned, zero-copy | State duy nhất — không lưu Pubkey suy ra được |
| `ShareMint` | `[b"shares", vault]` | SPL Mint (classic) | decimals 9, mint authority = `VaultAuthority`, freeze = none |
| `Treasury` | `[b"treasury", vault]` | **System-owned** (0 data) | Escrow pattern; nhận/gửi SOL qua `system_program::transfer` với PDA signer seeds |
| `VaultAuthority` | `[b"authority", vault]` | PDA | Owner của mọi token account của vault; signer CPI |
| WSOL ATA | ATA(`VaultAuthority`, WSOL) | Token account | Tạo lazy ở lần swap đầu (mainnet) |
| Position ATA | ATA(`VaultAuthority`, mint) | Token account | Tạo trong tx buy (CPI associated_token create) |
| User share ATA | ATA(user, `ShareMint`) | Token account | User tự sở hữu |

Không có: queue PDA, epoch PDA, position state PDA (v1 — quyết định tối ưu byte; audit trail
= events + BE DB). Nếu mainnet cần enforce sâu hơn → thêm `Position` PDA ở v2 (đã chừa thiết kế).

### 3.2 Vault state layout (fixed-size Borsh — `#[derive(InitSpace)]`)

> Divergence v1: dùng account Borsh chuẩn thay vì zero-copy — mọi field đều fixed-size
> nên **byte size giống hệt** zero-copy; zero-copy chỉ là tối ưu compute (hoãn P5 nếu cần).
> Thêm field `keeper` (32B) — tách role keeper khỏi manager (design §5 ghi signer K nhưng
> bảng state cũ thiếu field; keeper set 1 lần lúc init, v1 không đổi được).

```rust
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub manager: Pubkey,        // 32B — ops authority (bootstrap: single key; mainnet: multisig)
    pub keeper: Pubkey,         // 32B — role keeper (BE hot key): marks/settle/sim records
    pub fee_sink: Pubkey,       // 32B — ví nhận perf fee đã collect (team treasury)
    pub total_shares: u64,      // 8B  — mirror của mint supply (raw, 1 share = 1e9)
    pub hwm_price: u64,         // 8B  — giá lamports/raw-share, scale = NAV*1e9/total_raw
    pub marks_lamports: u64,    // 8B  — giá trị keeper-pushed của positions (0 khi all-cash)
    pub marks_slot: u64,        // 8B  — slot lúc push (freshness — program tự lấy Clock)
    pub fee_credit: u64,        // 8B  — perf fee accrual chưa collect
    pub epoch: u64,             // 8B  — counter cho event EpochSettled
    pub fee_bps: u16,           // 2B  — perf fee (2000 = 20%)
    pub withdraw_fee_bps: u16,  // 2B  — phí rút (0 = tắt)
    pub reserve_bps: u16,       // 2B  — sàn thanh khoản, chặn payout làm NAV tụt dưới floor
    pub max_trade_bps: u16,     // 2B  — cap mỗi lệnh execute_swap (% NAV)
    pub max_marks_bps: u16,     // 2B  — trần marks so với cash (0 = tắt; sim devnet > 0) [v1.1]
    pub flags: u8,              // 1B  — bit0 paused
    pub env: u8,                // 1B  — 0 devnet | 1 mainnet (BẤT BIẾN sau init)
    pub bump: u8,               // 1B
}
// 96 + 48 + 10 + 3 = ~157B state (+8B discriminator = 165B) → rent ≈ 0.0020 SOL
```

Ghi chú byte-budget:
- Không lưu `share_mint`, `treasury`, `authority` (derivable) → tiết kiệm 96B.
- Không string; `name` chỉ tồn tại trong seeds + event `VaultInit`; tên hiển thị nằm ở BE DB
  (cho phép rename off-chain tự do — on-chain name bất biến theo PDA).
- Mọi tiền = lamports (u64); mọi ratio = bps (u16) hoặc scale 1e9 (u64); không float, không Decimal.
- `production_enabled` từng cân nhắc thành flag riêng — gộp vào `env` (env=1 chính là gate
  mainnet) + bắt buộc audit deploy; nếu cần belt-and-suspenders → thêm bit vào `flags` (0B thêm).

## 4. NAV, price & fee model

```
NAV_lamports   = treasury.balance + marks_lamports − fee_credit        (≥ 0, else revert NavInvalid)
price_scaled   = total_shares > 0 ? NAV * 1e9 / total_shares : 0      (u128, floor)
```

- **Deposit** (`amount` lamports): `minted_raw = total_shares == 0 ? amount : amount * total_shares / NAV_pre`
  (u128, floor). Bootstrap: 1 SOL → 1 share. Chuyển `amount` user → treasury trước, mint sau
  (thứ tự quan trọng: NAV_pre phải tính trước khi tiền vào treasury — dùng snapshot pre-instruction).
- **Withdraw** (`shares, min_payout`): `payout = shares * NAV / total_shares` (floor, lợi vault);
  `fee = payout * withdraw_fee_bps / 1e4` (ở lại treasury — lợi holders);
  `paid = payout − fee`. **Gate slippage: `paid ≥ min_payout`** — thấp hơn → revert `PayoutBelowMin`
  (chặn keeper hạ marks / giá trôi giữa lúc user bấm và tx execute; chi tiết §5.4).
  Ví nhận đúng `paid`, kèm event `Withdraw` ghi cả hai số.
- **Perf fee (touch-settle)**: chạy trong `deposit`, `withdraw`, `settle_epoch` — bất kỳ
  action nào chạm giá đều settle phí trước đó (khớp "auto-settle" off-chain):
  ```
  if price_scaled > hwm_price:
      fee = (price_scaled − hwm_price) * total_shares * fee_bps / (1e9 * 1e4)   // u128
      fee_credit += fee
      hwm_price = price_scaled_after_fee   // ratchet: max(cũ, mới sau phí)
  ```
- **collect_fees(amount)**: `amount ≤ fee_credit`; treasury → fee_sink (system transfer PDA-signed);
  `fee_credit −= amount`. NAV không đổi (cash giảm = credit giảm).
- **Reserve floor**: `withdraw` yêu cầu `treasury.balance − paid ≥ reserve_bps × NAV / 1e4`
  và treasury luôn giữ ≥ rent-exempt buffer (~0.00089 SOL) + `MIN_TREASURY_BUFFER`.
- **Trần marks (policy sim, patch v1.1)**: `max_marks_bps > 0` → `update_marks` từ chối khi
  `marks_mới > treasury_cash × max_marks_bps / 1e4` (`MarksCapExceeded`) — giới hạn "nghĩa vụ
  lãi mô phỏng" so với tiền thật (xem funding policy §7.5). Chỉ chặn lúc đẩy marks mới;
  không hồi tố, không chặn withdraw.

## 5. Instructions (v1)

Quy ước: ✅ = bắt buộc; `V` = Vault; `T` = Treasury; `M` = ShareMint; `A` = VaultAuthority;
`K` = keeper; `Mgr` = manager.

| # | Instruction | Signer | Accounts chính | Kiểm tra cốt lõi |
|---|---|---|---|---|
| 1 | `initialize_vault(name, fee_bps, withdraw_fee_bps, reserve_bps, max_trade_bps, max_marks_bps, env)` | Mgr | V, M, T, A, system, token, rent | name ≤ 24B; bps ≤ 10000; env ∈ {0,1}; tạo T rent-exempt, mint authority A |
| 2 | `update_policy(fee_bps, withdraw_fee_bps, reserve_bps, max_trade_bps, max_marks_bps)` | Mgr | V | bps bounds; không đổi env/manager |
| 3 | `set_paused(flag)` | Mgr (guardian sau) | V | bit0; withdraw không bị ảnh hưởng |
| 4 | `deposit(amount)` | **User** | V, T, M, user, user ATA, A, token, system | !paused; amount ≥ 0.5 SOL; freshness; touch-settle; mint = f(amount, NAV_pre); emit Deposit |
| 5 | `withdraw(shares, min_payout)` | **User** | V, T, M, user ATA, user, A, token, system | shares ≤ balance; freshness; touch-settle; **paid ≥ min_payout** (`PayoutBelowMin`); cash ≥ paid + floor + buffer; burn → transfer; emit Withdraw |
| 6 | `update_marks(marks_lamports)` | K | V | delta cap: \|new − old\| ≤ max_mark_delta_bps × NAV_cũ; trần `≤ max_marks_bps × cash` (nếu policy > 0); marks_slot = Clock.slot; emit Mark |
| 7 | `settle_epoch()` | K | V | touch-settle; epoch += 1; emit EpochSettled (nav/price/shares/fee) |
| 8 | `collect_fees(amount)` | Mgr | V, T, fee_sink, system | amount ≤ fee_credit; cash đủ; emit FeesCollected |
| 9 | `record_sim_trade(mint, side, size, price_scaled, pnl)` | K | V | env == 0 (devnet); emit SimTrade (~89B payload) — không state change |
| 10 | `execute_swap(amount_in, min_out, route_data: Vec<u8>)` | K | V, T, A, WSOL ATA, position ATAs, token, system, jupiter program + route accounts (remaining) | 🔒 env==1 + production + !paused + keeper; amount_in ≤ max_trade_bps × NAV; wrap → CPI → min_out verify (balance delta) → unwrap; emit SwapExecuted |

### 5.1 Freshness rule (fail-closed)

`deposit`/`withdraw`/`settle_epoch` khi `marks_lamports > 0` bắt buộc
`Clock.slot − marks_slot ≤ MAX_STALE_SLOTS` (mặc định 750 ≈ 5 phút) — nếu không → `StaleMarks`.
Khi `marks_lamports == 0` (vault all-cash, trạng thái demo phổ biến) bỏ qua freshness —
không cần keeper sống mới rút được tiền.

### 5.2 Mark delta cap (chống keeper lạm dụng)

`|marks_new − marks_old| ≤ max_mark_delta_bps × NAV_cũ` (const, ví dụ 2000 = 20%/lần đẩy).
Keeper vẫn là trusted element (memecoin không oracle) — cap + freshness + kill-switch + audit
là defense layers; ghi rõ trong threat model §8. Large move hợp lệ cần nhiều lần đẩy kế tiếp.
Ngoài delta cap, policy `max_marks_bps` (§4) giới hạn **tổng** marks so với cash thật.

### 5.3 execute_swap — luồng CPI Jupiter v6 (mainnet, gated)

```
BUY:  T →(system transfer, A-signed) WSOL-ATA → syncNative
      → invoke Jupiter (remaining_accounts + route_data)
      → out token về position ATA (owner = A)
      → assert balance_delta(out) ≥ min_out  → emit SwapExecuted

SELL: position ATA → Jupiter → WSOL-ATA (out) → assert delta ≥ min_out
      → closeAccount(WSOL-ATA, dest = T)   // unwrap
      → emit SwapExecuted
```

- `route_data` (Jupiter swap instruction data) truyền inline; route accounts qua `remaining_accounts`
  — tx có thể dùng ALT để nén; nếu route quá lớn (tx > 1232B sau nén) → **fail-soft, keeper skip,
  ghi log** (không retry vô hạn). Fallback v2: split route.
- Jupiter program id cố định trong code (const `JUP6LkbZ...`); check `program_id` của CPI target.
- MEV: BE gửi qua Jito bundle (JITO_BLOCK_ENGINE_URL) — ngoài program, ghi ở runbook.
- Không có daily-budget counter on-chain (tiết kiệm byte) — cap/ngày + rotation do BE enforce;
  on-chain enforce per-trade cap + NAV invariant + pause. Ghi nhận là gap có chủ đích (audit note).

### 5.4 Withdraw slippage guard — `min_payout` (patch v1.1)

User ký kèm `min_payout`; FE đặt = estimate tại thời điểm hiển thị trừ tolerance (mặc định 0.5%).
Program so `paid` thật với `min_payout` **sau** touch-settle; thấp hơn → revert `PayoutBelowMin`.
Bịt 3 kịch bản: keeper hạ marks ngay trước tx rút, giá trôi giữa estimate và execute, và
front-run đổi marks trong cùng slot. Đối xứng với `min_out` của `execute_swap` — mọi thao tác
đụng giá đều có guard phía người ký.

## 6. Events (compact — audit trail on-chain)

| Event | Payload | Bytes thô |
|---|---|---|
| `VaultInit` | vault, manager, fee_bps, env, name | ~80 |
| `Deposit` | vault, user, amount, minted_raw, price_scaled | ~88 |
| `Withdraw` | vault, user, shares, paid, fee, price_scaled | ~96 |
| `Mark` | vault, marks_lamports, slot | ~56 |
| `EpochSettled` | vault, epoch, nav, price, shares, fee | ~68 |
| `SimTrade` | vault, mint, side(1B), size, price, pnl(i64) | ~89 |
| `SwapExecuted` | vault, mint_in, mint_out, amount_in, amount_out, side | ~105 |
| `Paused` / `FeesCollected` | vault, flag/by, amount | ~40–70 |

Anchor event overhead: 8B discriminator + base64 (~33% log expansion) — chấp nhận; tối ưu
bằng batch keeper (nhiều trade records trong 1 tx nếu cần) và không thêm field thừa.

## 7. Integration off-chain (dual-mode, không big-bang)

### 7.1 DB (migration MỚI — không sửa migration đã apply)

- `vaults` + `chain_program_id VarChar(64)?`, `chain_vault VarChar(64)?`, `chain_env VarChar(10)?`,
  `chain_paused Boolean?` — null = pool off-chain (chạy như cũ).
- `deposits` / `withdrawals` + `chain_sig VarChar(96)?`, `chain_slot BigInt?` — link bản ghi mirror.
- **Bảng mới `chain_events`**: `id, signature, ix_index, event_index, vault_id?, program_id,
  kind, payload_json, slot, block_time, created_at` + `@@unique([signature, ix_index, event_index])`
  (idempotent indexer). Business rows vẫn là nguồn UI; `chain_events` là nguồn audit/replay.

### 7.2 BE module `chain`

| Service | Trách nhiệm | Cadence |
|---|---|---|
| `chain.config` | flags: `CHAIN_ENABLED=false`, `CHAIN_CLUSTER=devnet`, `PROGRAM_ID`, `KEEPER_KEY`, `MAX_STALE_SLOTS` | boot |
| `indexer.service` | `onLogs`(program) + backfill `getSignaturesForAddress`; parse event → `chain_events` + update mirror rows (deposit SETTLED, withdrawal SETTLED, epoch checkpoint) | realtime + 60s heal |
| `keeper.service` | push `update_marks` từ marks BE (positions MTM); `settle_epoch` cadence; kill-switch → `set_paused`; `record_sim_trade` khi ladder chạy (chỉ chain pool, env devnet) | 30–60s |
| `faucet.controller` | `POST /api/chain/faucet` — airdrop devnet SOL cho session wallet (genesis gate như paper-executor; rate-limit 1/24h + sàn tối thiểu để bơm thêm) | on-demand |
| pool detail | thêm block `chain: { programId, vault, price, marks, paused, env, explorerUrl }` khi chain-backed | read |

- Off-chain engine giữ nguyên cho pool cũ. Chain pool: BE **không** book deposit/withdraw off-chain
  (indexer book từ chain) — tránh hai nguồn ghi.
- `copy-trade/**` (protected) không sửa: keeper đọc dữ liệu qua interface hiện có (share via
  `common/` hoặc service call read-only) — nếu buộc phải sửa 1 dòng hook → xin approval riêng.

### 7.3 Config mới (protected — xin approval ở phase P2)

`CHAIN_ENABLED`, `CHAIN_CLUSTER`, `PROGRAM_ID`, `KEEPER_KEY` (base58, devnet-only),
`CHAIN_RPC_URL` (mặc định DEVNET_RPC_URL đã có), `MAX_STALE_SLOTS`, `JUPITER_SWAP_API_URL`
(lite-api, đã dùng cho quote), `MAINNET_SWAP_ENABLED=false`.

### 7.4 FE

- `lib/chain.ts`: connection (devnet), Anchor `Program` (IDL commit tại `frontend/lib/idl/`),
  derive PDA helpers, build+send deposit/withdraw qua ví user; poll confirm; map lỗi program → UI.
- Pool detail: chain pool → nút Deposit/Withdraw mở wallet flow (popup ví là điểm "trực quan");
  badge `ON-CHAIN · DEVNET`, explorer link (Explorer custom devnet), nút "Get devnet SOL" (faucet).
- Portfolio: số liệu vẫn từ API (mirror DB) — UI không đọc chain trực tiếp ngoài tx actions.
- Deps FE thêm: `@coral-xyz/anchor`, `@solana/web3.js` (khớp version với BE).

### 7.5 Sim ↔ Chain bridge & reconciliation (patch v1.1)

**Nguyên tắc gốc**: contract không biết gì về trade mô phỏng. On-chain chỉ có 3 loại sự thật —
SOL trong treasury (thật), shares (thật), marks (input keeper, có kiểm soát). Marks là **điểm
nối duy nhất** giữa thế giới paper (BE/DB) và chain.

**Chiều dữ liệu (không dual-write)**:
- Mô phỏng → chain: keeper đẩy `update_marks(Σ MTM paper positions)` + `record_sim_trade` cho
  từng trade — role keeper, delta cap 20%/lần, trần `max_marks_bps × cash`, freshness §5.1.
- Chain → DB: indexer parse events → mirror rows (deposits/withdrawals/epoch) + `chain_events`.
  BE **không** book deposit/withdraw cho chain pool (một nguồn ghi duy nhất).

**Đối chiếu 3 tầng**:

| Tầng | Ở đâu | Check chính |
|---|---|---|
| A · Trong tx | Program asserts | burn = shares yêu cầu; treasury delta = `paid` đúng từng lamport; mint supply = `total_shares` mirror; `paid ≥ min_payout`; sai bất kỳ điều kiện → revert (atomic, không state lửng) |
| B · Job `chain-reconcile` | BE, 60s + sau mỗi event | (1) `mint.supply == vault.total_shares == Σ DB minted − Σ DB burned`; (2) mỗi event có signature ↔ DB row `chain_sig` — **dùng số nguyên từ event, không tính lại** (chống drift rounding); (3) replay `Σ in − Σ out` từ `chain_events` == `treasury.balance` on-chain; (4) `NAV(DB) == treasury + marks − fee_credit` cùng slot; (5) thiếu event → backfill `getSignaturesForAddress`; lệch lớn → alert + cân nhắc kill-switch |
| C · User | Explorer + receipt | UI hiển thị receipt (signature, shares burned, price, payout); user tự verify account trước/sau trên explorer — không cần tin BE |

**Parity test**: cùng scenario chạy off-chain (`assert-vault.ts`) và LiteSVM (program) →
số khớp từng chữ số (trừ rounding floor ≤ 1e-9). Đây là khoá đảm bảo "BE nói gì = chain trả nấy".

**Funding policy cho devnet sim** (rủi ro: lãi mô phỏng không có cash thật backing):
- `max_marks_bps` giới hạn nghĩa vụ mô phỏng so với cash (ví dụ 5000 = marks ≤ 50% cash).
- BE top-up devnet SOL vào treasury định kỳ (faucet/airdrop) để cân nghĩa vụ — devnet SOL vô giá trị.
- UI pool demo ghi rõ: "lợi nhuận mô phỏng thanh toán từ quỹ devnet".
- Mainnet thật: positions là token thật; khi thiếu cash, keeper bán token qua Jupiter
  (`execute_swap` chiều SELL) để giải phóng cash rồi user retry — v1 fill-or-fail, không queue.

## 8. Security & trust model

**Trusted roles**: keeper (marks/sim records), manager (policy/pause/collect), BE fee payer ví faucet.
Không role nào rút được user funds: 
- Manager chỉ chuyển được `fee_credit` (đã accrual, ≤ phí thật đã tính) → fee_sink.
- Keeper không có đường chuyển SOL ra ngoài vault; swap chỉ đổi token trong ATA của vault
  và chặn bởi caps + min_out + pause.

**Threats & mitigations**:

| Threat | Mitigation |
|---|---|
| Keeper inflate marks → user rút hớ (inter-holder theft) | delta cap/lần + trần `max_marks_bps × cash` + freshness + audit + (mainnet) audit ngoài; worst case bounded bởi cash thực có |
| Keeper hạ marks đúng lúc user rút (front-run) | `min_payout` — user ký kèm ngưỡng nhận tối thiểu; thấp hơn → revert `PayoutBelowMin`, tx không đổi state |
| Lãi mô phỏng vượt cash thật (devnet) | trần `max_marks_bps` + funding policy §7.5 (top-up faucet, UI disclosure) |
| Fee collector lạm dụng | `amount ≤ fee_credit`; fee chỉ sinh khi giá > HWM |
| Swap route độc hại / slippage | program id cố định; min_out bắt buộc; per-trade cap; pause |
| Stale exploit (giá cũ) | freshness fail-closed khi có positions |
| Re-init / seed collision | Anchor `init` + PDA seeds; name unique theo PDA |
| CPI reentrancy | Không có reentrancy kiểu EVM; sau CPI luôn verify balance delta |
| Upgrade authority compromise | Devnet: single key (ghi rõ). Mainnet: **bắt buộc multisig (Squads) + audit trước khi bật** |
| Rent-exempt violation | Treasury buffer const; mọi account initialized rent-exempt |
| Overflow | u128 intermediates + checked math, revert `MathOverflow`; fuzz ở P5 |

## 9. Byte/rent/cost budget (ước tính)

| Hạng mục | Size | Rent (SOL) |
|---|---|---|
| Vault state | ~165B | ~0.0020 |
| ShareMint | 82B (SPL) | ~0.0015 |
| Treasury | 0B | 0 (system) + buffer 0.001 |
| Per user share ATA | 165B | ~0.002 (user trả) |
| Mỗi deposit/withdraw tx | 1 ix + ~2-3 CPI | fee ~0.00001–0.00002 |
| `record_sim_trade` | event-only | ~0.000005/tx |
| Mỗi lần keeper tick (marks + settle) | 1-2 ix | ~0.00001 |

So với thiết kế cũ (queue + epoch PDA + position accounts): tiết kiệm ~5 account/vault và
~3-4 account/user. Không PDA nào mới theo thời gian (epoch/queue) → chi phí phẳng, demo-friendly.

## 10. Testing & verification

| Layer | Công cụ | Phạm vi |
|---|---|---|
| Unit math | `cargo test` | bootstrap, mint/burn, HWM, fee, rounding, overflow, bounds |
| Integration | **LiteSVM** | full flows + negative (paused, stale, min deposit, reserve, not-keeper, mark delta cap, **marks cap**, collect over credit, insufficient liquidity, **min_payout revert**) |
| CPI boundary | LiteSVM + **mock Jupiter program** | wrap/buy/sell/unwrap, min_out fail, caps, pause — deterministic |
| Ghi chú build | `scripts/program-build.sh` | SBF **arch v2** (mặc định v3 từ cargo-build-sbf 4.4 không load được trong LiteSVM 0.7 — loader solana 2.3); devnet Agave 4.x nhận v2 bình thường |
| Reconciliation | BE assert + fixture | 5 check của job `chain-reconcile` (§7.5) trên fixture events; lệch giả lập → alert |
| Devnet e2e | tsx script (`scripts/chain/`) | deploy → init → faucet → deposit → marks → settle → withdraw; assert số dư + logs |
| Parity | litesvm vs `assert-vault.ts` (off-chain) | cùng scenario (loss-then-exit, HWM ratchet) → số khớp |
| Mainnet | dry-run script | build tx từ Jupiter quote thật (swap-instructions API), in base64 — **không gửi** |
| Regression | `npm run typecheck`, assert suites | off-chain pools không đổi hành vi |

## 11. Deployment, upgrade & vận hành

- Program keypair: tạo ở P0 cho devnet; không commit; mainnet keypair + Squads multisig quyết ở P5.
- Deploy devnet: `anchor deploy --provider.cluster devnet` → ghi program id vào `Anchor.toml`
  + BE config + FE config (public env).
- Upgrade authority devnet: key ops; mainnet: multisig + timelock (khuyến nghị) trước khi bật vốn thật.
- Runbook demo devnet: faucet → deposit → keeper marks → rút; runbook mainnet (P4): checklist
  trước khi bật `MAINNET_SWAP_ENABLED` (audit xong, multisig, caps review, Jito config, test $ nhỏ).
- Monitoring: indexer lag, keeper last tick, marks stale count, tx failure rate (log BE + audit table).

## 12. Phases (chuyển repo-phase-orchestrator để tạo plan + tracker)

| Phase | Deliverable | Exit criteria |
|---|---|---|
| P0 | Agave CLI, Anchor workspace, build xanh, IDL path, gitignore target | `anchor build` + `cargo test` chạy |
| P1 | Program core (ix 1–9) + events + Rust unit + LiteSVM đầy đủ | tests green + deploy devnet + e2e script green |
| P2 | BE chain module: migration, indexer, keeper, faucet, **reconcile job**, config (approval protected) | mirror DB idempotent + keeper tick thật + reconcile xanh + assert suites |
| P3 | FE chain client + user-signed modals + badges/faucet + demo e2e | click-through demo devnet với data mainnet |
| P4 | `execute_swap` + mock-CPI tests + dry-run + runbook; flag OFF | litesvm green + dry-run log + runbook review |
| P5 | Fuzz, threat-model doc, cost report, multisig/audit checklist | báo cáo + checklist hoàn tất |

## 13. Failure modes (bảng nhanh)

| Tình huống | Hành vi |
|---|---|
| Keeper chết | Marks stale → deposit/withdraw chặn khi có positions; all-cash vẫn hoạt động; kill-switch BE cũ vẫn chạy off-chain |
| RPC devnet chập chờn | User tx fail sớm (blockhash), UI retry; indexer heal 60s bắt kịp |
| Route Jupiter quá lớn | Keeper skip + log (fail-soft), không kẹt vault |
| NAV < 0 (mark âm) | Revert `NavInvalid`; keeper phải đẩy về ≥ 0 (clamp ở BE trước khi gửi) |
| User rút khi thiếu cash | `InsufficientLiquidity` + message UI; devnet: funding policy §7.5; mainnet: keeper bán positions (Jupiter SELL) để free cash rồi user retry — exact-request semantics giữ nguyên |
| Keeper hạ marks ngay trước tx rút | `paid < min_payout` → revert `PayoutBelowMin`; user ký lại với giá mới (không mất phí gas đáng kể) |
| Pause giữa chừng lúc user đang ký tx | Tx fail với `VaultPaused`; deposit retry sau, withdraw vẫn qua được |

## 14. Appendix — ánh xạ với hệ thống hiện tại

| Off-chain hiện tại | On-chain v1 | Ghi chú |
|---|---|---|
| `deposits` QUEUED→SETTLED + `settleEpoch` | deposit instant MTM | Rule 2026-10-12 supersede manual settle |
| `withdrawals` QUEUED + cancel | withdraw instant exact | Không queue on-chain |
| `hwmSharePrice` + `feeBps` + fee split | `hwm_price` + `fee_bps` + `fee_credit` | Split 80/15/5 giữ off-chain |
| `reserveBps` / `withdrawFeeBps` / `lockHours` | `reserve_bps` / `withdraw_fee_bps` | `lock_hours` hoãn (chưa cần v1) |
| Manage ladder (TP1/TP2/stop/trail/time) | BE giữ nguyên + `record_sim_trade` event | User chốt tối ưu ở BE |
| `copy_orders` / NAV MTM từ DataStream | `marks_lamports` keeper push | BE tự tính như hiện tại |
| Auth wallet + signed-intent | không đổi cho off-chain pool | Chain pool: user ký tx thật |
| signed-intent challenges | giữ nguyên (off-chain vaults) | Không áp dụng chain pool |
