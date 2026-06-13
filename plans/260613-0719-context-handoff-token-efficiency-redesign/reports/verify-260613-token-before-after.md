---
title: "Verify — Context-Handoff v3.1.0 Token Before/After + E2E"
date: 2026-06-13
type: report
tags: [verify, token-efficiency, context-handoff, e2e]
status: done
---

# Verify — Context-Handoff v3.1.0

Thang đo nhất quán **chars ÷ 4** (F13 — cùng thang R1, không trộn ÷3.5/÷3.2). Before từ researcher-01 (§1-2) + hiệu chỉnh red-team F5. After đo thật trên repo recursive-orchestrator.

## 1. Bảng Token Before → After

| Lớp chi phí | Before (tok) | After (tok) | Target | Verdict |
|---|---|---|---|---|
| **1. Catalog** (description, mọi phiên) | 256 | 272 | KHÔNG giảm (user decision: recall > token) | ✅ Báo cáo — tăng +16 do +3 trigger guardrails có giá trị |
| **2. Activation** (SKILL.md total) | 2.152 | **1.499** | ≤1.500 | ✅ PASS −30% |
| **3a. Creation git-only** | 6.072 | **3.271** | ≤4.500 | ✅ PASS −46% |
| **3b. Creation + orch** | 9.232¹ | **4.003** | ≤7.000 | ✅ PASS −57% |
| **3c. Resume** (activate-path) | 5.152 | **2.655–3.291**² | ≤3.700 | ✅ PASS −36~48% |
| **3d. Resume** (prompt-paste) | ~2.900 | **~1.400–2.000** | ~1.4–1.5k | ✅ PASS |

¹ Before 3b dùng số hiệu chỉnh ~9.2k (red-team F5: R1 10.189 double-count gather). ² doc typical 912 tok → 2.655; doc lớn nhất hiện tại (handoff ready-to-cook 1.548 tok) → 3.291. Cả hai ≤3.700.

### Thành phần after (đo thật)

| Thành phần | chars | tok |
|---|---|---|
| description | 1.089 | 272 |
| SKILL.md total (activation) | 5.996 | 1.499 |
| draft git-only (gather output) | 4.021 | 1.005 |
| draft + orch (gather --wave) | 6.947 | 1.737 |
| resume `--brief` JSON | 974 | 244 |
| handoff doc (latest) | 6.193 | 1.548 |
| audit-handoffs output (script không đổi) | — | 767 |

**Cách tính lớp 3 (formula R1: activation + outputs + must-read refs):**
- 3a = 1.499 + (gather 1.005 + audit 767) + refs **0** (draft self-guiding) = **3.271**. Before đọc handoff-skeleton 1.217 + filled-example 979 = 2.196 tok → nay BỎ.
- 3b = 1.499 + (draft+orch 1.737 + audit 767) + refs **0** (ORCH_GUIDANCE embed) = **4.003**. Before đọc skeleton+orch-skeleton+orch-guide+example = 4.656 tok → nay BỎ.
- 3c = 1.499 + brief 244 + doc đọc (912 typical / 1.548 max) + trail-guide **0** (node-ID `[D#]` tự giải thích, không must-read — F3) = **2.655–3.291**.

## 2. Test Suite

`node --test` toàn bộ scripts/: **301 pass / 0 fail / 0 skipped** (từ 264 baseline — +37 test mới: round-trip+metadata, --brief, --trail CLI spawn fixture ≥2, 2-format metadata, wave re-check absolute, validator warn, predictions parse+backward-compat, +3 từ code-review). Mọi file code <200 dòng (`resume-handoff.js` 112 sau tách `parse-handoff.js` 135; pre-existing `collect-git-state.js` 212 — ngoài scope).

## 2b. Code Review (code-reviewer agent)

0 Critical/High/Medium. 7/7 acceptance criteria verified empirically. 2 Low warn-only:
- **L2 (fixed):** empty-section check false-positive trên `## Wave Orchestration` → `### Wave` (làm bẩn validation signal của ĐÚNG orchestration path v3.1 nhắm tới) — sửa: heading có sub-heading sâu hơn không tính empty. +2 test (nested non-empty, flat vẫn empty).
- **L1 (test-locked, không sửa code):** `hasNextStepRows` placeholder detection cận biên — practically unreachable vì `renderDraft` luôn ship section Giả Thuyết → `hasPredictions` suppress. +1 regression test khoá behavior (unfilled draft → no predictions warn).

## 3. E2E Matrix (data thật)

| # | Case | Lệnh | Kết quả |
|---|---|---|---|
| 1 | Creation+orch | `gather-context.js --cwd repo --wave 5c` | ✅ Wave section + Reflect + Giả Thuyết + ORCH guidance |
| 2 | Creation git-only | temp git repo (2 commits) | ✅ 8 sections + Verify + predictions, KHÔNG wave (zero-regression) |
| 3 | Resume control-plane | `resume-handoff.js --brief --validate --trail` | ✅ JSON chỉ control fields (no sections/metadata) |
| 4 | Resume metadata (F1) | `resume-handoff.js` full | ✅ Branch=main, Plan set — hết `unknown` |
| 5 | Resume prompt | `generate-resume-prompt.js <latest>` | ✅ footer "Đọc handoff file" + Branch:main + skills catalog |
| 6 | Visualize | `render-handoff-graph.js --wave 5c` | ✅ mermaid flowchart hợp lệ |
| 7 | Cleanup | `audit-handoffs.js --json` | ✅ JSON summary đúng |
| 8 | Backward-compat | resume handoff table-metadata thật | ✅ Branch=main, 3 nextSteps, no error |
| 9 | Guardrails | chain 2 handoff prediction→miss | ✅ predictions parse; prediction-miss → dead-end `[D2]` trace xuyên phiên |

## 4. Trigger Coverage (user decision: description KHÔNG cắt)

- **Positive: 27/27 (100%)** — toàn bộ 24 phrase v3.0.0 + 3 guardrails ('kiểm tra giả thuyết', 'so dự đoán với thực tế', 'verify prediction'). 0 missing.
- **Negative: 5/5 reject** — 'fetch my calendar', 'viết journal phiên này', 'xem wave đang chạy live', 'spawn thêm worker', 'tổng kết git tuần này' — 0 false-trigger trong description.

## 5. Dangling Pointer Sweep (6 file đã xóa)

- Skill dir (SKILL.md/references/scripts/evals/__tests__): **0 hit**.
- `~/.claude/rules`: 0 hit. Memory dir: 1 hit (`always-use-context-handoff-skill.md`) → **đã cập nhật** thêm note v3.1.0 + bỏ pointer skeleton.
- Repo: 5 hit — đều trong `plans/260613-0631-*` (plan v3.0.0 done) + `handoff-260613-0824` (handoff cũ) = **snapshot lịch sử, không sửa** (policy phase-03).

## 6. Docs

`docs/orchestration-system.md` § Handoff giữa các phiên: cập nhật v3.1.0 (template embed, resume control/data-plane, vòng tự-sửa-sai). Memory always-use-skill: +note v3.1.0.

## 7. Success Criteria (plan)

- [x] Targets token lớp 2 + 3a-3d đạt (lớp 1 không gate — báo cáo số)
- [x] E2E 9/9 pass, zero-regression repo sạch + handoff cũ
- [x] Trigger coverage 100% (không mất phrase nào), negative 100%
- [x] Guardrails e2e: prediction → resume so sánh → contradiction → dead-end `[D#]`
- [x] Không dangling pointer (ngoại lệ: handoff/plan lịch sử ghi nhận)
- [x] Mọi file: code <200 dòng (trừ pre-existing collect-git-state 212), SKILL.md 5.996 ≤6.000, references ≤300 dòng

## Unresolved Questions

Không. Mọi gate PASS. Skill global đã sửa tại `~/.claude/skills/context-handoff/` (ngoài repo — commit riêng nếu user muốn version-control skill; plan/reports/docs commit vào repo).
