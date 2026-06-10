---
title: 'Pane UX: empty PowerShell tab + human-readable agent output'
description: >-
  Điều tra 2 câu hỏi UX của hệ pane orchestration: tab PowerShell trống có cần
  không; display agent output thân thiện cả máy lẫn người
status: done
priority: P2
created: 2026-06-10T00:00:00.000Z
---

# Pane UX: empty PowerShell tab + human-readable agent output

## Overview

Hai câu hỏi UX từ user về hệ recursive pane orchestration (wmux):

1. **Tab "Windows PowerShell" trống** luôn xuất hiện trước tab agent trong pane worker — có cần thiết không?
2. **Hiển thị hoạt động agent** (JSONL stream trong pane codex) máy đọc tốt nhưng human khó đọc — có cách display thân thiện cả hai mà không tăng ma sát hệ thống không?

Điều tra do **Leader Opus dẫn** (wave `.orch-run/uxplan/`, investigation-only, thực nghiệm live 7 stage + render prototype). Kết luận ngắn:

- **Câu 1:** tab trống là "giàn giáo" phát sinh từ `split` (luôn tạo 1 surface mặc định) + `agent spawn` (tạo surface thứ 2). KHÔNG load-bearing — surface agent là shell `-NoExit` tự giữ pane sống. Bỏ được thuần CLI (`close-surface` sau spawn), không đụng patch app.asar. Khuyến nghị mặc định: KHÔNG LÀM GÌ (YAGNI) trừ khi user muốn bỏ vì UX.
- **Câu 2:** ĐÁNG CẢI TIẾN — render compact ANSI trong launcher giảm 97–98% ký tự/dòng, rủi ro máy ZERO (máy đọc `out.jsonl`/result/state, không đọc stdout pane). Markdown-trong-terminal không đáng; browser panel vô hiệu với đa-worker.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Research (Leader-led investigation)](./phase-01-research-leader-led-investigation.md) | Completed |
| 2 | [Synthesis and recommendation](./phase-02-synthesis-and-recommendation.md) | Completed |
| 3 | [Implementation (conditional)](./phase-03-implementation-conditional.md) | Completed |

## Key Artifacts

- `research/researcher-01-empty-powershell-tab-report.md` — Q1: 7 findings live + 3 phương án xếp hạng
- `research/researcher-02-agent-output-display-report.md` — Q2: bảng so sánh máy/human 7 phương án + prototype đo được
- `.orch-run/uxplan/agent-orch-root-c1-result.md` — executive summary của Leader
- `.orch-run/uxplan/render-test.js` — nguyên mẫu render JSONL→ANSI (tham chiếu thiết kế cho Phase 3)

## Dependencies

- Liên quan (không block): `plans/260609-1722-recursive-pane-orchestration` — hệ nền đang vận hành; Phase 3 plan này sửa 2 file thuộc hệ đó (`pane-spawn.js`, `launch-agent-ext.js`) nếu user duyệt.
- Phase 3 bị block bởi: quyết định user (3 câu hỏi trong Phase 2).

## Phát hiện phụ (ngoài phạm vi, đã surface)

**Orphan shell leak:** `close-surface`/`close-pane` gỡ UI nhưng KHÔNG giết shell `powershell -NoExit` nền (census: 10 shell mồ côi). Pre-existing, độc lập 2 câu UX. **→ ĐÃ XỬ LÝ (WI-3, 2026-06-10):** user chốt fix ngay; Leader Opus điều tra + tạo `scripts/reap-orphan-shells.ps1` (identity-based qua env `WMUX_SURFACE_ID`, dry-run mặc định, 4 lớp khoá + fail-safe); reap 9 orphan/846MB, 0 live bị đụng. Chi tiết: `.orch-run/orphfix/agent-orch-root-c1-result.md` + phase-03.
