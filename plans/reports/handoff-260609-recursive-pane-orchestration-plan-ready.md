---
title: "Handoff — Recursive Pane Orchestration: plan Hybrid sẵn sàng cook"
date: 2026-06-09
type: report
tags: [handoff, orchestration, wmux, hybrid, plan-ready, cook]
status: active
---

# Handoff — Recursive Pane Orchestration (plan Hybrid sẵn sàng cook)

Đã xong `/ck:plan` cho hệ thống điều phối đa tầng O→L→W trên wmux (qua red-team + validate). Phiên sau: **bắt đầu `/ck:cook` Phase 1** — lưu ý **CHƯA tạo repo mới**, đó là việc đầu tiên của Phase 1. Plan hiện ở `govoff`.

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-09 |
| Repo | `C:\Users\Bee\govoff` (**NON-git**); hệ thống sẽ ra **repo MỚI** ở Phase 1 |
| Plan | `plans/260609-1722-recursive-pane-orchestration` |
| Trạng thái | **plan-ready** — đủ điều kiện cook (red-team + validate pass, 0 mâu thuẫn) |

## 1. Công Việc Đã Hoàn Thành

| Công việc | Files | Trạng thái |
|-----------|-------|------------|
| Plan Hybrid 7 phase | `plan.md` + `phase-01..07` | ✅ |
| Red-team 4 reviewers (16 findings, áp theo quyết định user) | `plan.md` §Red Team Review | ✅ |
| Validate 6 câu + 2 consistency sweep | `plan.md` §Validation Log | ✅ 0 mâu thuẫn |
| Phát hiện + verify plugin `wmux-orchestrator@0.1.1` (làm gần hết) | memory | ✅ |
| Hydrate 7 task + `blockedBy` chain | Task #1-7 | ✅ |
| Cập nhật memory (plugin, đính chính `--pane`) | 3 memory + MEMORY.md | ✅ |

## 2. Trạng Thái Hiện Tại

**plan-ready.** CHƯA code, CHƯA tạo repo. `govoff` non-git → việc git init là Phase 1. Mọi file vẫn ở `govoff/plans/260609-1722-recursive-pane-orchestration/`.

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do |
|------------|-------|
| **Hybrid**: nền plugin + chỉ build delta | plugin `wmux-orchestrator@0.1.1` đã có spawn/layout/registry/monitor/dashboard/decompose/coupling → đừng build lại (~30h) |
| **Repo riêng + git init** | govoff non-git (không rollback) + tách khỏi nội dung marketing; tích hợp wmux/Claude/Codex/ClaudeKit như runtime NGOÀI |
| Giữ **Codex v1** (`danger-full-access`) | user chốt; Leader đọc `-o`/`--output-schema` viết handoff hộ |
| Giữ **nested recursion** (depth 5 / đồng thời 8) | user chốt, khác flat-waves của plugin → cần spike spawn-từ-pane-worker |
| **Trigger sát 180k** (không biên 150k) | user chốt → crash-recovery marker là cơ chế chống mất tiến độ CHÍNH |
| ClaudeKit nhẹ (ck global, không skill riêng) | chỉ cần `cd` vào repo dùng được skills |
| Reject | build-from-scratch; flat-waves-only; cut-Codex; biên 150k; workspace-write; gom cmux/wmux (wmux=binary Electron, cmux=config WezTerm — concern khác) |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| Nested spawn từ **pane worker** (`layout grid --anchor-surface`) chưa verify | quyết định nested khả thi hay phải fallback | Phase 1 spike; fallback = Orchestrator trung gian |
| Child worker có `CLAUDE_CODE_SESSION_ID` RIÊNG? | context-meter 180k đọc đúng transcript | Phase 3 spike nhỏ; nếu inherit → dùng đếm work-units |
| Tên/đường dẫn repo mới | path mọi scripts về sau | đề xuất `C:\Users\Bee\orchestrator` — xác nhận khi cook |

## 5. File Tham Chiếu

| File | Vai trò |
|------|---------|
| `plans/260609-1722-recursive-pane-orchestration/plan.md` | **ĐỌC ĐẦU** — overview, gap-analysis, quyết định, red-team + validate log |
| `…/phase-01-spike-verify-wmux.md` | việc Phase 1: repo bootstrap + baseline + nesting spike |
| `~/.claude/.../memory/wmux-orchestrator-plugin-exists.md` | plugin làm gì — ĐỪNG build lại |
| `C:\Users\Bee\wmux\resources\wmux-orchestrator\scripts\spawn-agents.sh` + `launch-agent.js` + `skills/orchestrate/SKILL.md` | baseline plugin (layout grid + spawn --pane --cmd) |

## 6. Liên Kết Chéo

| Doc/Memory | Quan hệ |
|----------|---------|
| [[handoff-260609-default-orchestration-pane-mode]] | handoff thiết kế TRƯỚC (chuỗi: design → plan-ready) |
| [[wmux-orchestrator-plugin-exists]] | plugin nền (Hybrid) |
| [[default-orchestration-mode]] | nguyên tắc mặc định user đặt |
| [[wmux-pane-orchestration]] | cơ chế CLI + đính chính `--pane` |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 1 | `cd C:\Users\Bee\govoff` → `/ck:cook C:\Users\Bee\govoff\plans\260609-1722-recursive-pane-orchestration\plan.md` → Phase 1 | đọc `plan.md` + `phase-01` |
| 2 | Phase 1: **xác nhận tên repo** → tạo repo + `git init` + dời plan + confirm baseline + nesting spike (verdict GO-nested/FALLBACK) | — |
| 3 | Sau Phase 1: `cd` sang repo mới cho các phase tiếp; Phase 2 (Codex) + Phase 3 (meter) chạy song song được | Phase 1 xong |
