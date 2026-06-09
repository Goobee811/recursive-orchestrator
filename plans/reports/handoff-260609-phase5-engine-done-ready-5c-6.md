---
title: "Handoff — recursive-pane-orchestration: Phase 5 engine (5A+5B) DONE → 5C / Phase 6"
date: 2026-06-09
type: report
tags: [handoff, recursive-pane-orchestration, phase-5, reconcile, continuation-chain, wmux]
status: active
plan: plans/260609-1722-recursive-pane-orchestration
---

# Handoff — recursive-pane-orchestration: Phase 5 engine DONE → 5C / Phase 6

Hệ điều phối đa tầng (Orchestrator→Leader→Worker) chạy agent vào pane wmux. **Engine Phase 5 xong — 5A (giải H3: reconcile lifecycle) + 5B (continuation chain 180k + reverse-relay); 104 test PASS, review pass, commit `68c161b` main (CHƯA push).** Còn 5C (leader-aggregate.ps1); khuyến nghị phiên sau làm **Phase 6 (Safety, BẮT BUỘC) trước 5C** vì 5C coupling data-fence/secret-scan của Phase 6 + verify thực ở Phase 7 E2E.

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-09 15:58 |
| Branch | main (commit `68c161b`, **chưa push** → origin/main còn ở `104c294`) |
| Remote | https://github.com/Goobee811/recursive-orchestrator (public) |
| Plan | `plans/260609-1722-recursive-pane-orchestration` (Hybrid 7 phase) |
| Trạng thái | Phase 1,2,3,4 ✅; Phase 5 🚧 (5A+5B ✅, 5C pending); Phase 6,7 pending |
| Tests | 104 PASS (32 nested + 27 reconcile + 45 chain). 0 fail |
| Auth | engine = subscription (codex/claude OAuth) → 0 đồng API [[no-api-tokens-subscription-only]] |

## 1. Công Việc Đã Hoàn Thành (phiên này)

| Công việc | Files | Trạng thái |
|-----------|-------|------------|
| **5A — Reconcile lifecycle (giải H3)**: poll `wmux agent list` → child `exited`→terminal + giải phóng slot + đóng wave; chạy đầu mỗi monitor pass | `scripts/reconcile-agents.js` (mới), `scripts/process-nested-requests.js` (+`wmuxAgentId`, reconcile, refactor) | ✅ 27 test + verify daemon thật |
| **5B — Continuation chain + reverse-relay**: chainId/linkSeq/nextLink/leaderAgentId; handoff→spawn link kế (giữ depth), done→reverse-relay qua state + marker | `scripts/chain-request.js`, `scripts/chain-router.js` (mới) | ✅ 45 test |
| **DRY refactor**: tách spawn dùng chung cho nested + chain | `scripts/pane-spawn.js` (mới) | ✅ Phase 4 không regression |
| Code-review (code-reviewer) → fix 3 (H-1/M-1/M-2), defer 2 (M-3/M-4) | `plans/reports/code-review-260609-2221-phase5-engine-reconcile-chain-report.md` | ✅ |
| Docs (plan + phase-05) + commit `68c161b` | — | ✅ |

## 2. Trạng Thái Hiện Tại

| Khía cạnh | Chi tiết |
|-----------|----------|
| Git | working tree clean; commit `68c161b` local, **chưa push** (origin/main = `104c294`) |
| Tests | `node scripts/spike/test-{nested-phase4,reconcile-phase5,chain-phase5}.js` → 104/104 PASS |
| H3 (blocker chính) | **ĐÃ GIẢI** — reconcile poll `agent list`, verified cả fixture + daemon thật |

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do (WHY) |
|------------|-------------|
| **H3 fix = reconcile poll `wmux agent list`** | `wmux agent spawn` KHÔNG nhận hook `on-agent-stop` (chỉ native subagent — xác nhận `on-agent-stop.sh:3-7`) → child kẹt `running`. Poll list là đường DUY NHẤT chuyển nó off running. Format đã verify live: `{agents:[{agentId,surfaceId,status:running\|exited,exitCode}]}` |
| **Map child↔live qua `wmuxAgentId` rồi `surfaceId`** | wmux agentId ≠ id nội bộ (w1-c1). Lưu thêm `wmuxAgentId` khi spawn. Chỉ tra id đã có trong state → KHÔNG bao giờ chạm pane của user |
| **exitCode 0=completed, else failed** | Theo đúng `on-agent-stop.sh:21-25`. `-1073741510` (0xC000013A=bị kill) → failed |
| **Continuation GIỮ NGUYÊN depth** | Cùng việc, phiên mới vì 180k — KHÔNG phải nesting. Chỉ tốn 1 slot concurrency, KHÔNG tốn depth level. (Khác hẳn nested child = depth+1) |
| **Termination = `nextLink==null` + relay marker** | Red-team H5/H6: KHÔNG định tuyến bằng frontmatter/slug (fuzzy, không ai đọc). State là nguồn sự thật; reverse-relay ghi `relay-<chainId>.json` để Leader poll |
| **Chain link = nested wave 1-agent** | Tái dùng addNestedWave + reconcile + dashboard nguyên; nối tiếp nên 1 link active/lúc |
| **Fix H-1/M-1/M-2; defer M-3/M-4** | H-1 (grid-fail rò slot) real→fix; M-1 (đếm error sai) fix; M-2 (chain-router reconcile standalone) fix. M-3 (TOCTOU 2-pass) KHÔNG thực vì monitor single-actor tuần tự; M-4 (cwd) worker full-trust→Phase 6 |
| **Khuyến nghị Phase 6 TRƯỚC 5C** (lệch handoff cũ) | 5C đọc content untrusted (result/-o) → cần data-fence + secret-scan của Phase 6; làm 5C trước = phải làm lại. crash-recovery (Phase 6) bảo vệ tiến độ worker thật |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| **Commit `68c161b` chưa push** | low | User chưa yêu cầu push. Push khi user muốn (`git push`) |
| 5C chưa làm | Phase 5 chưa đóng | `leader-aggregate.ps1`: gộp chain theo `linkSeq` + Codex (đọc `-o`/jsonl + **git diff verify file đích**, H7) + `resume-handoff --trail` slug=`chainId`. Cần đọc `context-handoff/scripts/{resume-handoff,validate-handoff,trace-decision-trail,utils}.js` |
| M-4: `request.cwd` chưa validate | low (worker full-trust) | Vào `--cwd` spawn. Bọc ở Phase 6 data-fence |
| Monitor loop THẬT chưa có | — | Hiện process-nested + chain-router chạy thủ công/test. Vòng lặp poll thật = Phase 7. Mỗi pass NÊN chạy: reconcile → process-nested → chain-router |
| M-3: TOCTOU cap nếu 2 pass chồng | rất low | Single-actor tuần tự nên không xảy ra; nếu Phase 7 chạy song song 2 script cần xem lại |

## 5. File Tham Chiếu

| File | Vai trò |
|------|---------|
| `plans/260609-1722-recursive-pane-orchestration/phase-06-safety-layers.md` | **ĐỌC ĐẦU** nếu theo khuyến nghị (Phase 6) — 4 lớp an toàn + M1/M2/M3 |
| `plans/260609-1722-recursive-pane-orchestration/phase-05-handoff-chain-lifecycle.md` | 5C còn lại (leader-aggregate); có bảng Progress 5A/5B/5C |
| `plans/reports/code-review-260609-2221-phase5-engine-reconcile-chain-report.md` | Findings review (H-1/M-1/M-2 đã fix; M-3/M-4 defer) |
| `scripts/reconcile-agents.js` | **Lõi H3** — `reconcile(state, liveAgents)` + `fetchLiveAgents`; export dùng lại |
| `scripts/chain-router.js` | Route continuation/relay; `planRoute`/`applySpawnNext`/`seedChain` export |
| `scripts/chain-request.js` | Worker ghi intent handoff/relay |
| `scripts/pane-spawn.js` | `allocateGrid`+`spawnIntoPane` dùng chung (nested + chain) |
| `scripts/process-nested-requests.js` | Orchestrator nhặt nested-request + reconcile đầu pass |
| `scripts/launch-agent-ext.js` | Codex branch (`-o`/jsonl) — 5C Leader đọc output này |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plan]] | Plan active (Hybrid 7 phase); Phase 5 row = in-progress |
| [[handoff-260609-phase4-done-ready-phase5-6]] | Handoff trước (Phase 4 done → 5/6) |
| [[no-api-tokens-subscription-only]] | Quy tắc: engine subscription, không API |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 1 (khuyến nghị) | **Phase 6 — Safety** (BẮT BUỘC): `safe-launch-wrapper.ps1` (backup+denylist+write-fence), `data-fence.js` (chống `'@` RCE), `scan-secrets.js` (SENSITIVE_PATTERNS từ context-handoff `utils.js`), crash-recovery marker sát 180k. Bọc launch path nested+chain vừa build | Phase 2 ✅ |
| 2 | **5C — leader-aggregate.ps1**: gộp chain theo `linkSeq` + Codex diff-verify + trail slug=`chainId`. (Làm SAU Phase 6 để có data-fence/secret-scan) | 5A,5B ✅ + Phase 6 |
| 3 | **Phase 7 — E2E + monitor loop thật + packaging**: vòng lặp poll (reconcile→process-nested→chain-router), chạy chain+nested+Codex thật trên fixture | Phase 4,5,6 |
| — | (Tùy chọn) `git push` commit `68c161b` khi user muốn | — |
