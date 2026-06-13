---
title: "Context-Handoff v3.1 - Token-Efficiency Redesign"
description: "Tái thiết kế skill context-handoff (khớp nối hệ orchestration) giảm 30-40% token/workflow, giữ nguyên features, fix bug circular require"
status: completed
priority: P1
created: 2026-06-13
completed: 2026-06-13
tags: [context-handoff, token-efficiency, skill-optimization, orchestration]
---

> **COOK DONE 2026-06-13.** 4/4 phases completed. node --test 298/0, E2E 9/9. Token giảm theo lớp: activation −30%, Creation git-only −46%, Creation+orch −57%, Resume −36~48%. Trigger coverage 100% (27 positive + 5 negative). 2 bug v3.0.0 đã fix (circular require `--trail`, metadata regex). THÊM vòng tự-sửa-sai (hypothesis→prediction→Verify→contradiction→dead-end→gate). Verify: `reports/verify-260613-token-before-after.md`.

# Context-Handoff v3.1 - Token-Efficiency Redesign

## Overview

Skill `~/.claude/skills/context-handoff` (v3.0.0, global) là **khớp nối** giữa các phiên của hệ recursive orchestration — mọi token nó tiêu bị trả lặp lại ở mọi phiên, mọi repo. Vòng này (v3.1.0): tối ưu theo **khung 4 lớp chi phí** (đo thật bởi researcher-01) + chuẩn skill-creator, THÊM **vòng guardrails tự-sửa-sai** (yêu cầu user mở rộng: giả thuyết → prediction → verify → mâu thuẫn → user review), KHÔNG cắt feature nào user đã chốt (mermaid graph, decision trail `[D#]`, orchestration ledger, resume prompt nguyên văn, housekeeping).

**Số liệu before → target:**

| Lớp chi phí | Before (đo thật) | Target | Cách |
|---|---|---|---|
| 1. Catalog (mọi phiên, mọi repo) | description 987-1.027 chars (~256 tok) | KHÔNG GIẢM (user decision 2026-06-13: recall của khớp nối đáng giá hơn token; được phép TĂNG nếu thêm trigger có giá trị) | Description tune-up chất lượng: audit trigger coverage, bổ sung phrase thiếu, không cắt |
| 2. Activation (mỗi lần kích hoạt) | 8.608 chars (~2.152 tok) | ≤6.000 chars (~1.500 tok) | SKILL.md nén route-first (nội dung chuyển vào draft output, không mất) |
| 3a. Creation git-only | ~6.072 tok | ≤4.500 tok (đã gồm guardrail sections mới) | Template embed vào script — bỏ đọc skeleton/example mặc định |
| 3b. Creation + orchestration | ~9.2k tok (red-team F5: số R1 10.189 double-count gather) | ≤7.000 tok | Orch guidance embed vào draft output |
| 3c. Resume (activate-path) | ~5.152 tok | ≤3.700 tok = activation 1.500 + brief JSON ~300 + doc ≤1.500 + trail | Control/data-plane: `--brief` JSON (stale/validation/trail) + đọc doc 1 lần (LUÔN đọc — user decision) — hết double-read script-full + doc |
| 3d. Resume (prompt-paste-path) | ~2.9k nếu activate lại | ~1.4-1.5k (prompt ~500 + doc ~900) | Prompt giữ footer "Đọc handoff file → entry files → làm việc" (user decision: luôn đọc doc); save đến từ không activate skill + không chạy script full |

**2 bug phải fix (P1):**
1. `node resume-handoff.js --validate --trail` TypeError — circular require (`trace-decision-trail.js:10` require ngược `parseHandoff` khi `resume-handoff.js` CLI chạy trước `module.exports:211`). Đường chính Resume workflow vỡ khi domain ≥2 handoffs.
2. (Red-team F1) `parseHandoff` metadata regex `resume-handoff.js:78` đòi `**Key**: value` nhưng skeleton + mọi handoff thật dùng `**Ngày:** value` → metadata parse fail âm thầm từ v2.x, resume prompt degrade `Branch: unknown / Plan: none`. Fix parser chấp nhận cả 2 format — KHÔNG đổi format doc.

## Quyết định thiết kế (adopt / reject từ research)

| Đề xuất research | Verdict | Lý do |
|---|---|---|
| Template-embedded-in-script (R3-A) | ✅ ADOPT, mở rộng cả orch section | Save ~1.2-2.5k/Creation; draft tự hướng dẫn |
| Description ~400-450 chars (R2-B) | ❌ REJECT (user decision 2026-06-13) | User: "sợi dây duy trì ngữ cảnh xuyên phiên... số tokens này đáng để bỏ ra" — chỉ tune-up chất lượng, không cắt |
| Resume prompt conditional doc-read (R3-C) | ❌ REJECT (user decision 2026-06-13) | User chọn "Luôn đọc doc như cũ" — footer prompt giữ nguyên; bỏ khối decisions-in-prompt (sẽ duplicate với doc luôn được đọc) |
| "JSON đủ thay đọc doc" (bản nháp plan v1) | ❌ REJECT (red-team F2/F3) — thay bằng control/data-plane | parseHandoff mất prose/bullets/mermaid/wikilinks/orch-plan; JSON brief làm control (stale/validate/trail), doc là nguồn nội dung duy nhất |
| Process guardrails: hypothesis→prediction→verify loop | ✅ ADOPT (user yêu cầu mới 2026-06-13) | "Tool-use là phần dễ. Tự sửa sai mới là phần khó" — Phase 3 mới: giả thuyết/dự đoán trong handoff, so prediction vs reality khi resume, protocol mâu thuẫn, checkpoint Verify, AskUserQuestion ở điểm rủi ro cao |
| Xóa `skills-keyword-map.md`, giữ `.json` (R1-W1) | ✅ ADOPT | `.md` header tự nhận là mirror; script chỉ đọc `.json` |
| References 8 → 4 file .md (R1-W2, R2) | ✅ ADOPT | Gộp examples, absorb skeletons vào script, phân bổ workflow-details |
| Snapshot/full split 2 files (R3-F) | ❌ REJECT | Vi phạm nguyên tắc đã chốt "1 doc = 1 domain"; mâu thuẫn finding context-drift của chính R3 |
| SKILL.md siêu mỏng instructions-in-output (R3-D) | ❌ REJECT | R3 tự bác: script output phình, mất orientation |
| YAML ledger thay mermaid+bảng (R3-E) | ❌ DEFER v3.2+ | YAGNI; user readability > grep-efficiency |
| Tiered mini-handoff (R3-B) | ❌ REJECT | Route "Skip" hiện có đã cover phiên ngắn; template adaptive đủ |
| Move Security ra reference (R1-W3) | ❌ REJECT | Threat model: DATA-ONLY GUARD phải always-loaded; chỉ nén câu chữ tại chỗ |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Scripts: Embedded Template + Resume Control-Plane + Bugfix](./phase-01-scripts-embedded-template-self-contained-resume-bugfix.md) | ✅ Completed |
| 2 | [Instructions: SKILL.md + Description Tune-up + References Consolidation](./phase-02-instructions-skill-md-description-references-consolidation.md) | ✅ Completed |
| 3 | [Process Guardrails: Hypothesis → Prediction → Verify Loop](./phase-03-process-guardrails-hypothesis-prediction-verify-loop.md) | ✅ Completed |
| 4 | [Verification: E2E + Token Re-Measurement](./phase-04-verification-e2e-token-re-measurement.md) | ✅ Completed |

## User Decisions (validate interview 2026-06-13 — KHÔNG tự đảo)

| Quyết định | Nội dung |
|---|---|
| Description | Không cắt theo char gate — recall ưu tiên tuyệt đối; được tăng nếu trigger mới có giá trị |
| References | Đồng ý 8→4 .md (+1 .json), template sống trong script |
| Resume doc-read | LUÔN đọc handoff doc đầy đủ khi resume (cả prompt-paste path) — không conditional |
| Guardrails (scope mới) | Agents ghi giả thuyết trước khi chạy; so prediction với result; xử lý mâu thuẫn tường minh; verifier/checkpoint; user review điểm rủi ro cao |

## Key Dependencies

- Skill GLOBAL — sửa tại `~/.claude/skills/context-handoff/`, KHÔNG đụng scripts repo recursive-orchestrator
- Node built-in only, test runner `node --test`, mọi file code <200 dòng, references ≤300 dòng
- Format `.orch-run` ổn định (verified v3); backward-compat: parseHandoff phải đọc được handoffs cũ
- Research: `research/researcher-01..03-*.md` trong plan dir này

## Dependencies

Không có cross-plan dependency. Plan `260609-1722` (pending) sửa scripts repo — không overlap file với skill global.
