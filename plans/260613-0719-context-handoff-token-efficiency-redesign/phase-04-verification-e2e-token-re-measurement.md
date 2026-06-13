---
phase: 4
title: "Verification: E2E + Token Re-Measurement"
status: completed
priority: P1
effort: "2h"
dependencies: [3]
---

> **Hoàn thành 2026-06-13.** Báo cáo: `reports/verify-260613-token-before-after.md`. node --test 298/0. E2E 9/9 data thật. Token (chars÷4): activation 1499≤1500, 3a 3271≤4500 (−46%), 3b 4003≤7000 (−57%), 3c 2655–3291≤3700, 3d ~1.4–2k. Lớp 1 description 272 tok (tăng +16 — user decision không gate). Trigger coverage 27/27 positive + 5/5 negative reject. Grep sweep: skill dir 0, rules 0, memory 1 (đã cập nhật), repo 5 (snapshot lịch sử). docs/orchestration-system.md + memory cập nhật v3.1.0.

# Phase 4: Verification — E2E + Token Re-Measurement

## Overview

Chứng minh bằng số liệu: targets token đạt (lớp 2-3 — lớp 1 description theo user decision không có gate giảm), zero-regression, trigger coverage không tụt so v3.0.0, guardrails hoạt động, không dangling pointer. Bước 5 (eval + iterate) của benchmark-optimization-guide — không đạt gate nào thì quay lại phase tương ứng, KHÔNG hạ gate.

## Context Links

- Baseline before: [[researcher-01-runtime-token-flow-report]] §1-2 (số đo thật v3.0.0)
- Targets: `plan.md` bảng before→target

## Requirements

- Functional: mọi workflow chạy đúng trên data thật; handoffs cũ vẫn resume được
- Non-functional: đạt targets token lớp 2 + 3a-3d; 100% tests pass; mọi file size limits giữ

## Implementation Steps

1. **Test suite:** `node --test` toàn bộ trong `scripts/` — 100% pass (số test ≥ trước, có regression --trail).
2. **E2E matrix (data thật):**

   | Case | Lệnh | Expect |
   |---|---|---|
   | Creation+orch | `gather-context.js --cwd C:/Users/Bee/recursive-orchestrator` | Draft: 8 sections + Reflect 1-dòng + Wave section + mermaid + ORCH_GUIDANCE — đủ fill không cần đọc reference |
   | Creation git-only | Chạy trên temp git repo không `.orch-run` | Draft đầy đủ, KHÔNG section wave — zero-regression |
   | Resume control-plane | `resume-handoff.js --brief --validate --trail` trên `plans/reports/` (domain ≥2 handoffs) | Exit 0; JSON chỉ control fields (file/ageDays/staleWarning/validation/trail `[D#]`) ~300 tok; KHÔNG TypeError |
   | Resume metadata (F1) | `resume-handoff.js` (full) trên handoff thật | metadata ra Branch/Plan/Trạng thái THẬT — hết `unknown/none/unknown` |
   | Resume prompt | `generate-resume-prompt.js <handoff mới nhất>` | Prompt: nội dung + footer "Đọc handoff file → ..." nguyên trạng v3.0.0; (orch case) wave re-check ABSOLUTE path |
   | Visualize | `render-handoff-graph.js --cwd ...` + `trace-decision-trail.js --mermaid` | Mermaid hợp lệ, không đổi vs v3.0.0 |
   | Cleanup | `audit-handoffs.js --dir plans/reports --json` | JSON như v3.0.0 |
   | Backward-compat | `resume-handoff.js` trên handoff format cũ (cả metadata `**Key:** value`) | Parse đủ fields, không lỗi |
   | Guardrails | Draft mới + fill thử + resume lại | Draft có section `## Giả Thuyết & Dự Đoán` + metadata `**Verify:**`; parseHandoff trả `predictions` (doc là data plane — `--brief` KHÔNG chứa); doc fill thiếu prediction khi Section 7 có rows → validate-handoff warn |

3. **Token re-measurement:** đo lại 4 lớp bằng MỘT thang chuẩn chars ÷ 4 (F13 — R1 dùng ÷4, không trộn ÷3.5): description, SKILL.md body, output từng script trên cùng data (gồm `--brief`), references must-read per workflow. Ghi bảng before/after vào `reports/verify-260613-token-before-after.md` (trong plan dir). Before 3b dùng số đã hiệu chỉnh ~9.2k (F5). PASS = đạt targets lớp 2 + 3a-3d trong plan.md (lớp 1 description: chỉ báo cáo số, không gate).
4. **Trigger coverage (user decision: description không cắt):** chấm checklist evals trigger section (Phase 2): description sau tune-up phải cover 100% trigger phrases của v3.0.0 (KHÔNG MẤT phrase nào — ghi bảng từng phrase) + các phrase mới cho guardrails nếu Phase 2/3 thêm; negative cases 100% reject. Miss phrase nào → bổ sung lại vào description, re-chấm.
5. **Grep sweep toàn cục:** tìm references tới 6 file đã xóa trong: skill dir, `plans/reports/handoff-*.md`, `docs/`, memory dir, `~/.claude/rules/`. Hit nào còn → cập nhật hoặc ghi nhận acceptable (handoff cũ snapshot lịch sử — không sửa).
6. **Docs + memory:** cập nhật `docs/orchestration-system.md` § Handoff giữa các phiên (vòng guardrails hypothesis→verify + resume control/data-plane `--brief`); memory luôn-dùng-skill vẫn đúng — không đổi.
7. **Báo cáo verify** lưu plan dir `reports/`, kèm unresolved questions nếu còn.

## Todo List

- [ ] node --test 100%
- [ ] E2E matrix 9 cases pass
- [ ] Bảng token before/after — đạt targets lớp 2, 3a-3d (lớp 1 không có gate giảm)
- [ ] Trigger coverage 100% phrases v3.0.0 + negative 100%
- [ ] Grep sweep 6 file đã xóa — sạch
- [ ] docs/orchestration-system.md cập nhật
- [ ] Báo cáo verify

## Success Criteria

- [ ] Targets token lớp 2 + 3a-3d trong plan.md đạt (số liệu trong báo cáo)
- [ ] E2E 9/9 pass trên data thật, zero-regression repo sạch + handoff cũ
- [ ] Trigger coverage 100% (không mất phrase nào so v3.0.0), negative 100%
- [ ] Guardrails e2e: prediction → resume so sánh → contradiction protocol chạy đúng kịch bản thử
- [ ] Không dangling pointer (ngoại lệ: handoff lịch sử ghi nhận)
- [ ] Mọi file: code <200 dòng, SKILL.md + references trong limit

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Target token hụt sát nút (vd Creation 4.6k vs target 4.5k) | Không hạ gate — tìm thêm nén ở draft output (bỏ section trống adaptive); báo user nếu trade-off chất lượng |
| Guardrail sections làm doc vượt budget 2000 tok | Size warn validator hiện hành bắt; section Giả Thuyết cap 5 rows |
| Temp repo test thiếu giống thật | Dùng `git init` + 2 commits giả lập + 1 file staged — đúng các nhánh code collect-git-state |

## Security Considerations

- Re-run 7 security evals hiện có (DATA-ONLY GUARD, injection-as-data) — phải pass nguyên trạng

## Next Steps

Hoàn tất → `/ck:journal` + commit skill (global dir — không thuộc repo này; plan/reports commit vào repo).
