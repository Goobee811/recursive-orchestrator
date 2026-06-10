---
title: "Handoff — recursive-pane-orchestration: directional split pipeline DONE (dogfood) → wmux first-leaf limit"
date: 2026-06-10
type: report
tags: [handoff, recursive-pane-orchestration, directional-split, dogfood, orchestrator, wmux, pipeline, phase-7]
status: active
plan: plans/260609-1722-recursive-pane-orchestration
---

# Handoff — directional split pipeline DONE qua DOGFOOD → wmux first-leaf split limit + Phase 7

Hệ điều phối đa tầng (Orchestrator→Leader→Worker) chạy agent vào pane wmux — **tích hợp split NGANG/DỌC vào pipeline XONG qua DOGFOOD THẬT** (worker Codex tự viết `allocateSplit`, verify H7, 183 test PASS, dogfood live 2 sibling + chain 2 link + reverse-relay). **Phát hiện chặn:** wmux `pane.split` LUÔN đáp first-leaf (không target được pane) → vị trí sibling 2+ lệch quy ước, nhưng chức năng spawn/lifecycle KHÔNG ảnh hưởng (§4). **Phiên sau = ORCHESTRATOR** (depth 0, model mạnh nhất + context 1M); việc chính = quyết định (A) fix wmux `split --pane` HOẶC (B) Phase 7 E2E + packaging (§7).

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-10 08:26 |
| Branch | main — **9 commit local CHƯA push** (7 cũ + 2 mới: `0534704`,`3d64176`); origin/main=`104c294` |
| Remote | https://github.com/Goobee811/recursive-orchestrator |
| Plan | `plans/260609-1722-recursive-pane-orchestration` (Hybrid 7 phase) |
| Trạng thái | Phase 1–6 ✅; **5C ✅ + directional split ✅ (dogfood)**; Phase 7 pending |
| Tests | **183 PASS** (32 nested + 27 reconcile + 45 chain + 64 safety + 3 leader-aggregate + **12 split-pipeline**), 0 fail |
| Vai trò phiên sau | **ORCHESTRATOR** (điều phối viên, depth 0). Model mạnh nhất + context 1M + effort max. KHÔNG tự gõ code worker — vận hành hệ |
| Auth | engine = subscription (codex/claude OAuth) → 0 đồng API [[no-api-tokens-subscription-only]] |

## 1. Công Việc Đã Hoàn Thành (phiên này)

| Việc | Files | Trạng thái |
|------|-------|------------|
| **Spec + spawn worker Codex `wsplit`** (split dọc từ pane orchestrator, safe-wrapper bọc) — worker dùng skills (ck:cook/scout/test/code-review) tự viết | `.orch-run/wsplit/` (runtime, gitignored) | ✅ |
| **`allocateSplit` primitive** (focus source → `wmux split [--down]` → paneId; throw nếu thiếu) — nơi tập trung pane allocation | `scripts/pane-spawn.js` | ✅ commit `0534704` |
| **`spawn-by-split.js` refactor DRY** (dùng `allocateSplit` chung, bỏ `splitPane` local; CLI giữ nguyên) | `scripts/spawn-by-split.js` | ✅ commit `0534704` |
| **Fan-out directional** (con đầu DỌC từ pane cha/root; sibling sau NGANG từ pane sibling thành công liền trước; split fail không wedge sibling sau; `--layout split` default, `grid` rollback) | `scripts/process-nested-requests.js` | ✅ commit `0534704` |
| **Chain next-link DỌC** (split từ `from.paneId`, fallback `root-pane`/`WMUX_PANE_ID` → `grid` vì harvest reap pane trước router) | `scripts/chain-router.js` | ✅ commit `0534704` |
| **Driver forward flags** `-RootPane`/`-Layout` xuống 2 script (PS 5.1 compatible) | `scripts/orchestrator-pass.ps1` | ✅ commit `0534704` |
| **Test fake-wmux + 12 case** (directions, anchors, fallbacks, split-fail, explicit grid) — không gọi wmux thật | `scripts/spike/fake-wmux-cli.js`, `scripts/spike/test-split-pipeline.js` (mới) | ✅ commit `0534704`, 12 PASS |
| **Verify H7** (git diff khớp đúng 7 file worker báo, 0 file ngoài zone) + **183 test PASS** (tự chạy lại độc lập) | — | ✅ |
| **Dogfood live**: 2 sibling parallel (`SIB1_OK`/`SIB2_OK`, harvest reap) + chain 2 link tự handoff→spawn→done→reverse-relay (`relay-chain-chw1.json`) | `.orch-run/dsplit/`, `.orch-run/dchain/` (runtime) | ✅ |
| **Docs + memory** (plan.md: dogfood result + wmux first-leaf limit; memory pane-split-convention chính xác hóa) | `plans/.../plan.md` | ✅ commit `3d64176` |

## 2. Trạng Thái Hiện Tại

| Khía cạnh | Chi tiết |
|-----------|----------|
| Git | working tree **clean**; 9 commit chưa push |
| Tests | 183 PASS. Chạy: `node scripts/spike/test-{nested-phase4,reconcile-phase5,chain-phase5,safety-phase6}.js` + `test-leader-aggregate-phase5c.js` + `test-split-pipeline.js` |
| Môi trường wmux | `$WMUX_CLI`=`C:\Users\Bee\wmux\resources\cli\wmux.js`; orchestrator pane = **`pane-e3a0e95e-daf7-4c30-88fe-7ee78ab6a22c`** (workspace `ws-4dc43b4b`, surface `surf-0a7d1674`); codex *Logged in ChatGPT* — định vị lại `wmux tree`+`identify` trước khi spawn (user có thể đã đổi) |
| orchDir runtime | `.orch-run/` (gitignored) — wsplit/dsplit/dchain per dogfood run |

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do (WHY) |
|------------|-------------|
| **`allocateSplit` đặt trong `pane-spawn.js`** (không để mỗi script tự split) | pane-spawn.js là nơi tập trung pane allocation (DRY); `spawn-by-split.js` + `process-nested` + `chain-router` dùng chung 1 primitive — sửa 1 chỗ |
| **`--layout split` default, `grid` giữ làm rollback** | Quy ước user: layout phản ánh cây điều phối. Grid là đường lùi vận hành khi split hỏng / thiếu pane nguồn → pipeline không bao giờ chết vì thiếu anchor |
| **Sibling sau split từ pane sibling THÀNH CÔNG liền trước** (không từ pane cha) | Để siblings xếp chồng tuần tự (về ý đồ). Split fail giữa chừng → nguồn cho sibling kế = pane thành công gần nhất, không wedge |
| **Chain next-link fallback `from-pane → root-pane → grid`** | Trong driver pass, `harvest-results --kill` chạy TRƯỚC chain-router → pane from-link có thể đã bị reap → split từ pane chết fail → phải có fallback. Verified bằng comment WHY trong code |
| **Worker Codex tự viết (dogfood), orchestrator chỉ soạn spec + verify** | Vai trò orchestrator = vận hành hệ, không gõ code worker. Spec nhúng skills guidance + zone-of-work; verify H7 (git diff) trước khi tin "done" |
| **`focus-pane` trước split — REJECT làm fix vị trí** | Thực nghiệm 2 lần (+ delay 800ms): wmux `pane.split` LUÔN đáp first-leaf, KHÔNG đọc focus. focus-pane vô tác dụng về vị trí. → giữ focus-pane trong code (vô hại) nhưng biết nó không quyết định vị trí |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| **wmux `pane.split` LUÔN đáp first-leaf** (renderer `__wmux_splitPane`: `kt(k.splitTree)[0]`, app.asar) — không đọc focus, không nhận paneId | **medium** — vị trí hình học sibling 2+ đáp dưới ORCHESTRATOR thay vì dưới sibling trước; chain link đáp dưới orchestrator thay vì dưới link trước. **Chức năng spawn/lifecycle/test KHÔNG ảnh hưởng** (state/JSON/direction đều đúng) | Fix trọn vẹn = nâng cấp wmux: `__wmux_splitPane` nhận `params.paneId` (~1 dòng; `__wmux_layoutGrid` cạnh đó đã có pattern `anchorPaneId`) + CLI `split --pane <id>`. `C:\Users\Bee\wmux` chỉ là **bản build (app.asar)** — KHÔNG thấy source repo local. Cần user quyết: (a) chỉ source wmux, (b) cho vá app.asar (unpack/patch/repack, restart wmux), hoặc (c) chấp nhận layout hiện tại (chức năng đủ) |
| **Codex subagent `code_reviewer`/`planner` lỗi model-resolution** | low | Worker lại gặp (2 lần) → fallback self-review `ck:code-review` OK. Kiểm `~/.codex/agents/*.toml` + config model nếu muốn |
| **9 commit chưa push** | low | User chốt commit-không-push; `git push` khi muốn |
| **Phase 7 chưa làm** | — | E2E thật (nested + codex + chain full 1 lượt) + default-mode packaging (M3: defer "always" tới khi proven) |

## 5. File Tham Chiếu (đọc THEO THỨ TỰ)

| # | File | Vai trò |
|---|------|---------|
| 1 | `plans/260609-1722-recursive-pane-orchestration/plan.md` | Plan tổng — Phase 1–6 done, 5C+split done, Phase 7 pending; mục "Rủi ro tổng" có note wmux first-leaf |
| 2 | `scripts/pane-spawn.js` | `allocateGrid` + **`allocateSplit`** + `spawnIntoPane` — primitive allocation |
| 3 | `scripts/process-nested-requests.js` | fan-out directional (sibling NGANG) — đọc cách chọn source + fallback grid |
| 4 | `scripts/chain-router.js` | next-link DỌC + `allocateContinuationPane` (fallback chain) |
| 5 | `scripts/orchestrator-pass.ps1` | driver loop 5 bước — `-RootPane`/`-Layout`/`-Chain`/`-HarvestKill` |
| 6 | `scripts/spike/test-split-pipeline.js` + `fake-wmux-cli.js` | test pattern + fake CLI (mẫu để thêm test) |
| 7 | `scripts/harvest-results.js` | result-based completion + reap pane (chạy trước chain-router) |
| 8 | `phase-07-default-mode-packaging.md` | spec Phase 7 nếu chọn hướng B |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plan]] | Plan active — Phase 1–6 done, 5C+split done, Phase 7 pending |
| [[handoff-260610-0118-5c-done-ready-split-horizontal-pipeline]] | Handoff trước (5C → split pipeline) — việc này GIỜ ĐÃ XONG |
| [[pane-split-layout-convention]] | Quy ước split + LIMIT wmux first-leaf (đã chính xác hóa) |
| [[dogfood-worker-lifecycle-result-based]] | Lifecycle worker headless = harvest result-based |
| [[no-api-tokens-subscription-only]] | Engine subscription, 0 API |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 1 | **Hỏi user chọn hướng**: (A) fix wmux `split --pane` cho vị trí pane đúng quy ước (cần source wmux / cho vá app.asar) HOẶC (B) chấp nhận layout + tiến Phase 7 | quyết định user |
| 2A | Nếu (A): điều phối thêm `params.paneId` vào `__wmux_splitPane` + CLI `split --pane <id>` + đổi `allocateSplit` truyền `--pane`; dogfood lại quan sát vị trí | source/quyền vá wmux |
| 2B | Nếu (B): **Phase 7** — E2E thật 1 lượt (nested + codex + chain full + reverse-relay + leader-aggregate) + default-mode packaging | Phase 4/5/6 |
| 3 | (Tùy) Sửa codex subagent model-resolution (`~/.codex/agents/*.toml`) | — |
| — | (Tùy) `git push` 9 commit khi user muốn | — |

## Lưu ý vận hành (phiên sau)
- **Vai trò = ORCHESTRATOR**, không tự gõ code worker — soạn spec, spawn, verify H7, harvest.
- Spawn worker headless codex → đóng bằng `orchestrator-pass.ps1 -HarvestKill` (KHÔNG trông chờ reconcile cho worker tự-exit lành).
- Định vị lại pane orchestrator bằng `wmux tree` + `wmux identify` TRƯỚC khi spawn (user có thể đã chuyển workspace).
- `wmux split` đáp first-leaf → muốn pane mới đúng vị trí phải để source = pane đầu tree; `read-screen` cần renderer serializer (chưa có) → quan sát qua result file + `agent list` + jsonl + `wmux tree`.
- Engine subscription, 0 API. Verify H7 (git diff file đích) trước khi tin worker "done".
