---
phase: 4
title: "Nested Recursion Engine"
status: pending
priority: P1
effort: "4-6h"
dependencies: [1]
---

# Phase 4: Nested Recursion Engine

## Overview

Mở rộng plugin (flat waves) để hỗ trợ **nested recursion** theo đúng ý gốc user: một worker gặp sub-task có thể tự "tiến hóa thành Leader", tạo pane con và spawn sub-worker vào đó (depth nhiều cấp). Dựa trên verdict spike Phase 1.

## Key Insights

- Plugin chỉ làm flat waves max 5/wave (`SKILL.md:89`). Nested là delta thật.
- Nếu Phase 1 = GO-nested: worker dùng `layout grid --anchor-surface <surface của nó>` + `agent spawn --pane` để cấp pane con (tái dùng logic `spawn-agents.sh`, chỉ đổi anchor).
- Nếu Phase 1 = FALLBACK: worker KHÔNG tự spawn — ghi yêu cầu pane ra file, **Orchestrator (main session) split+spawn hộ** rồi trả paneId; logic "nested" vẫn đúng, chỉ khác ai bấm nút.
- `state.json` của plugin phẳng (waves[].agents[]) → mở rộng cây: mỗi agent có `parentAgentId`, `depth`.

## Requirements

- Functional: worker-as-leader phân rã sub-task (tái dùng decompose/coupling của plugin) → cấp pane con → spawn sub-worker; tổng hợp kết quả sub-worker.
- Non-functional: **giới hạn cứng** depth (mặc định **5**) + tổng agent đồng thời (≤ **8**) ngoài tầm sửa của model (validate Q4); chống bùng nổ pane.

## Architecture

```
worker (depth d) gặp sub-task →
  decompose (PLUGIN Phase 3/4.5 logic) → sub-streams + file-ownership + contract nếu coupled
  GO-nested:  layout grid --anchor-surface <surf-self> → paneCon[]; agent spawn --pane … --cmd
  FALLBACK:   ghi {request panes N, anchor surf-self} ra file → Orchestrator spawn hộ → trả paneIds
  ghi state.json: sub-agent {parentAgentId, depth:d+1, …}
  guard: d+1 > maxDepth → KHÔNG spawn, tự làm tuần tự
```

## Related Code Files

- Read: `spawn-agents.sh`, `orchestration-state.sh`, `SKILL.md` Phase 3-6, spike report Phase 1.
- Create: `scripts/spawn-subagents.ps1` (hoặc `.sh`) — biến thể spawn dùng `--anchor-surface` của worker + ghi cây vào state.
- Create: `scripts/nested-guard.js` — kiểm tra depth + concurrent ceiling TRƯỚC khi spawn (đọc state.json), từ chối nếu vượt.
- Update: schema `state.json` (thêm `parentAgentId`, `depth`).

## Implementation Steps

1. Mở rộng `state.json`: `parentAgentId`, `depth` cho mỗi agent; orchestrator depth=0.
2. Viết `nested-guard.js`: trước mọi spawn (kể cả nested) đọc state.json, đếm depth + concurrent; vượt → trả `deny` (worker phải tự làm thay vì spawn). Đây là chốt chặn bùng nổ.
3. GO-nested path: `spawn-subagents.ps1` lấy `WMUX_SURFACE_ID` của worker làm `--anchor-surface`, tạo pane con, spawn sub-worker.
4. FALLBACK path: worker ghi yêu cầu ra `nested-request-<agentId>.json`; Orchestrator loop (Phase 7 monitor) nhặt, split+spawn hộ, ghi paneId trả lại.
5. Sub-worker xong → result file; worker-leader tổng hợp (chuẩn bị cho reverse-relay Phase 5).
6. Test: 1 worker tạo 2 sub-worker (depth 2), guard chặn ở depth 6 (vượt max 5) + chặn khi >8 agent đồng thời; xác minh cây trong state.json + 0 pane rác.

## Success Criteria

- [ ] Worker tạo được sub-worker vào pane con (GO-nested) HOẶC qua Orchestrator trung gian (fallback) — đúng verdict Phase 1.
- [ ] `nested-guard.js` chặn depth/concurrent vượt giới hạn, model không lách được (đọc state, không phải lời nhắc).
- [ ] `state.json` phản ánh đúng cây nested; cleanup theo state dọn hết.

## Risk Assessment

- **Bùng nổ pane/agent** → `nested-guard.js` là chốt cứng (ngoài prompt); + cleanup theo state.
- **Spawn từ pane worker không ổn định** → fallback Orchestrator trung gian.
- **state.json clobber song song** (H3) → ghi qua `orchestration-state.sh` (plugin, đã serialize) + intent-before-spawn.

## Next Steps

Kết quả nested feed vào **Phase 5** (reverse-relay tổng hợp ngược về Leader/Orchestrator). An toàn spawn ở **Phase 6**.
