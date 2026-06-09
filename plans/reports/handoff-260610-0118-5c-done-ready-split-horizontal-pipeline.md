---
title: "Handoff — recursive-pane-orchestration: 5C DONE (dogfood) → tích hợp split NGANG vào pipeline"
date: 2026-06-10
type: report
tags: [handoff, recursive-pane-orchestration, phase-5c, dogfood, orchestrator, wmux, split-layout, pipeline]
status: active
plan: plans/260609-1722-recursive-pane-orchestration
---

# Handoff — 5C DONE qua DOGFOOD → tích hợp split NGANG vào pipeline (siblings parallel)

Hệ điều phối đa tầng (Orchestrator→Leader→Worker) chạy agent vào pane wmux — **Phase 5C XONG qua DOGFOOD THẬT**: orchestrator spawn worker Codex headless (split dọc, 0 API sub) → worker dùng skills viết `scripts/leader-aggregate.ps1` đúng spec (verify H7) → `harvest-results.js` đóng lifecycle (171 test PASS, 3 commit local chưa push). **Phiên sau giữ vai trò ORCHESTRATOR** (điều phối viên; model mạnh nhất + context 1M + effort max), việc chính = **tích hợp split NGANG vào pipeline cho siblings parallel** (hiện `pane-spawn.js` còn dùng `layout grid`, chưa theo quy ước split). Chi tiết §7 + Bước Tiếp Theo.

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-10 01:18 |
| Branch | main — **7 commit local CHƯA push** (4 cũ + 3 mới: `5b5b3d4`,`d1d31a9`,`b304a4c`); origin/main=`104c294` |
| Remote | https://github.com/Goobee811/recursive-orchestrator |
| Plan | `plans/260609-1722-recursive-pane-orchestration` (Hybrid 7 phase) |
| Trạng thái | Phase 1–6 ✅; **5C ✅ (dogfood)**; Phase 7 pending |
| Tests | **171 PASS** (32 nested + 27 reconcile + 45 chain + 64 safety + **3 leader-aggregate**), 0 fail |
| Vai trò phiên sau | **ORCHESTRATOR** (điều phối viên, depth 0). Model mạnh nhất + context 1M + effort max. KHÔNG tự gõ code worker — vận hành hệ |
| Auth | engine = subscription (codex/claude OAuth) → 0 đồng API [[no-api-tokens-subscription-only]] |

## 1. Công Việc Đã Hoàn Thành (phiên này)

| Việc | Files | Trạng thái |
|------|-------|------------|
| **Driver loop tối thiểu** (1 pass: reconcile→harvest→process-nested→chain-router→crash-detect) | `scripts/orchestrator-pass.ps1` (mới) | ✅ commit `5b5b3d4` |
| **Spawn theo quy ước layout** (con=split DỌC, sibling=split NGANG) — tái dùng `spawnIntoPane` | `scripts/spawn-by-split.js` (mới) | ✅ — mới dùng split DỌC (1 worker con); split NGANG chưa wire vào pipeline |
| **harvest-results** (result-based completion — vá gap pane `-NoExit`) + reap pane (agent kill + close-pane) | `scripts/harvest-results.js` (mới) | ✅ commit `5b5b3d4` |
| **5C `leader-aggregate.ps1`** (do worker Codex viết): gộp chain theo `linkSeq` + Codex diff-verify H7 (rỗng/không diff⇒BLOCKED) + handoff slug=`chainId` + validate | `scripts/leader-aggregate.ps1`, `scripts/spike/test-leader-aggregate-phase5c.js` (mới) | ✅ commit `d1d31a9`, 3 test PASS |
| Smoke test (codex fixture) + dogfood 5C end-to-end | `.orch-run/` (runtime, gitignored) | ✅ |
| Docs 5C done | `phase-05`, `plan.md` | ✅ commit `b304a4c` |

## 2. Trạng Thái Hiện Tại

| Khía cạnh | Chi tiết |
|-----------|----------|
| Git | working tree **clean**; 7 commit chưa push |
| Tests | 171 PASS. Chạy: `node scripts/spike/test-{nested-phase4,reconcile-phase5,chain-phase5,safety-phase6}.js` + `node scripts/spike/test-leader-aggregate-phase5c.js` |
| Môi trường wmux | `$WMUX_CLI`, `$WMUX_SURFACE_ID` OK; codex *Logged in ChatGPT* + claude 2.1.169; **orchestrator ở Session 1 (`ws-4dc43b4b`)** — user có thể chuyển workspace, định vị lại trước khi spawn |
| orchDir runtime | `.orch-run/` (gitignored) — state.json + prompts + results per run |

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do (WHY) |
|------------|-------------|
| **Completion worker headless = RESULT-BASED, KHÔNG reconcile** | `wmux agent spawn` chạy trong pane shell `-NoExit` → worker codex xong+exit nhưng pane sống → `agent list` báo `running` mãi; `agent kill`→exitCode `-1073741510` (kill)⇒reconcile misclassify `failed`. → `harvest-results.js` đọc `result.json status=done`→`completed`+reap pane. reconcile chỉ cho worker THẬT crash/kill. [[dogfood-worker-lifecycle-result-based]] |
| **Spawn theo quy ước split** (con=dọc `wmux split`, sibling=ngang `wmux split --down`) | User chốt: layout phản ánh cây điều phối (sâu=dọc, rộng=ngang). `wmux split` thao tác trên FOCUSED pane → `spawn-by-split.js` focus source-pane trước. [[pane-split-layout-convention]] |
| **Worker Codex ƯU TIÊN skills** (không làm tắt theo cách Codex) | User yêu cầu. Hạ tầng đã có: `~/.codex/AGENTS.md`+`skills/`+`rules/`+`agents/*.toml` (sync ClaudeKit). Spec 5C nhúng thẳng vào prompt (chắc chắn đọc) + dùng bản context-handoff ĐẦY ĐỦ `~/.claude/...` (bản `~/.codex/...` thiếu `validate-handoff.js`+`utils.js`) |
| Spawn 5C trực tiếp `spawn-by-split` (không qua process-nested fence) | Mission do orchestrator viết = trusted, không cần data-fence; cần kiểm soát prompt (skills guidance ở khung) |
| Dogfood THẬT trước, fixture nhỏ trước | "Thử xem" = lần đầu hệ tự làm; smoke codex tự-exit verify pipeline trước khi giao task 5C lớn |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| **`pane-spawn.js` vẫn dùng `layout grid`** — pipeline (`process-nested-requests.js`/`chain-router.js`) spawn siblings bằng grid, CHƯA theo split NGANG | medium (việc chính phiên sau) | `spawn-by-split.js` đã có primitive split dọc/ngang; cần wire vào `process-nested-requests` (fan-out N siblings → split NGANG giữa chúng) + test nhánh ngang. Cân nhắc: thuật toán split cây 2 chiều (sâu=dọc giữa cha-con, rộng=ngang giữa siblings) |
| **Codex subagent `code_reviewer`/`planner` lỗi model-resolution** | low | Worker fallback `ck:code-review` tự review OK. Kiểm `~/.codex/agents/*.toml` + config model nếu muốn worker dùng được subagent |
| **7 commit chưa push** | low | User chốt commit-không-push; `git push` khi muốn |
| `harvest-results --kill` close-pane | low | Đã thêm close-pane sau agent kill (smoke/w5c verify thủ công agent kill+close-pane chạy); chưa chạy lại harvest live với close-pane mới wire |
| Worker codex interactive vs headless | low | claude interactive KHÔNG tự exit (cần kill); codex headless tự-exit. Cho task cần xem trực tiếp → claude + kill thủ công |

## 5. File Tham Chiếu (đọc THEO THỨ TỰ cho việc split NGANG)

| # | File | Vai trò |
|---|------|---------|
| 1 | `scripts/spawn-by-split.js` | **primitive split dọc/ngang** (`--split vertical|horizontal`) — nền cho tích hợp pipeline |
| 2 | `scripts/pane-spawn.js` | `allocateGrid` (grid hiện tại) + `spawnIntoPane` — chỗ cần thay/bổ sung split NGANG cho fan-out |
| 3 | `scripts/process-nested-requests.js` | spawn N siblings 1 wave (fan-out) — nơi tích hợp split NGANG giữa siblings |
| 4 | `scripts/chain-router.js` | spawn-next 1 link (continuation) — split DỌC (cùng luồng sâu hơn) |
| 5 | `scripts/orchestrator-pass.ps1` | driver loop 5 bước — chạy `-HarvestKill` để đóng worker headless |
| 6 | `scripts/harvest-results.js` | result-based completion + reap pane |
| 7 | `plans/260609-1722-recursive-pane-orchestration/plan.md` + `phase-05...md` | plan tổng + 5C/lifecycle gap note |
| 8 | `scripts/leader-aggregate.ps1` | 5C output (tham chiếu chất lượng worker tạo) |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plan]] | Plan active — Phase 1–6 done, 5C done, Phase 7 pending |
| [[handoff-260609-phase6-done-ready-5c-dogfood]] | Handoff trước (Phase 6 → 5C dogfood) |
| [[pane-split-layout-convention]] | Quy ước split dọc=con / ngang=sibling |
| [[dogfood-worker-lifecycle-result-based]] | Lifecycle worker headless = harvest result-based |
| [[no-api-tokens-subscription-only]] | Engine subscription, 0 API |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 1 | **Tích hợp split NGANG vào pipeline cho siblings parallel**: dựng thuật toán/integration để `process-nested-requests.js` spawn N siblings 1 wave bằng split NGANG (dùng `spawn-by-split` primitive thay/bổ sung `allocateGrid`); giữ split DỌC cho quan hệ cha-con (chain-router continuation + nested child). Test cả 2 nhánh | `spawn-by-split.js`, `pane-spawn.js`, `process-nested-requests.js` |
| 2 | Dogfood lại với ≥2 siblings parallel (quan sát layout ngang) + 1 chain dọc | driver loop + harvest |
| 3 | (Tùy) Sửa codex subagent model-resolution (`~/.codex/agents/*.toml`) để worker dùng được code_reviewer/planner | — |
| 4 | Phase 7: E2E thật (nested + codex + chain full) + default-mode packaging | Phase 4/5/6 |
| — | (Tùy) `git push` 7 commit khi user muốn | — |

## Lưu ý vận hành (phiên sau)
- **Vai trò = ORCHESTRATOR**, không tự gõ code worker — soạn spec, spawn, verify, harvest.
- Spawn worker headless codex → đóng bằng `orchestrator-pass.ps1 -HarvestKill` (KHÔNG trông chờ reconcile).
- `wmux split` thao tác FOCUSED pane → `focus-pane <nguồn>` trước; `read-screen` KHÔNG khả dụng (cần renderer serializer) → quan sát qua result file + `agent list` + jsonl.
- Engine subscription, 0 API. Verify H7 (git diff file đích) trước khi tin worker "done".
