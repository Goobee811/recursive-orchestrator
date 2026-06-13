---
phase: 1
title: "Scripts: Embedded Template + Resume Control-Plane + Bugfix"
status: completed
priority: P1
effort: "4h"
dependencies: []
---

> **Hoàn thành 2026-06-13.** Mọi todo PASS. Ghi chú thực thi: tách thêm `parse-handoff.js` (parser thuần) khỏi `resume-handoff.js` để (a) đưa resume-handoff về 112 dòng <200 và (b) triệt tiêu vòng circular gốc — `trace-decision-trail` nay require `parse-handoff.js` trực tiếp, không còn require ngược resume-handoff (lazy require gỡ bỏ, sạch hơn fix lazy ban đầu). `collect-git-state.js` 212 dòng là pre-existing, ngoài scope, không đụng. Test: 292 pass (từ 264), gồm fix 1 test fragile có sẵn (`listRecentWaves` race 3.6ms → backdate mtime tường minh) để gate node --test deterministic.

# Phase 1: Scripts — Embedded Template + Resume Control-Plane + Bugfix

## Overview

Chuyển template handoff từ references vào script (draft output tự chứa skeleton + guidance + structure guardrails cho Phase 3), fix 2 bug (circular require vỡ `--trail`; metadata regex parse fail âm thầm), thêm `--brief` mode cho resume theo kiến trúc control/data-plane. Resume prompt: giữ footer "Đọc handoff file → ..." nguyên trạng (user decision: luôn đọc doc), chỉ fix wave re-check path.

## Context Links

- Research: [[researcher-01-runtime-token-flow-report]], [[researcher-03-handoff-design-patterns-report]]; red-team: [[from-red-team-to-planner-adversarial-plan-review]] (F1-F13, cùng plan dir)
- Skill: `~/.claude/skills/context-handoff/` (v3.0.0)
- Bug 1: `scripts/resume-handoff.js:177` lazy-require + `scripts/trace-decision-trail.js:10` top-level require ngược `parseHandoff`; CLI block `resume-handoff.js:189-209` chạy TRƯỚC `module.exports:211` → `--trail`: TypeError
- Bug 2 (F1): regex metadata `resume-handoff.js:78` `/^\*\*([^*]+)\*\*:\s*(.+)$/` chỉ match `**Key**: value`; skeleton + handoffs thật dùng `**Ngày:** value` → metadata fail âm thầm, resume prompt ra `Branch: unknown`

## Requirements

- Functional: draft của `gather-context.js` là skeleton HOÀN CHỈNH (8 sections + section `## Giả Thuyết & Dự Đoán` + metadata `**Verify:**` cho Phase 3 + `<!-- Reflect: -->` 1-dòng + placeholders) — Creation không cần đọc reference template nào; `resume-handoff.js --validate --trail` chạy sạch; `--brief` mode trả control-plane JSON; metadata parse được CẢ `**Key:** value` lẫn `**Key**: value`; resume prompt giữ nội dung hiện hành + wave re-check absolute path
- Non-functional: mọi file <200 dòng raw (`(Get-Content).Count`); Node built-in only; backward-compat với handoffs cũ; zero-regression repo không `.orch-run`

## Architecture

```
CREATION:
gather-context.js ──> collect-git-state.js ──> format-handoff-draft.js ──┬──> draft (self-guiding)
                      handoff-template.js (MỚI: constants) ──────────────┤
                      format-orchestration-section.js (+ ORCH_GUIDANCE) ─┘

RESUME (control/data-plane — red-team F2/F3):
resume-handoff.js --brief ──> JSON control plane: file, ageDays, staleWarning, validation, trail [D#], recentHandoffs
                              (KHÔNG parsed sections — tránh double-read)
Read handoff doc            ──> data plane DUY NHẤT: nội dung đầy đủ (prose, bullets, mermaid, wikilinks, orch-plan)

PROMPT: generate-resume-prompt.js (dùng parseHandoff nội bộ) ──> context + nextSteps + blockers + files
                                                                  + footer "Đọc handoff file → entry files → làm việc" (GIỮ — user decision)
                                                                  + wave re-check (absolute path) khi có Wave section
```

**Nguyên lý:** instruction sống 1 nơi — guidance fill nằm trong draft output, SKILL.md chỉ trỏ. Template và parseHandoff round-trip: render → fill → parse đủ fields KỂ CẢ metadata.

## Related Code Files

Tất cả trong `~/.claude/skills/context-handoff/scripts/`:

**Tạo mới:**
- `handoff-template.js` — export `HANDOFF_TEMPLATE` (8 sections hiện hành + section `## Giả Thuyết & Dự Đoán` bảng 3 cột cap 5 rows + metadata line `**Verify:** {lệnh + kết quả}` — structure cho Phase 3 guardrails; metadata KV format `**Key:** value` GIỮ NGUYÊN như skeleton hiện hành; `<!-- Reflect: -->` comments MỖI CÁI 1 DÒNG — F6, chứa 5 reflection questions hiện hành; placeholders `{...}`), `DOMAIN_SPLIT_HINT` (4 câu hỏi từ workflow-details.md), `ORCH_GUIDANCE` (placeholders phần orchestrator-plan từ handoff-orchestration-skeleton.md). Pure constants + render helper. <200 dòng — nếu chạm trần (F10: ước 160-175 + section mới), tách `ORCH_GUIDANCE` sang `format-orchestration-section.js` (người dùng duy nhất)
- `__tests__/handoff-template.test.js` — round-trip: render → fill giả → `parseHandoff` trả đủ nextSteps/fileReferences/blockers/decisions **+ metadata (Ngày/Branch/Plan/Trạng thái — F1)**; headings khớp regex parse; giữ nguyên văn marker `<!-- Cluster hint` + `## Wave Orchestration (auto-detected)`

**Sửa:**
- `resume-handoff.js` —
  (a) `module.exports` lên TRƯỚC CLI block; exports đặt SAU mọi function declaration (hoisted OK) và sau các const được export (tránh TDZ — F12);
  (b) metadata regex chấp nhận cả 2 format: `/^\*\*([^*:]+):?\*\*:?\s+(.+)$/` hoặc 2 regex tuần tự — match `**Key:** value` VÀ `**Key**: value` (F1);
  (c) thêm flag `--brief`: output chỉ {file, allFiles, ageDays, staleWarning, validation, trail} — không parsed sections (F2/F3)
- `trace-decision-trail.js` — lazy-require `parseHandoff` trong function (bảo vệ kép circular)
- `format-handoff-draft.js` (200 dòng — sẽ GIẢM) — compose draft từ `HANDOFF_TEMPLATE` + pre-filled git data (metadata KV như skeleton, sections tables như skeleton — làm rõ F1: KHÔNG đổi format, chỉ đổi nơi template sống); multi-domain → chèn `DOMAIN_SPLIT_HINT` sau `<!-- Cluster hint -->`
- `format-orchestration-section.js` — chèn `ORCH_GUIDANCE`; sửa pointer dòng ~82 đang trỏ `handoff-orchestration-skeleton.md` (file sẽ xóa ở Phase 2) → trỏ `orchestration-handoff-guide.md` (F9)
- `generate-resume-prompt.js` — GIỮ nội dung + footer hiện hành nguyên trạng (user decision: luôn đọc doc — KHÔNG thêm khối decisions vì sẽ duplicate với doc được đọc); CHỈ thêm: handoff có Wave section → dòng re-check dùng ABSOLUTE paths (script tự biết `__dirname`, `--cwd` resolve absolute — F7)
- `validate-handoff.js` — thêm warn khi còn `<!-- Reflect:` sót trong doc save (F6)
- Audit 11 scripts còn lại: chuẩn hóa exports-before-CLI cùng pattern (chú ý TDZ — F12)

**Tests sửa:** `__tests__/gather-context.test.js`, `__tests__/generate-resume-prompt.test.js`, `__tests__/resume-handoff.test.js`, `__tests__/validate-handoff.test.js` — format mới + THÊM: regression spawn `node resume-handoff.js --trail` qua child_process với **fixture ≥2 handoffs cùng domain** (F8 — ít hơn là trail early-return, không đụng đường bug); test metadata 2 format; test --brief shape

## Implementation Steps

1. Viết `handoff-template.js`: port skeleton từ `references/handoff-skeleton.md:9-84`; Reflect comments 1 dòng/cái; port `DOMAIN_SPLIT_HINT` + `ORCH_GUIDANCE`.
2. Fix `resume-handoff.js`: metadata regex 2-format (F1) → exports-before-CLI (F12) → thêm `--brief`. Chạy `node resume-handoff.js` trên handoff thật: metadata phải ra Branch/Plan/Trạng thái thật (hết `unknown`).
3. Sửa `trace-decision-trail.js` lazy-require; audit exports pattern 11 scripts.
4. Refactor `format-handoff-draft.js` dùng template module; verify <200 dòng.
5. Sửa `format-orchestration-section.js`: ORCH_GUIDANCE + pointer F9.
6. Sửa `generate-resume-prompt.js`: wave re-check absolute (F7) — phần còn lại giữ nguyên.
7. `validate-handoff.js`: warn Reflect sót (F6).
8. Tests: round-trip (kèm metadata), regression --trail fixture ≥2 handoffs, --brief, 2-format metadata. `node --test` 100%.
9. Smoke thật: `gather-context.js --cwd C:/Users/Bee/recursive-orchestrator` (draft đủ, tự hướng dẫn) + `resume-handoff.js --validate --trail` + `--brief` trên `plans/reports/`.

## Todo List

- [x] handoff-template.js (Reflect 1-dòng) + test round-trip kèm metadata
- [x] resume-handoff.js: metadata regex 2-format + exports-before-CLI + --brief (tách parse-handoff.js → 112 dòng)
- [x] trace-decision-trail.js: require parse-handoff trực tiếp (hết circular) + audit 9 scripts exports-before-CLI
- [x] format-handoff-draft.js dùng template, 158 dòng <200
- [x] format-orchestration-section.js: ORCH_GUIDANCE embed thay pointer F9
- [x] generate-resume-prompt.js: wave re-check absolute (F7), phần còn lại nguyên trạng
- [x] validate-handoff.js warn Reflect/ORCH sót (F6) + overview skip KV
- [x] Tests đủ 4 nhóm mới (round-trip+metadata, --brief, --trail CLI spawn fixture ≥2, 2-format, wave re-check); node --test 292 pass
- [x] Smoke 3 lệnh trên repo thật — metadata hết `unknown` (Branch:main/Plan/Trạng thái thật)

## Success Criteria

- [ ] Draft từ `gather-context.js` đủ 8 sections + Giả Thuyết & Dự Đoán + `**Verify:**` + Reflect 1-dòng + placeholders — fill không cần đọc reference
- [ ] `resume-handoff.js --validate --trail` exit 0 (fixture ≥2 handoffs cùng domain trong test)
- [ ] Metadata parse đúng cả `**Key:** value` (handoffs thật) lẫn `**Key**: value` — resume prompt hết `Branch: unknown`
- [ ] `--brief` trả control-plane JSON ~300 tok (không parsed sections)
- [ ] Prompt: nội dung hiện hành nguyên trạng + wave re-check absolute path
- [ ] Round-trip test pass kèm metadata; `node --test` 100%; mọi file <200 dòng; handoffs cũ parse được

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Template/parseHandoff lệch (fill xong không parse được) | Round-trip test bắt buộc, assert CẢ metadata (F1) |
| handoff-template.js vượt 200 dòng (F10: ước 160-175) | Tách ORCH_GUIDANCE sang format-orchestration-section.js |
| Regex metadata mới match nhầm bold text thường | Anchor `^`, đòi value sau space; unit test negative case (`**chú ý** text thường`) |
| Reflect comment multi-line lọt vào overview parse (F6) | Template constraint: 1 dòng/comment; test assert |
| Handoffs cũ parse lỗi | Chỉ THÊM nhánh regex + flag mới; test với handoff thật v3.0.0 |

## Security Considerations

- Không đổi sanitize layers; DATA-ONLY GUARD giữ; ORCH_GUIDANCE chỉ placeholders cho orchestrator TỰ ghi
- Wave re-check line emit absolute path script skill — không lộ path ngoài work-repo/skill dir (vốn đã hiển thị trong session)

## Next Steps

Phase 2 (SKILL.md + references) phụ thuộc draft self-guiding + `--brief` của phase này.
