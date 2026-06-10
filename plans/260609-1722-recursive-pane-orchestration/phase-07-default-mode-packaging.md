---
phase: 7
title: "E2E Test + Default Mode Packaging"
status: done-fixture-scope
priority: P2
effort: "3-5h"
dependencies: [4, 5, 6]
---

> **Kết quả 2026-06-10 (fixture scope DONE):** Đợt 1 — worker codex viết `scripts/orchestrate-start.ps1` (daemon: hash-guard patch wmux, pass loop, stop-early) + `scripts/cleanup-panes.ps1` + `docs/orchestration-system.md` (430 dòng). Đợt 2 — E2E 1 lượt qua **Leader Opus 4.8 live** (`.orch-run/p7e2e/agent-lead-p7e2e-result.md`): Ca A nested (WA xin sub depth-3 qua nested-request, SUB_OK), Ca B chain (linkSeq 1→2, reverse-relay marker `leaderAgentId=lead-p7e2e` đúng), Ca C Leader đọc 3 codex `-o` aggregate. Daemon 47 pass stop-early `{liveAgents:0,pendingRequests:0}`; cleanup-panes live 5 kill/5 close/0 err; guard deny live 9>8; 0 pane mồ côi. **Finding:** (1) link handoff-only exit nhanh → `prevResultFile` có thể trỏ file chưa ghi, link sau phải fallback `out.jsonl` (đã xảy ra, L2 tự xử lý OK — cân nhắc explicit fallback trong chain-router, chờ user quyết); (2) codex "model at capacity" SAU handoff làm session treo không ghi `-o` → worker kẹt `running`, orchestrator đóng tay qua cleanup-panes + mark state (đường xử lý đã dùng thật). **CÒN LẠI:** success criteria "1 task BASF thật" — chờ user chọn task.

# Phase 7: E2E Test + Default Mode Packaging

## Overview

Kiểm thử toàn hệ thống Hybrid trên task thật (gồm các delta: nested + Codex + continuation chain + an toàn), rồi đóng gói thành cách dùng mặc định. Theo red-team M3: **không** tuyên bố "luôn orchestrate" cho tới khi đã chứng minh có lợi trên việc thật. Hệ thống nằm trong **repo riêng** (Phase 1); `ck` global dùng được khi `cd` vào, KHÔNG đóng gói skill riêng (validate Q2).

## Key Insights

- E2E phải bao phủ ĐÚNG các delta (plugin core đã được chính nó test); tập trung phần mình build.
- BASF sync (tuần tự, VI/.md+Excel+EN) là ca thật điển hình cho continuation chain + coupling-contract.
- Packaging = entrypoint mỏng gọi `/orchestrate` của plugin + bật các delta (env `WMUX_AGENT_CMD`, nested guard, safety wrapper), KHÔNG phải launcher thứ ba thừa.

## Requirements

- Functional: chạy trọn 3 ca (nested, Codex link, continuation chain) tới handoff tổng về Orchestrator; entrypoint 1 lệnh + lệnh dọn khẩn.
- Non-functional: 0 pane mồ côi; file đích khớp report; an toàn bật mặc định.

## Architecture

```
Ca A: nested — 1 worker tạo sub-worker (depth 2), guard chặn ở depth max
Ca B: continuation chain — task ép cắt ~30k → W1→W2→Wn→Leader, trail đúng linkSeq
Ca C: Codex link — ≥1 worker engine=codex, Leader viết handoff từ -o + verify diff
Packaging: orchestrate-start.ps1 (gọi plugin /orchestrate + bật delta) + cleanup theo state.json
```

## Related Code Files

- Read: toàn bộ scripts delta (Phase 2-6) + plugin `collect-results.sh`, `state.json`.
- Create: `docs/orchestration-system.md` — kiến trúc Hybrid, plugin-vs-delta, cách dùng, giới hạn an toàn, lệnh dọn (≤ docs.maxLoc 800).
- Create: `scripts/orchestrate-start.ps1` (entrypoint bật delta), `scripts/cleanup-panes.ps1` (dọn theo state.json).
- Update: memory `default-orchestration-mode.md`, `wmux-pane-orchestration.md` (sửa ghi chú `--pane` đã giải + trỏ plugin), `MEMORY.md`.

## Implementation Steps

1. Chạy Ca A/B/C trên fixture (KHÔNG file thật) — verify nested guard, chain linkSeq, Codex handoff, 4 lớp an toàn hoạt động end-to-end.
2. Chạy 1 task BASF thật (đã có backup từ Phase 6) qua hệ thống — đối chiếu file đích + trail; nghiệm thu độc lập (đọc file, không chỉ tin report).
3. Viết `orchestrate-start.ps1`: resolve PLUGIN_ROOT → gọi `/orchestrate` plugin với delta bật (engine, nested-guard, safe-launch-wrapper).
4. Viết `cleanup-panes.ps1`: dọn mọi pane/agent theo `state.json` (kể cả cây nested).
5. Viết `docs/orchestration-system.md` (trong repo mới) + cập nhật 2 memory + MEMORY.md cho khớp thực tế (ghi rõ `--pane`/`--cmd` đã giải, `CLAUDE_CODE_SESSION_ID` dùng cho meter, repo home mới); xác nhận `ck` global chạy khi `cd` vào repo.
6. Chốt ngưỡng orchestrate-vs-simple (thiên về đơn giản khi nghi ngờ); **chưa** ép "luôn orchestrate" (M3) — chỉ ghi nhận đã sẵn sàng.

## Success Criteria

- [x] 3 ca delta chạy trọn vẹn; 0 pane mồ côi; an toàn bật. *(2026-06-10: A nested depth-3 + B chain reverse-relay + C codex `-o`; safe-wrapper mọi spawn; guard deny live 9>8)*
- [ ] 1 task BASF thật chạy qua hệ thống, file đích khớp report. *(chờ user chọn task)*
- [x] `docs/orchestration-system.md` + memory cập nhật khớp thực tế; có lệnh dọn khẩn. *(cleanup-panes.ps1 verified live: 5 kill/5 close/0 err)*
- [x] Entrypoint dùng lại plugin, không tạo launcher thừa. *(orchestrate-start.ps1 = vòng lặp quanh orchestrator-pass.ps1, stop-early 47 pass)*

## Risk Assessment

- **Task thật corrupt** → đã có backup (Phase 6) + chạy fixture trước; chỉ đụng thật sau khi 3 ca pass.
- **Mặc định quá hung hăng (M3)** → KHÔNG ép "always", giữ ngưỡng thiên đơn giản; user bật thủ công cho tới khi tin tưởng.
- **Docs lệch code** → docs trỏ tới scripts là nguồn sự thật, không chép logic.

## Next Steps

Hoàn tất plan. Chạy `/ck:journal` ghi nhật ký; dùng thật cho task kế tiếp khi sẵn sàng.
