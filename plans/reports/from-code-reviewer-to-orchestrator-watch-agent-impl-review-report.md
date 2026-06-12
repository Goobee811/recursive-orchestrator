---
title: "Review: watch-agent skill + orch-status.js (implementation, READ-ONLY advisory)"
date: 2026-06-12
type: report
tags: [code-review, watch-agent-skill, orch-status, red-team-verify]
status: done
plan: 260612-2103-watch-agent-skill-orchestration-observability
---

# Review: watch-agent skill + orch-status.js (READ-ONLY advisory)

## Phạm vi
- **File mới:** `scripts/orch-status.js` (143d), `orch-status-read.js` (103d), `orch-status-tail.js` (108d), `spike/test-orch-status.js` (45 check), `.claude/skills/watch-agent/SKILL.md`
- **Sửa (additive):** `process-nested-requests.js`, `chain-router.js`, 2 test file, `docs/orchestration-system.md`
- **Verify:** full suite 10/10 file PASS (0 fail); real-data: discover, cross-repo `gantt-sync`→govoff, tail 240KB single-line `lead-wpatch-c1`, summary 26 run repo này; +6 micro-test correctness (safeWithin boundary, UTF-8, -n semantics, bounded cap, countPending, isValidAgentId).

## Đánh giá tổng quan
Implementation **chất lượng cao, đạt mọi acceptance criteria**, 14/14 red-team finding implement đúng + verify được trên dữ liệu thật. Doctrine bounded-reads giữ vững cả ở worst-case (file 1 dòng 500KB → đọc tối đa 256KB, KHÔNG full). Thay đổi write-path thuần additive, không phá schema/exports/test cũ. **KHÔNG có Critical/High.** Vài Nit nhỏ tùy chọn.

## A. Acceptance Criteria (phase-01) — toàn bộ PASS
| Tiêu chí | Kết quả | Dẫn chứng |
|---|---|---|
| summary repo này, root-state quét, không crash | PASS | 26 run gồm `(root)`; `lead-wpatch` in `crash:heartbeat-stale` |
| `govoff` tên trần → mrsmoke+gantt-sync | PASS | verify được |
| `gantt-sync` resolve XUYÊN repo (F1) | PASS | in `resolved → govoff/gantt-sync` + 3 agent |
| `--discover` ≥ 2 repo, sort mới-nhất-trước | PASS | govoff trên (newer mtime) |
| `--tail` codex không dump raw JSON cụt | PASS | 240KB line → 5354B + `⚠ bỏ qua sự kiện quá lớn ~26KB` |
| tail claude có/không sid | PASS | test [7] |
| record mới có `tier`; wave cũ `~tier` | PASS | diff writer; test nested/chain |
| test + suite + node --check | PASS | sạch |

## B. Red-team F1–F14 — 14/14 implement đúng
F1 cross-repo (`orch-status.js:60-67`), F2 DATA-ONLY GUARD (`SKILL.md`), F3 tier mapping (writer+reader, test [1] 6 nhánh), F4 hand-seed gap (comment+docs), F5 adaptive 64→256KB+oversized (`orch-status-tail.js`), F6 không `end()`+sanitize write, F7 claude tự byte-slice (không `--once`), F8 fallback bounded không throw, F9 all-optional+try/catch per-state+per-wave, F11 discover skip OneDrive+per-dir try/catch+sort max-mtime+root-state, F13 thứ tự heuristic, F14 isValidAgentId+safeWithin scope-check. Tất cả verify trên data thật.

## C. Regression / Contract — PASS (thuần additive)
Writer chỉ thêm `const engine`/`const from` (hoist) + dòng `tier:`; không xóa/đổi field, `module.exports` không đụng. Test cũ chỉ +assert tier, không deepEqual trọn record. Comment writer KHÔNG tham chiếu finding-code (tuân rule).

## D. Bug correctness — PASS (test biên)
- UTF-8 multibyte cắt biên slice: an toàn (partial đầu bỏ cùng dòng cụt, đuôi cắt ở `\n`; 0 U+FFFD trong body với emoji/VN/JP).
- trim 2 đầu start===0 vs >0 đúng; `-n` filter blank trước slice(-want); safeWithin prefix-collision chặn nhờ `base+path.sep`; sliceLines có 3 điều kiện thoát + cap 256KB.

## E. Bounded reads — PASS
Worst-case 1 dòng 500KB → đọc tối đa 256KB, không full. Không `readFileSync` file lớn ở path mới.

## F. KISS/DRY/YAGNI + lint — PASS
3 file <150d. `orchStateFiles` lặp logic stateFiles của orch-forensics-map nhưng CHÍNH ĐÁNG (module đó không export stateFiles + cấm sửa; comment ghi rõ).

## Findings (không Critical/High)
- **Nit-1** `discoverRepos` sort mtime thừa khi resolve (perf, <5s, không bug). → **BỎ (YAGNI)**.
- **Nit-2** `tailClaude` transcript path từ `findTranscript` chưa validate sid (non-real — spawn-time validate `/^[0-9a-fA-F-]{8,}$/`). Khuyến nghị validate trước findTranscript cho nhất quán F14. → **ÁP DỤNG**.
- **Nit-3** `relay-*` không vào countPending (đúng thiết kế) nhưng chưa có test khóa. → **ÁP DỤNG** (thêm fixture test).

## Status
**Status:** DONE
**Summary:** Implementation đạt 100% acceptance + 14/14 red-team finding verified trên data thật; thuần additive không regression. 3 Nit optional (đã áp 2, bỏ 1).
**Concerns:** Không có concern chặn merge.

### Câu hỏi mở
1. Nit-2 sid validation: đã áp dụng (`orch-status-tail.js` tailClaude).
2. Gate DoD Q4 (load skill catalog) không test trong review (chỉ test helper) — vẫn treo đúng Validation S1 Q4.
