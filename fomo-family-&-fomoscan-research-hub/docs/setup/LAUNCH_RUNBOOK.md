# Launch hub — Edgepool/FOMO (sandbox → production)

Nguyên tắc chung: **cap nhỏ trước, mở dần, mọi bước có tiêu chí pass + rollback**.
Trạng thái hiện tại: paper/sandbox 100%. Runbook tách 2 nhánh độc lập:

- **Nhánh Product** (`LAUNCH_RUNBOOK_PRODUCT.md`) — mọi thứ chạm tiền user:
  hardening web, custody/key, on-chain vault, mainnet execution, mở tiền giới hạn,
  cash-out earnings, pháp lý. Không xong P1–P3 thì không đụng tiền thật.
- **Nhánh Analyst** (`LAUNCH_RUNBOOK_ANALYST.md`) — hệ phân tích dùng độc lập
  không cần tiền thật: nền dữ liệu prod-grade, chất lượng tín hiệu, UX/API analyst,
  vận hành đọc. Nhánh này lên trước được để lấy user + data.

Hai nhánh dùng chung: auth/roles (tk+mk + ví), audit append-only, FE shell,
policy/window engine, demo-sim làm sandbox training.

Thứ tự đề xuất: Analyst A0–A1 (lấy data + tín hiệu tin cậy) → Product P0–P1
(hardening + custody) → Product P2–P3 (vault + execution) → beta tiền thật (P4).
