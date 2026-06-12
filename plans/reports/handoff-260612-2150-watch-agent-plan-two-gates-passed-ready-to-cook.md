---
title: "Handoff — Plan /watch-agent đã qua 2 gate (validate + red-team), sẵn sàng /ck:cook"
date: 2026-06-12
type: report
tags: [handoff, watch-agent-skill, orch-status, plan-gated, ready-to-cook]
status: active
plan: 260612-2103-watch-agent-skill-orchestration-observability
---

# Handoff — Plan /watch-agent qua đủ 2 gate, phiên sau cook

Domain: observability cho hệ orchestration — skill `/watch-agent` + helper `scripts/orch-status.js`. Phiên này chạy xong 2 gate user chốt: validate (4 quyết định) + red-team (3 reviewer, 15 findings, 14 áp dụng), plan đã sửa + commit `5d4bd0b`, 0 mâu thuẫn. Việc duy nhất còn lại: **/ck:cook**.

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-12 21:50 |
| Branch | main (sạch — commit `5d4bd0b` docs(plans) đã lên) |
| Plan | `plans/260612-2103-watch-agent-skill-orchestration-observability` (3 phase, pending) |
| Trạng thái | in-progress — plan GATED xong, chờ cook |

## 1. Công Việc Đã Hoàn Thành

| Công việc | Files | Trạng thái |
|-----------|-------|------------|
| Gate 1 `/ck:plan validate`: verification 24 claims (Standard tier) + interview 4 câu — user override 3/4 recommendation | plan.md `## Validation Log` | done |
| Gate 2 `/ck:plan red-team`: 3 reviewer (Security/Assumption/FailureMode) → 24 findings thô → 15 hợp nhất (2 Critical, 10 High, 3 Medium) → 14 accept, 1 reject | plan.md `## Red Team Review` | done |
| Áp 14 findings vào 3 phase files (marker `Red Team Session 2026-06-12`) + 2 sweep 0 contradictions | phase-01/02/03 | done |
| Commit `5d4bd0b` "docs(plans): validate + red-team plan watch-agent truoc cook" | 4 files, +190/-41 | done |

## 2. Trạng Thái Hiện Tại

**Working tree:** sạch. **Tests:** chưa chạy phiên này (suite 254 PASS từ sáng — phase 1 step 9 sẽ re-run). **Plan:** đủ điều kiện cook — mọi failure verification đã xử lý, sweep cuối 0 mâu thuẫn.

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do |
|------------|-------|
| (Validate Q2 — user override) `tier` ghi VÀO state lúc tạo agent record tại `process-nested-requests.js` kids-map + `chain-router.js` link; KHÔNG đụng launch-agent-ext | User muốn tier là dữ liệu gốc. Red-team sửa công thức: nested `claude→leader`, `codex|opencode→worker`; chain link KẾ THỪA `from.agent.tier \|\| 'worker'` (claude chain-link là worker continuation — bằng chứng test-leader-aggregate-phase5c.js:40). Reject R1 (bỏ write-path) vì đảo quyết định user |
| (Validate Q3 — user override) Discovery = quét `C:\Users\Bee\*` cấp 1 có `.orch-run` qua `--discover` | Tự phát hiện repo mới. Red-team hardening F11: skip OneDrive, sort max-mtime state.json, root-level state.json, KHÔNG auto deep-dive repo lạ |
| (Validate Q4 — user override) DoD 2 phiên: phiên cook KHÔNG đóng plan; phiên sau nữa gõ `/watch-agent` thật mới completed | Skill catalog chỉ nạp đầu phiên |
| (Red-team F1) Resolver thêm nhánh 2.5: tên trần miss cwd+repo → tìm wave xuyên repo qua discover | Không có nhánh này thì `/watch-agent gantt-sync` (use case flagship) fail-by-spec từ repo này |
| (Red-team F2) SKILL.md có DATA-ONLY GUARD | out.jsonl/transcript là untrusted — chống prompt injection vào phiên orchestrator; sanitizeControl không chống chỉ thị |
| (Red-team F7) orch-status TỰ tail claude transcript bounded (byte-slice + `renderClaudeLine` re-export); cấm skill chạy `watch-agent --once` | `--once` đọc NGUYÊN file (fromStart mặc định, transcript thật 2.7MB) — phá doctrine bounded-reads; lệnh cấm sửa watch-agent.js giữ nguyên |
| (Red-team F12) ĐÍNH CHÍNH: docs = **594 dòng** vật lý, không phải 437 | Validation S1 đo sai bằng `Measure-Object -Line` (chỉ đếm non-blank). Bài học: đếm dòng dùng `(Get-Content).Count` / `wc -l` |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| Đường hand-seed thứ 3 tạo agent record (bằng chứng waves lmodel/wpatch2/htest) — không qua 2 file được vá tier | Record hand-seed hiện `~tier` suy diễn | Chấp nhận (F4); phase 3 thêm hướng dẫn docs |
| 100% claude agent cũ thiếu `claudeSessionId` | Tail claude rơi fallback result.md | Spec sẵn (F8); kịch bản 4 phase 3 nghiệm thu |
| Multi-window `tree` scope chưa rõ (tồn từ phiên trước) | Không chặn plan này (READ-ONLY) | CẤM reap khi 2 window mở |
| BASF task thật qua wave multi-repo | Chờ user giao đề | Criterion plan nền `260609-1722` |

## 5. File Tham Chiếu (đọc theo thứ tự)

| File | Vai trò |
|------|---------|
| `plans/260612-2103-watch-agent-skill-orchestration-observability/plan.md` | ĐỌC ĐẦU TIÊN — overview + Validation Log + Red Team Review (15 findings, guard notes) |
| `plans/260612-2103-.../phase-01-helper-script-orch-status.md` | Spec chi tiết nhất: resolver 6 nhánh, tail rules, tier mapping, read-path validation |
| `plans/260612-2103-.../phase-02-skill-watch-agent-skill-md.md` | SKILL.md spec: DATA-ONLY GUARD, transcript exclusions |
| `plans/260612-2103-.../phase-03-e2e-validation-va-docs.md` | 5 kịch bản nghiệm thu + docs 594 baseline + DoD 2 phiên |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plans/260612-2103-watch-agent-skill-orchestration-observability/plan]] | Plan active — gated, chờ cook |
| [[handoff-260612-2110-watch-agent-plan-await-validate-redteam]] | Handoff trước — ĐÃ RESOLVED (2 gate chạy xong phiên này) |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 0 | Đầu phiên: HỎI user "Chọn model nào: Fable hay Opus" (mọi phiên tại repo này); hash app.asar + RootPane CHỈ cần nếu spawn pane (cook này không spawn) | — |
| 1 | `/ck:cook C:\Users\Bee\recursive-orchestrator\plans\260612-2103-watch-agent-skill-orchestration-observability\plan.md` | — |
| 2 | Handoff phiên cook ghi gate còn lại: phiên sau nữa gõ `/watch-agent` thật → mới chuyển plan completed (DoD Q4) | sau cook |
