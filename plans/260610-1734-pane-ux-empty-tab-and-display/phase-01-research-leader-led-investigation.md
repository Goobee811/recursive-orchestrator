---
phase: 1
title: Research (Leader-led investigation)
status: completed
effort: ''
---

# Phase 1: Research (Leader-led investigation)

## Overview

Leader Opus (`orch-root-c1`, wave `.orch-run/uxplan/`) dẫn điều tra 2 câu hỏi UX. Leader quyết tự làm không fan-out sub-worker (lý do có bằng chứng: Q1 cần thực nghiệm live bởi 1 actor duy nhất tránh nhiễu loạn quan sát pane/surface; Q2 tái dùng kiến thức wmux của Q1). Investigation-only — không sửa code/config/asar.

## Phương pháp

- **Q1:** thực nghiệm live 7 stage trên pane test (split / agent spawn / close-surface / close-pane / poll lifecycle / cmdline shell / orphan census) + đọc `cli/wmux.js`, `scripts/pane-spawn.js`. Không cần extract app.asar (bằng chứng hành vi đủ).
- **Q2:** `codex exec --help` + phân tích schema `out.jsonl` thật + viết prototype `render-test.js` chạy trên 2 file `out.jsonl` có sẵn (chfix/agfix) đo định lượng.

## Findings then chốt

| # | Finding | Bằng chứng |
|---|---------|-----------|
| Q1-F1 | `split` luôn tạo 1 surface terminal mặc định; response TRẢ VỀ `surfaceId` nhưng `pane-spawn.js:62` vứt đi | report 01 §F1 |
| Q1-F3 | Mọi surface là shell `powershell -NoExit` bền → surface agent TỰ giữ pane sống; tab trống KHÔNG load-bearing | report 01 §F3 |
| Q1-F5 | Pane cần ≥1 surface; đóng surface cuối → pane tự đóng (ràng buộc thứ tự cho mọi phương án) | report 01 §F5 |
| Q1-F6 | Phát hiện phụ: close-surface/close-pane orphan shell nền (10 shell census) | report 01 §F6 |
| Q2-F1 | codex không có cờ dual output; bỏ `--json` thì vỡ fallback chain-router → phải giữ | report 02 §F1 |
| Q2-F3 | Render compact ANSI giảm 97–98% ký tự/dòng, glanceable (đo trên out.jsonl thật) | report 02 §F3 |
| Q2-F4 | Lớp echo pane (`launch-agent-ext.js:136`) tách biệt hoàn toàn forensics/result/exit → blast radius render = thẩm mỹ | report 02 §F4 |

## Đầu ra

- `research/researcher-01-empty-powershell-tab-report.md` (12 KB)
- `research/researcher-02-agent-output-display-report.md` (12 KB)
- `.orch-run/uxplan/agent-orch-root-c1-result.md` (executive summary, Status: DONE_WITH_CONCERNS)
- `.orch-run/uxplan/render-test.js` (prototype tham chiếu)

## Success Criteria

- [x] Cả 2 câu hỏi được trả lời bằng bằng chứng thực nghiệm (không suy đoán)
- [x] Mọi pane test được dọn sạch (tree cuối: chỉ orchestrator + Leader; Leader pane đã được daemon harvest-kill reap)
- [x] Không file hệ thống nào bị sửa (zone: chỉ research/ + .orch-run/uxplan/ + %TEMP%)
- [x] Khuyến nghị xếp hạng kèm lý do, kể cả phương án "không làm gì"
