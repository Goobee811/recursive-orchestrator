---
phase: 3
title: "Context Meter (180k)"
status: pending
priority: P2
effort: "2-3h"
dependencies: []
---

# Phase 3: Context Meter (180k)

## Overview

Cho mỗi worker tự biết đã dùng bao nhiêu context để thực thi luật user: **<180k → làm tiếp đoạn nữa; ≥180k → handoff worker kế** (Phase 5). Rủi ro "tự tìm transcript" mà bản plan cũ lo đã **phần lớn được giải**: `CLAUDE_CODE_SESSION_ID` env var tồn tại (verify phiên này).

## Key Insights

- Verify: `CLAUDE_CODE_SESSION_ID=bf7ee697…` tồn tại + transcript đúng tại `~/.claude/projects/C--Users-Bee-govoff/<sid>.jsonl`. (Plan cũ đoán sai tên `CLAUDE_SESSION_ID`.)
- **Cảnh báo (red-team A2):** worker spawn qua `agent spawn --cmd "node launch-agent…"` là instance `claude` ĐỘC LẬP → có session id RIÊNG (khác orchestrator). Phải xác nhận child KHÔNG inherit id orchestrator (1 bước spike nhỏ).
- **auto-compact làm `input_tokens` non-monotonic (M4):** đo token thô không tin được làm tín hiệu chính → **primary = đếm work-units** (orchestrator cấp N đơn vị/worker); token chỉ là **safety eject** (1 entry pre-compact vượt 180k → abort).

## Requirements

- Functional: lệnh worker gọi giữa các đơn vị → `{unitsDone, tokensApprox, decision: continue|handoff|unknown}`.
- Non-functional: fail-state RÕ RÀNG (không fail-open thành chạy mãi, không fail-closed thành churn vô hạn).

## Architecture

```
worker xong 1 đơn vị →
  node context-meter.js --session $CLAUDE_CODE_SESSION_ID --orch-dir <d> --agent <id>
    primary: unitsDone >= budgetUnits → handoff
    safety : đọc transcript jsonl, nếu 1 entry input_tokens > 180k → handoff (eject)
    fail   : không xác định được session/transcript → decision="unknown"
             → worker theo budgetUnits thuần (KHÔNG chạy quá), không churn
```

## Related Code Files

- Create: `scripts/context-meter.js` — quyết định continue/handoff/unknown.
- Read: 1 file `.jsonl` mẫu trong `~/.claude/projects/C--Users-Bee-govoff/` (xác nhận schema `usage`).
- Update: spec/prompt worker (Phase 2/5) — chèn bước "sau mỗi đơn vị → context-meter → theo decision".

## Implementation Steps

1. Spike nhỏ: spawn 1 worker chạy `$env:CLAUDE_CODE_SESSION_ID | Set-Content out.txt`, so với id orchestrator → xác nhận child có id RIÊNG. Nếu inherit/empty → chỉ dùng đường đếm work-units.
2. Đọc transcript mẫu, xác nhận field `usage.input_tokens` ở assistant entries.
3. Viết `context-meter.js`: primary = `unitsDone >= budgetUnits`; safety eject = bất kỳ entry `input_tokens>180000`; fail = "unknown".
4. Định nghĩa hành vi `unknown` trong giao thức worker: theo `budgetUnits` thuần, KHÔNG vượt, KHÔNG churn (chống C5 fail-open/closed).
5. Test trên transcript giả + đếm units giả tại các mốc.

## Success Criteria

- [ ] Worker xác định được session/transcript của CHÍNH NÓ (hoặc fallback work-units xác nhận).
- [ ] `context-meter.js` trả continue/handoff/unknown đúng; `unknown` không gây chạy-mãi hay churn.
- [ ] Token chỉ là safety eject; work-units là tín hiệu chính (né auto-compact).

## Risk Assessment

- **Child inherit session id orchestrator** (chưa chắc) → đếm work-units thành đường chính, token-meter chỉ phụ.
- **auto-compact** (M4) → đã xử lý bằng work-units primary.
- Ngưỡng 180k là quyết định user → giữ; chỉ thêm biên (eject ở entry vượt 180k).

## Next Steps

Decision của meter là điều kiện kích hoạt continuation chain ở **Phase 5**. Chạy song song được với Phase 2.
