---
title: "Handoff — Plan skill /watch-agent chờ validate + red-team; hệ multi-repo đã verify thật (gantt-sync)"
date: 2026-06-12
type: report
tags: [handoff, watch-agent-skill, orch-status, observability, multi-window, plan-pending]
status: active
plan: 260612-2103-watch-agent-skill-orchestration-observability
---

# Handoff — Plan /watch-agent chờ validate/red-team

Domain: observability cho hệ orchestration — skill `/watch-agent [target]` + helper `scripts/orch-status.js` để xem nhanh session khác đang phân công/tư duy/hành động gì. Plan ĐÃ VIẾT + task hydrated, user CHỐT: phiên sau chạy `/ck:plan validate` RỒI `/ck:plan red-team` trước khi cook.

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-12 21:10 |
| Branch | main (3 commit sáng đã lên: `a189590` feat hardening, `ff3c2d0` docs multi-repo, `0801dab` plans root-cause) |
| Plan | `plans/260612-2103-watch-agent-skill-orchestration-observability` (3 phase, pending) |
| Trạng thái | in-progress — plan chờ 2 gate rồi mới cook |

## 1. Công Việc Đã Hoàn Thành (phiên này)

| Công việc | Files | Trạng thái |
|-----------|-------|------------|
| Sáng: root-cause govoff (wave `govinv`) + fix multi-repo (wave `mrfix`) + E2E smoke govoff + 3 commit | xem [[handoff-260612-0005-govoff-orchestration-failures-investigation]] đã RESOLVED + `plans/reports/from-orchestrator-wave-govinv-260612-0026-govoff-three-symptoms-root-cause-report.md` | done |
| Tối: user test THẬT từ wmux session 2 — wave `gantt-sync` govoff (2 đợt: diff-gantt + diff-ws-sheets → apply-sync, 3 codex, completed, có backup) | `C:\Users\Bee\govoff\.orch-run\gantt-sync\` | done — multi-repo mode hoạt động ngoài đời |
| Trung hòa memory govoff cũ dạy pattern improvise (4 file: wmux-pane-orchestration, default-orchestration-mode, recursive-orchestrator-repo, MEMORY.md) | `~/.claude/projects/C--Users-Bee-govoff/memory/` | done |
| Plan skill /watch-agent (fast mode) + hydrate 3 task (#1→#2→#3) | `plans/260612-2103-watch-agent-skill-orchestration-observability/{plan,phase-01..03}.md` | done — CHƯA commit |

## 2. Trạng Thái Hiện Tại

**Đang chạy tốt:** hệ multi-repo verify 2 lần (mrsmoke + gantt-sync thật của user); main sạch sau 3 commit.
**Chưa commit:** plan dir `260612-2103-...` (untracked) — commit cùng handoff này hoặc sau khi 2 gate sửa plan.
**Lỗi/Tests:** N/A — full spike suite 254 PASS/0 FAIL (lần chạy sáng).

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do |
|------------|-------|
| Skill project-local `.claude/skills/watch-agent/` + helper mỏng `scripts/orch-status.js` (tổng quan wave) tách vai với `watch-agent.js` (soi 1 agent) | User: "ngay tại repo recursive-orchestrator là đủ". Reject: daemon/UI, skill global, sửa watch-agent.js — YAGNI/DRY (tái dùng orch-forensics-map + createCodexRenderer) |
| Skill READ-ONLY tuyệt đối, không lệnh wmux mutate | Phát hiện multi-window: `tree` KHÔNG scope theo caller (tree từ pane tôi trả `surf-dd038acd…` ≠ `surf-d2e9f7b3…` của shell tôi) → reaper/close nhìn nhầm live-set khi 2 window mở |
| Resolve `[target]`: path tuyệt đối → wave dưới cwd → repo `C:\Users\Bee\<tên>` → trống = discovery | Tên trần tiện gõ; thứ tự tránh nhập nhằng wave/repo trùng tên |
| Bounded reads mọi nơi (byte-slice 64KB cuối, không cat) | Bài học transcript 15MB ở wave govinv |
| User override Post-Plan default: KHÔNG cook ngay — validate + red-team trước | Quyết định user 2026-06-12 21:05, tôn trọng tuyệt đối |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| Multi-window: cơ chế scope của `tree` chưa rõ (focused window? mới nhất?) | CẤM `reap-orphan-shells -Reap` + thận trọng `close-pane-with-log --confirm` khi 2 wmux window cùng mở | Bằng chứng trong Quyết Định; docs đã ghi "single-window assumption" — chưa fix code |
| Skill catalog chỉ nạp đầu phiên | `/watch-agent` chỉ gõ được ở phiên SAU khi cook xong | Nghiệm thu mô phỏng trong phiên cook (phase 3 đã ghi) |
| BASF task thật | Criterion cuối plan nền `260609-1722` | VẪN chờ user giao đề |

## 5. File Tham Chiếu (đọc theo thứ tự)

| File | Vai trò |
|------|---------|
| `plans/260612-2103-watch-agent-skill-orchestration-observability/plan.md` | ĐỌC ĐẦU TIÊN — overview + 5 quyết định thiết kế |
| `plans/260612-2103-.../phase-01-helper-script-orch-status.md` | Spec orch-status.js (interface chốt — validate/red-team soi kỹ nhất ở đây) |
| `docs/orchestration-system.md` | mục Multi-repo mode + "Theo dõi và đóng pane thủ công" — baseline khớp |
| `C:\Users\Bee\govoff\.orch-run\gantt-sync\state.json` | Dữ liệu validate sống (2 đợt, 3 codex) |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plans/260612-2103-watch-agent-skill-orchestration-observability/plan]] | Plan active chờ 2 gate |
| [[from-orchestrator-wave-govinv-260612-0026-govoff-three-symptoms-root-cause-report]] | Root-cause nền cho mọi quyết định READ-ONLY/bounded |
| [[handoff-260612-0005-govoff-orchestration-failures-investigation]] | Handoff trước — ĐÃ RESOLVED toàn bộ (điều tra + fix xong) |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 0 | Đầu phiên orchestration: HỎI user "Chọn model nào: Fable hay Opus" → kiểm hash app.asar `CED7F271…` → `node $env:WMUX_CLI tree` lấy RootPane | — |
| 1 | `/ck:plan validate plans/260612-2103-watch-agent-skill-orchestration-observability` | — |
| 2 | `/ck:plan red-team` cùng plan đó | sau validate |
| 3 | Sửa plan theo 2 gate (giữ quyết định user đã chốt — xem mục 3) → hỏi user rồi `/ck:cook` | 2 gate xong |
| 4 | BASF task thật qua wave multi-repo từ govoff | user giao đề |
