---
title: "Handoff — recursive-pane-orchestration: Phase 4 DONE → Phase 5-6"
date: 2026-06-09
type: report
tags: [handoff, recursive-pane-orchestration, phase-4, nested-recursion, wmux]
status: active
plan: plans/260609-1722-recursive-pane-orchestration
---

# Handoff — recursive-pane-orchestration: Phase 4 DONE → Phase 5-6

Hệ điều phối đa tầng (Orchestrator→Leader→Worker) chạy agent vào pane wmux. **Phase 4 (Nested Recursion Engine) đã cook xong theo verdict FALLBACK (Orchestrator trung gian), 32 test PASS + e2e spawn thật, code-review pass + 4 hardening, đã push public.** Phiên sau: Phase 5 (continuation + reverse-relay — đủ điều kiện, cũng là nơi giải H3 nested-child lifecycle) HOẶC Phase 6 (safety — BẮT BUỘC vì codex full-bypass).

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-09 15:16 |
| Branch | main (pushed → origin/main) |
| Remote | https://github.com/Goobee811/recursive-orchestrator (public) |
| Plan | `plans/260609-1722-recursive-pane-orchestration` (Hybrid 7 phase) |
| Trạng thái | Phase 1,2,3,4 ✅ done; Phase 5,6,7 pending |

## 1. Công Việc Đã Hoàn Thành (phiên này)

| Công việc | Files | Trạng thái |
|-----------|-------|------------|
| Phase 4: nested engine (FALLBACK = Orchestrator trung gian) | `scripts/nested-state.js`, `nested-guard.js`, `nested-request.js`, `process-nested-requests.js` | ✅ |
| Test harness 32 PASS (guard/boundary/fail-closed/request→process/idempotency/hardening) | `scripts/spike/test-nested-phase4.js`, `dummy-launcher.js` | ✅ |
| E2e spawn thật: orchestrator spawn pane con → child agent depth 2 chạy thật, cleanup 0 rác | — | ✅ |
| Code-review (code-reviewer) → fix 4 (C1/C2/H1/H2), defer 3 (H3/M1-2/M3) | — | ✅ |
| Commit `ad441b2` + push public repo | — | ✅ |

## 2. Trạng Thái Hiện Tại

| Khía cạnh | Chi tiết |
|-----------|----------|
| Git | working tree clean; `main...origin/main` synced (5 commit đã push) |
| Tests | `node scripts/spike/test-nested-phase4.js` → 32/32 PASS. Không test fail |
| Auth | engine = subscription (codex ChatGPT OAuth, claude OAuth) → **0 đồng API** [[no-api-tokens-subscription-only]] |

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do (WHY) |
|------------|-------------|
| **FALLBACK = Orchestrator trung gian** (worker ghi intent → orchestrator spawn hộ) | Spike Phase 1 verify: `layout grid --anchor-surface` reshape workspace phẳng + **gom nhầm surface orchestrator** → worker KHÔNG tự spawn pane sạch được. Cây nested giữ qua state (parentAgentId+depth), chỉ tập trung việc bấm nút ở 1 actor |
| **Bỏ GO-nested `spawn-subagents.ps1`** | YAGNI: spike đã chứng minh GO-nested không khả thi sạch → build = code chết, đi ngược verdict đã chốt. KHÔNG phải đảo quyết định user |
| Spawn dùng **auto-anchor** (KHÔNG truyền `--anchor-surface`) | Vì process chạy trong orchestrator session, `$WMUX_SURFACE_ID` = surface orchestrator → giống hệt `spawn-agents.sh` baseline đã verify PASS; tránh bug gom nhầm surface |
| Nested children = **new wave** (không append wave parent) | Tương thích dashboard + json-tool `wave-complete` + `agent list`; cây parent→child sống trong field `parentAgentId`+`depth` |
| Depth convention: orchestrator=0, direct-spawn=1, nested=d+1; limit 5/8 | maxDepth 5 cho chuỗi orch(0)→1→2→3→4→5, chặn depth 6; maxConcurrent 8 (user chốt Q4) |
| 4 hardening fix sau review | C1 fail-OPEN khi limit NaN (`x>NaN`=false phá chốt cứng); C2 path-traversal qua agent-id vào filename; H1 engine không re-validate chèn vào `--cmd` string thực thi; H2 empty subTasks → wave rỗng `running` |
| Public repo (user chọn dù đã cảnh báo path/tên dự án lộ) | Đã quét 15 pattern credential → 0 secret thật (chỉ mô tả `OPENAI_API_KEY null`). An toàn publish |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| **H3 — nested child kẹt `running`** | Phase 5 phải giải | child spawn qua `wmux agent spawn` KHÔNG được hook `on-agent-stop` cập nhật → kẹt running → wave không đóng + slot concurrency không giải phóng. CHÍNH là monitor-loop reconcile (poll `agent list` → `exited` → set completed/failed) của Phase 5. Hiện fail-safe (deny nhiều hơn) |
| M1/M2 → Phase 6 | low (single-actor) | lock dùng token chống reclaim-race; gộp guard re-check vào `withState` (TOCTOU) |
| M3 → Phase 6 | data-fence | siết `subtask`/`label` (markdown-section injection vào prompt con) |
| codex/claude `.cmd` shim máy KHÁC → `spawn` shell:false ENOENT | portability | máy này `.exe` (OK); đừng bật shell:true → resolve full path nếu cần |
| `agent.list` giữ record `exited` tồn đọng | cosmetic | không ảnh hưởng runtime |

## 5. File Tham Chiếu

| File | Vai trò |
|------|---------|
| `plans/260609-1722-recursive-pane-orchestration/phase-05-handoff-chain-lifecycle.md` | **ĐỌC ĐẦU** (ưu tiên 2) — continuation chain + reverse-relay + reconcile lifecycle (H3) |
| `plans/260609-1722-recursive-pane-orchestration/phase-06-safety-layers.md` | ưu tiên 3 (BẮT BUỘC) — 4 lớp an toàn + M1/M2/M3 |
| `plans/260609-1722-recursive-pane-orchestration/plan.md` | overview + phase table (1-4 ✅) + quyết định + red-team |
| `scripts/process-nested-requests.js` | Orchestrator nhặt request → spawn hộ. **Phase 5 thêm reconcile child status qua `agent list` poll** |
| `scripts/nested-state.js` | Lib state.json (atomic+lock, depth/active, addNestedWave, isValidAgentId, ENGINES). Phase 5/6 mở rộng |
| `scripts/nested-guard.js` | Chốt cứng depth≤5/concurrent≤8, fail-closed. `evaluateGuard` dùng chung 3 nơi |
| `scripts/context-meter.js` | `{decision: continue\|handoff}`. Phase 5 dùng để kích hoạt continuation chain |
| `scripts/codex-result-schema.json` | Schema strict — Leader đọc `result.json` ở Phase 5 |
| `plans/reports/spike-260609-nested-spawn-capability-report.md` | verdict FALLBACK + chuỗi lệnh wmux CLI chuẩn |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plan]] | Plan đang active (Hybrid 7 phase) |
| [[handoff-260609-phase2-3-done-ready-phase4]] | Handoff trước (Phase 2+3 done → 4) |
| [[no-api-tokens-subscription-only]] | Quy tắc: engine subscription, không API |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 1 | **Phase 5 — Continuation + reverse-relay**: monitor loop reconcile nested-child lifecycle (**giải H3**: poll `agent list` → `exited` → set completed/failed + giải phóng slot); context-meter kích hoạt chain; Leader đọc result.json; chainId+seq | Phase 2,3,4 ✅ |
| 2 | **Phase 6 — Safety** (BẮT BUỘC): backup+denylist, data-fence+secret-scan (M3), crash-recovery marker, runtime write-fence bọc launch path; gồm M1/M2 | Phase 2 ✅ |
| 3 | **Phase 7 — E2E + default-mode packaging** | Phase 4,5,6 |
