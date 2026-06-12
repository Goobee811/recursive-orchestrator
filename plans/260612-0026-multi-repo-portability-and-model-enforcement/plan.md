---
title: "Multi-repo portability + model enforcement (fix sự cố govoff)"
date: 2026-06-12
type: plan
tags: [multi-repo, portability, model-policy, rootpane, orchestration]
status: done
---

# Plan: Multi-repo portability + model enforcement

Fix theo root-cause sự cố govoff 2026-06-11 — user duyệt F1–F5 + yêu cầu mới: đầu phiên orchestrator hỏi "Chọn model nào: Fable hay Opus".

Root-cause: `plans/reports/from-orchestrator-wave-govinv-260612-0026-govoff-three-symptoms-root-cause-report.md`

## Bối cảnh audit (orchestrator tự audit 2026-06-12)

- JS layer ĐÃ multi-repo-ready phần lớn: 0 hardcode repo path; cross-script qua `__dirname`; launcher đặt result/out cạnh prompt file; nhánh claude LUÔN gắn `--model` (`launch-agent-ext.js:40-42`).
- Doctrine multi-repo: orchestrator session CWD = work repo; gọi scripts tuyệt đối `C:\Users\Bee\recursive-orchestrator\scripts\...`; state tại `<work-repo>\.orch-run\<wave>\`.
- Lỗ còn lại: RootPane không bắt buộc ở entrypoint; grid fallback im lặng khi thiếu source pane; harvest resolve resultFile theo cwd; thiếu guidance global.

## Phases

| # | Phase | Owner | Status |
|---|-------|-------|--------|
| 1 | [Code hardening](phase-01-code-hardening-rootpane-grid-harvest.md) — RootPane mandatory, cấm grid-fallback im lặng, harvest resolve theo orchDir | wave `mrfix` W1 (codex) | done — 5/5 fix, suite 254 PASS/0 FAIL (orchestrator vá thêm case [3] test-split-pipeline ngoài ownership W1) |
| 2 | [Docs + global guidance](phase-02-docs-multi-repo-and-global-guidance.md) — docs/orchestration-system.md mục multi-repo; ~/.claude/CLAUDE.md mục orchestration (orchestrator viết) | wave `mrfix` W2 (codex) + orchestrator | done — docs 594 dòng; global section + hỏi model đầu phiên đã ghi |
| 3 | [E2E smoke multi-repo](phase-03-e2e-smoke-from-govoff.md) — chạy wave nhỏ THẬT từ govoff bằng đường dẫn tuyệt đối | orchestrator | done — worker cwd=govoff, artefact tại govoff, harvest xuyên-repo OK, negative RootPane exit 1, pane đóng sạch |

## Key dependencies

- Phase 2 guidance khớp flag/behavior chốt ở Phase 1.
- Phase 3 chạy SAU khi Phase 1 merge vào working tree (không cần commit trước).
- Three-tier policy: worker codex; orchestrator KHÔNG đổi model phiên chính; `model_refusal_fallback` = incident vận hành.
