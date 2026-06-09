---
phase: 4
title: "Nested Recursion Engine"
status: done
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

- [x] Worker tạo được sub-worker qua **Orchestrator trung gian (fallback)** — đúng verdict Phase 1. E2e thực tế: orchestrator spawn `pane-d4bfa968` → `agent-fe3d00bb` (w1-c1, depth 2) chạy thật, sentinel auto-ran, cleanup 0 rác.
- [x] `nested-guard.js` chặn depth/concurrent vượt giới hạn (chương trình quyết định ngoài prompt, fail-closed). 32 test PASS: depth 6 deny / 8+1 deny / boundary 5+8 allow / NaN-limit deny.
- [x] `state.json` phản ánh đúng cây nested (`parentAgentId`+`depth`, nested wave); cleanup theo state dọn hết.

## Kết quả implement (2026-06-09)

**Verdict áp dụng: FALLBACK** (spike Phase 1). Files delta (`scripts/`):
- `nested-state.js` — lib chung: load/save atomic (tmp+rename) + lock `state.lock` (openSync 'wx' + stale-reclaim); listAgents/findAgent/countActive/agentDepth/makeChildId/addNestedWave; `ENGINES`+`isValidAgentId`.
- `nested-guard.js` — chốt cứng `evaluateGuard` (depth≤5, concurrent≤8), fail-closed (limit NaN/state mù → deny).
- `nested-request.js` — worker ghi `nested-request-<id>.json` sau guard; sanitize tasks; validate parentId.
- `process-nested-requests.js` — orchestrator nhặt request → re-check guard → register nested wave → prompt → spawn hộ qua wmux CLI (auto-anchor = orchestrator surface, KHÔNG `--anchor-surface`) → `nested-response-<id>.json`; `--dry-run`.
- Test: `spike/test-nested-phase4.js` (32 PASS), `spike/dummy-launcher.js` (e2e 0 chi phí).

**Bỏ GO-nested `spawn-subagents.ps1`** (YAGNI): spike đã verify `layout grid --anchor-surface` reshape phẳng + gom nhầm surface orchestrator → build = code chết, đi ngược verdict.

**Hardening sau code-review** (4 fix): C1 fail-open khi limit NaN; C2 path-traversal qua parentId (whitelist `[A-Za-z0-9._-]`, chặn ở worker+processor); H1 engine không re-validate → chèn `--cmd`; H2 empty subTasks → wave rỗng.

**Defer (không thuộc Phase 4):**
- **H3 → Phase 5:** nested child spawn qua `wmux agent spawn` KHÔNG được hook `on-agent-stop` cập nhật → kẹt `running`. Monitor loop (poll `wmux agent list` → `exited` → reconcile + giải phóng slot) là cơ chế đóng cây + reverse-relay của Phase 5. Hướng hiện tại fail-safe (deny nhiều hơn).
- **M1/M2 → Phase 6:** lock dùng token chống reclaim-race; gộp guard re-check vào trong `withState` (TOCTOU). Single-actor nên hiện tại an toàn.
- **M3 → Phase 6:** data-fence sâu cho `subtask`/`label` (markdown-section injection vào prompt con).

## Risk Assessment

- **Bùng nổ pane/agent** → `nested-guard.js` là chốt cứng (ngoài prompt); + cleanup theo state.
- **Spawn từ pane worker không ổn định** → fallback Orchestrator trung gian.
- **state.json clobber song song** (H3) → ghi qua `orchestration-state.sh` (plugin, đã serialize) + intent-before-spawn.

## Next Steps

Kết quả nested feed vào **Phase 5** (reverse-relay tổng hợp ngược về Leader/Orchestrator). An toàn spawn ở **Phase 6**.
