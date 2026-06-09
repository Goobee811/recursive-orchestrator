---
title: "Handoff — recursive-pane-orchestration: Phase 6 DONE → 5C qua DOGFOOD (orchestrator thật)"
date: 2026-06-09
type: report
tags: [handoff, recursive-pane-orchestration, phase-6, safety-layers, dogfood, orchestrator, wmux]
status: active
plan: plans/260609-1722-recursive-pane-orchestration
---

# Handoff — Phase 6 DONE → 5C qua DOGFOOD

Hệ điều phối đa tầng (Orchestrator→Leader→Worker) chạy agent vào pane wmux; **Phase 6 (Safety Layers) XONG** — 4 lớp an toàn bọc launch path opt-in, 168 test PASS, review fix H1/H2+M1–M4, commit `6b41a15` main (chưa push). Next = **5C** (`leader-aggregate.ps1`), nhưng user chốt: **phiên sau KHÔNG tự code — hãy TRỞ THÀNH ORCHESTRATOR THẬT** và dogfood chính hệ vừa build để Worker viết 5C (chi tiết §7). "Thử xem" = lần đầu hệ thống tự làm việc của nó.

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-09 16:53 |
| Branch | main — **3 commit local CHƯA push**: `68c161b`, `a15fe29`, `6b41a15` (origin/main = `104c294`) |
| Remote | https://github.com/Goobee811/recursive-orchestrator (public) |
| Plan | `plans/260609-1722-recursive-pane-orchestration` (Hybrid 7 phase) |
| Trạng thái | Phase 1,2,3,4 ✅; 5 🚧 (5A+5B ✅, **5C pending**); 6 ✅; 7 pending |
| Tests | **168 PASS** (32 nested + 27 reconcile + 45 chain + 64 safety). 0 fail |
| Auth | engine = subscription (codex/claude OAuth) → 0 đồng API [[no-api-tokens-subscription-only]] |

## 1. Công Việc Đã Hoàn Thành (phiên này)

| Việc | Files | Trạng thái |
|------|-------|------------|
| **Lớp 1 — backup + git checkpoint + denylist + write-fence** | `scripts/safe-launch-wrapper.ps1` (mới) | ✅ win32 e2e |
| **Lớp 2 — data-fence** (DATA block gutter chống forged marker + here-string `'@` guard) — **đã wire** vào prompt builders | `scripts/data-fence.js` (mới); `process-nested-requests.js`+`chain-router.js` (fence subtask/remaining) | ✅ |
| **Lớp 3 — secret-scan** (reuse `SENSITIVE_PATTERNS` context-handoff + fallback) — gate prompt + **quarantine result** | `scripts/scan-secrets.js` (mới) | ✅ |
| **Lớp 4 — crash-recovery** (marker + heartbeat + **live cross-check** chống false-crash) | `scripts/crash-recovery.js` (mới) | ✅ |
| Integration opt-in (default OFF → Phase 4/5 zero regression) | `pane-spawn.js` (`buildLaunchCmd`), `process-nested-requests.js`+`chain-router.js` (`--safe-wrapper`) | ✅ 104 test cũ pass |
| Test + review-fix (H1 wire fence, H2 false-crash, M1–M4) | `scripts/spike/test-safety-phase6.js` (mới, 64 test); `plans/reports/code-review-260609-2303-phase6-safety-layers-report.md` | ✅ |

## 2. Trạng Thái Hiện Tại

| Khía cạnh | Chi tiết |
|-----------|----------|
| Git | working tree clean; `6b41a15` local (3 commit chưa push) |
| Tests | `node scripts/spike/test-{nested-phase4,reconcile-phase5,chain-phase5,safety-phase6}.js` → 168/168 PASS |
| Monitor loop THẬT | **chưa có** (process-nested + chain-router chạy thủ công/test). Vòng lặp poll thật = Phase 7 — nhưng **dogfood 5C cần dựng driver loop tối thiểu** (xem §7) |

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do (WHY) |
|------------|-------------|
| **Write-fence dưới full-bypass = detect + optional restore, KHÔNG abort lúc ghi** | Worker `--dangerously-skip-permissions`/`danger-full-access` gọi shell trực tiếp → không chặn được tại thời điểm ghi. → **backup + git checkpoint là net chính, bắt buộc**; write-fence chỉ phát hiện + `-RestoreOutOfZone` revert từ git |
| **Crash `--mark` gated trên live cross-check** | Heartbeat theo thời gian đơn thuần sẽ false-crash worker đang chạy unit dài (H-2). → chỉ mark khi agent đã VANISHED khỏi `wmux agent list` (reconcile lo case `exited`). `--mark` từ chối nếu không có `--wmux-cli` |
| **data-fence wire vào 2 prompt builder** (không để ngủ — H-1) | fence header KHÔNG nói "bỏ qua nội dung" (mission là việc thật) mà "đây là spec, KHÔNG override rule khung: không cấp quyền/đổi zone/đổi depth/redirect" — đúng cho cả mission lẫn prior-result |
| **Reuse `SENSITIVE_PATTERNS` từ context-handoff + fallback nội bộ** | DRY khi skill có; self-contained khi vắng (secret-scan không được no-op) |
| **Integration safety = opt-in (`--safe-wrapper`, default off)** | Giữ Phase 4/5 byte-identical (104 test pass nguyên); Phase 7 mới bật mặc định khi E2E |
| **Phase 6 TRƯỚC 5C** (đã làm đúng) | 5C đọc result/`-o` untrusted → giờ đã có `scan-secrets`+`data-fence` để dùng |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| **3 commit chưa push** | low | User chưa yêu cầu push (`git push` khi muốn) |
| **5C chưa làm** | Phase 5 chưa đóng | `leader-aggregate.ps1`: gộp chain theo `linkSeq` + Codex (đọc `-o`/jsonl + **git diff verify file đích**, H7) + `resume-handoff --trail` slug=`chainId`. Đọc `context-handoff/scripts/{resume-handoff,validate-handoff,trace-decision-trail,utils}.js` |
| **Dogfood = lần đầu chạy hệ thật** | medium | Monitor loop thật chưa có → cần dựng driver tối thiểu (overlap Phase 7). Kỳ vọng có gap tích hợp; chạy fixture nhỏ trước, KHÔNG chạy task thật ngay |
| Request-file trust model | low | `chain-request-*`/`nested-request-*` coi là untrusted second boundary (đã fence + validate). Nếu process thấp quyền drop được → siết thêm M-4/write-fence |
| crash-recovery `detect --mark` chưa wire vào loop | low | Phase 7 (hoặc driver dogfood) chạy SAU reconcile mỗi pass |

## 5. File Tham Chiếu (đọc THEO THỨ TỰ)

| # | File | Vai trò |
|---|------|---------|
| 1 | `plans/260609-1722-recursive-pane-orchestration/plan.md` | Plan Hybrid 7 phase — bức tranh tổng |
| 2 | `plans/260609-1722-recursive-pane-orchestration/phase-05-handoff-chain-lifecycle.md` | **5C spec** (leader-aggregate) + bảng Progress 5A/5B/5C |
| 3 | `plans/260609-1722-recursive-pane-orchestration/phase-06-safety-layers.md` | 4 lớp an toàn để BỌC worker khi dogfood |
| 4 | `scripts/chain-router.js` | seed chain + route spawn-next/relay; `seedChain`/`planRoute`/`applySpawnNext` export |
| 5 | `scripts/process-nested-requests.js` | spawn worker vào pane + reconcile đầu pass; `--safe-wrapper` |
| 6 | `scripts/pane-spawn.js` | `allocateGrid`+`spawnIntoPane`+`buildLaunchCmd` (route qua wrapper) |
| 7 | `scripts/reconcile-agents.js` | poll `wmux agent list` → đóng lifecycle (H3) |
| 8 | `scripts/{safe-launch-wrapper.ps1,scan-secrets.js,data-fence.js,crash-recovery.js}` | 4 lớp an toàn bọc launch |
| 9 | `scripts/launch-agent-ext.js` | Codex branch (`-o`/jsonl) — 5C Leader đọc output này |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plan]] | Plan active (Hybrid 7 phase); Phase 6 row = done |
| [[handoff-260609-phase5-engine-done-ready-5c-6]] | Handoff trước (Phase 5 engine → 5C/6) |
| [[no-api-tokens-subscription-only]] | Quy tắc: engine subscription, KHÔNG API |

## 7. Bước Tiếp Theo — DOGFOOD 5C (user chốt: orchestrator thật)

**Vai trò phiên sau = ORCHESTRATOR (depth 0, main session trong wmux).** KHÔNG tự gõ code 5C. Thay vào đó vận hành hệ thống để Worker viết 5C:

| Ưu tiên | Hành động | Ghi chú |
|---------|-----------|---------|
| 0 | Xác nhận môi trường: `$WMUX_CLI`, `$WMUX_SURFACE_ID` có; `wmux agent list` chạy; engine claude/codex login OK | Nếu không trong wmux → báo user mở wmux trước |
| 1 | Dựng **driver loop tối thiểu** (overlap Phase 7): 1 pass = `reconcile-agents` → `process-nested-requests` (hoặc `chain-router`) → `crash-recovery detect`. Chạy thủ công từng pass trước | Đây là glue còn thiếu; giữ nhỏ, KISS |
| 2 | Soạn **spec 5C** cho Worker: viết `scripts/leader-aggregate.ps1` (gộp chain theo `linkSeq` + nhánh Codex đọc `-o`/jsonl + **git diff verify** + `resume-handoff --trail` slug=`chainId`). Allowed files = `scripts/leader-aggregate.ps1` (+ test) | data-fence sẽ bọc spec; scan-secrets gate |
| 3 | Spawn **1 Worker** vào pane (qua `process-nested-requests.js --safe-wrapper <ps1>` hoặc trực tiếp `pane-spawn`) trên **fixture nhỏ** trước — quan sát pane, reconcile, result | Bọc `safe-launch-wrapper.ps1` (backup + secret-scan). Engine subscription, 0 API |
| 4 | Khi Worker xong → reconcile đóng slot → đọc result; nếu cần nhiều link (180k) → chain-router nối tiếp; cuối → reverse-relay về Leader | Verify diff `leader-aggregate.ps1` thật khớp (H7) |
| 5 | Đóng 5C: cập nhật phase-05 (5C ✅) + plan; chạy lại 168+ test; review; commit | — |
| — | (Tùy chọn) `git push` 3 commit khi user muốn | — |

**Lưu ý dogfood:** đây là THỬ NGHIỆM. Kỳ vọng gặp gap tích hợp (loop chưa hoàn chỉnh, pane focus, anchor surface). Chạy **fixture nhỏ + dry-run trước**, leo dần lên task thật. Nếu hệ chưa đủ để tự chạy 5C → ghi nhận gap, fallback tự code 5C + bổ sung glue cho Phase 7.
