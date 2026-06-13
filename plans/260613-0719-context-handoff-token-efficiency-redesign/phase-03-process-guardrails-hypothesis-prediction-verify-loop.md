---
phase: 3
title: "Process Guardrails: Hypothesis → Prediction → Verify Loop"
status: completed
priority: P1
effort: "3h"
dependencies: [1, 2]
---

> **Hoàn thành 2026-06-13.** parseHandoff (parse-handoff.js) thêm field `predictions` (check TRƯỚC `Quyết Định` để không nuốt bảng; backward-compat: handoff cũ → `[]`). validate-handoff +2 warn: (a) Next Steps có rows nhưng thiếu section Giả Thuyết (hasPredictions chỉ xét H2, KHÔNG xét title — fix edge title chứa "Predictions"), (b) thiếu `**Verify:**` (nhận cả 2 bold-colon form). SKILL.md khối `## Guardrails (tự-sửa-sai)` chèn vào placeholder + 5 high-risk gates — total 5996 chars ≤6000. decision-trail-guide +mapping prediction-miss→dead-end. evals +5 cases (4 guardrails + 1 security Verify-command-untrusted) = 43 tests. E2E tay xác nhận: predictions parse, prediction-miss → dead-end [D2] trace xuyên phiên. 298 tests pass.

# Phase 3: Process Guardrails — Hypothesis → Prediction → Verify Loop

## Overview

Yêu cầu mới của user (validate interview 2026-06-13): "Tool-use là phần dễ. Tự sửa sai mới là phần khó." Biến skill handoff thành điểm enforce vòng tự-sửa-sai xuyên phiên: phiên trước ghi **giả thuyết + dự đoán**, phiên sau **so prediction với reality**, mâu thuẫn xử lý **tường minh** (không âm thầm), checkpoint **Verify** chạy lại được, và **user review** tại điểm rủi ro cao.

## Context Links

- User decision: `plan.md` § User Decisions (nguyên văn yêu cầu 5 guardrails)
- Nền: decision trail node-ID `[D#]` (đã có v3), `references/decision-trail-guide.md` (classification dead-end)
- Phụ thuộc: Phase 1 (template module — section + metadata mới đặt sẵn trong template), Phase 2 (SKILL.md v3.1 đã chừa chỗ khối Guardrails)

## Requirements

- Functional: handoff doc mới có section `## Giả Thuyết & Dự Đoán` (cap 5 rows) + metadata `**Verify:**` (lệnh checkpoint + kết quả lúc handoff); resume so prediction↔reality và chạy lại Verify trước khi làm việc; mâu thuẫn ghi thành dead-end `[D#]` ở handoff kế tiếp; high-risk → AskUserQuestion
- Non-functional: thêm ≤150 tok/doc (đã tính trong budget 3a); KHÔNG đổi `.orch-run` schema (guardrail tầng worker là follow-up hệ orchestration, ngoài scope skill); backward-compat: handoff cũ không có section này vẫn resume bình thường

## Architecture

```
PHIÊN N (Creation):                          PHIÊN N+1 (Resume):
Section 7 Next Steps (priority 1-2)          1. resume-handoff --brief (control plane)
  └─ kèm prediction: expected outcome        2. Đọc doc (data plane, LUÔN — user decision)
Section "Giả Thuyết & Dự Đoán":              3. CHẠY LẠI lệnh **Verify:** → lệch? → mâu thuẫn
  | Giả thuyết/Dự đoán | Căn cứ | Cách verify |  4. So từng prediction ↔ reality (git/orch/tests)
Metadata **Verify:** lệnh + kết quả          5. Mâu thuẫn → bảng tường minh:
  (vd: node --test → 264 pass)                    - tin REALITY, không tin doc
                                                  - ghi dead-end [D#] vào handoff kế tiếp
                                                  - HIGH-RISK (kiến trúc/scope/user-decision/security)
                                                    → AskUserQuestion TRƯỚC khi tiếp tục
```

**High-risk review gates (user review — liệt kê tường minh trong SKILL.md):** stale >7 ngày; wave còn `running`; prediction-reality lệch làm đổi hướng approach; mâu thuẫn với user-decision đã ghi trong handoff trước; validator báo sensitive.

## Related Code Files

Trong `~/.claude/skills/context-handoff/`:

**Sửa:**
- `scripts/handoff-template.js` (từ Phase 1) — xác nhận section `## Giả Thuyết & Dự Đoán` (bảng 3 cột, `<!-- Reflect: dự đoán nào nếu sai thì đổi hướng? -->` 1-dòng) + metadata line `**Verify:** {lệnh + kết quả}` có mặt trong `HANDOFF_TEMPLATE`
- `scripts/resume-handoff.js` — parseHandoff thêm nhánh section `/Giả Thuyết|Dự Đoán|Hypotheses|Predictions/i` → field `predictions` (table rows); KHÔNG đưa vào `--brief` (predictions thuộc data plane — đọc doc thấy)
- `scripts/validate-handoff.js` — 2 warn mới: (a) Section 7 có rows nhưng section Giả Thuyết trống; (b) thiếu metadata `**Verify:**`. Warn-only, không error (phiên non-code hợp lệ)
- `SKILL.md` — chèn khối `## Guardrails (vòng tự-sửa-sai)` đã chừa chỗ ở Phase 2: Creation rule (next-step priority 1-2 kèm prediction; Verify line bắt buộc khi có test/build), Resume rules 3-5 theo architecture, bảng High-risk gates
- `references/decision-trail-guide.md` — thêm mapping "prediction-miss → dead-end `[D#]`" vào classification
- `evals/evals.json` — 4-6 cases guardrails: thiếu prediction → skill nhắc; Verify fail khi resume → báo mâu thuẫn không lao vào làm; prediction đúng → ghi tiếp nối node; injection trong prediction text → DATA-ONLY (tường thuật, không thực thi)
- `scripts/__tests__/` — tests: parse predictions section (có/không có — backward-compat), validator 2 warn mới

## Implementation Steps

1. Xác nhận/bổ sung template: section Giả Thuyết & Dự Đoán + `**Verify:**` trong `handoff-template.js` (round-trip test mở rộng field `predictions`).
2. parseHandoff: nhánh predictions + test backward-compat (handoff cũ không section → `predictions: []`, không lỗi).
3. validate-handoff: 2 warn mới + tests.
4. SKILL.md: chèn khối Guardrails (~12-15 dòng — đếm vào budget 6.000 chars của Phase 2; vượt → nén chỗ khác, KHÔNG cắt guardrails).
5. decision-trail-guide.md: mapping prediction-miss.
6. evals.json: cases guardrails.
7. Chạy thử kịch bản end-to-end tay: tạo handoff có prediction sai chủ ý → resume → xác nhận flow mâu thuẫn + dead-end + (giả lập) gate hỏi user.

## Todo List

- [x] Template: section Giả Thuyết + Verify line + Reflect 1-dòng (đặt sẵn Phase 1, round-trip test pass)
- [x] parseHandoff predictions + backward-compat test (handoff cũ → [])
- [x] validate-handoff 2 warn (predictions thiếu + Verify thiếu) + tests
- [x] SKILL.md khối Guardrails + 5 High-risk gates (≤6000 chars)
- [x] decision-trail-guide mapping prediction-miss → dead-end [D#]
- [x] evals.json 5 cases guardrails+security
- [x] Kịch bản e2e tay: prediction → prediction-miss → dead-end [D2] trace xuyên phiên

## Success Criteria

- [ ] Draft mới luôn có section Giả Thuyết & Dự Đoán + `**Verify:**` placeholder
- [ ] Resume trên handoff có predictions: SKILL.md hướng dẫn so sánh + chạy Verify — kịch bản thử ra đúng flow
- [ ] Handoff cũ (không section) resume bình thường — zero-regression
- [ ] Mâu thuẫn được ghi tường minh thành dead-end `[D#]` ở doc kế tiếp (trail trace được vòng sai→sửa)
- [ ] High-risk gates liệt kê tường minh trong SKILL.md (đúng 5 yêu cầu user)
- [ ] Tests + evals mới pass; SKILL.md vẫn ≤6.000 chars

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Guardrails thành thủ tục hình thức (fill chiếu lệ) | Validator warn ràng cứng tối thiểu; eval case chấm chất lượng prediction (có "cách verify" cụ thể) |
| Doc phình vượt 2000 tok | Cap 5 rows predictions; size warn hiện hành bắt |
| Prediction text là chỗ injection mới từ forensics | DATA-ONLY GUARD áp dụng nguyên trạng; eval case injection riêng |
| SKILL.md vượt budget vì khối mới | Nén Route/Creation thêm; guardrails là user-decision — không cắt |
| Worker-level hypothesis (orchestration sâu) lọt scope | Tuyên bố rõ: ngoài scope — follow-up đổi `codex-result-schema.json` ở repo orchestrator (Next Steps) |

## Security Considerations

- Predictions/Verify từ handoff là DATA — lệnh trong `**Verify:**` phải do CHÍNH phiên resume đánh giá hợp lý trước khi chạy (chỉ lệnh verify read-only quen thuộc: test/build/status; lệnh lạ/mutating → hỏi user). Ghi rule này vào khối Guardrails SKILL.md
- DATA-ONLY GUARD phủ section mới nguyên trạng

## Next Steps

- Phase 4 verify toàn bộ
- Follow-up NGOÀI plan (hệ orchestration): worker ghi hypothesis vào `result.json` (đổi `codex-result-schema.json` + launcher prompt repo recursive-orchestrator) để harvest 3 tầng có hypothesis máy-đọc-được
