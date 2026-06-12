---
title: "Skill /watch-agent - quan sat nhanh orchestration sessions"
description: "Skill project-local /watch-agent [target]: từ repo này nhìn nhanh mọi orchestration session (repo bất kỳ) — ai phân công gì, leader/worker đang nghĩ/làm gì; kèm helper scripts/orch-status.js"
status: pending
priority: P2
created: 2026-06-12
---

# Skill /watch-agent - quan sat nhanh orchestration sessions

## Overview

User cần gõ `/watch-agent [tên session]` tại repo `recursive-orchestrator` và nhận ngay báo cáo: orchestrator ở các session khác (vd govoff, wmux session 2) đang phân công ra sao, leader/worker đang tư duy + hành động thế nào.

Nguyên liệu đã có đủ trên đĩa (không cần spawn gì, READ-ONLY 100%):

| Nguồn | Cho biết |
|-------|----------|
| `<work-repo>\.orch-run\<wave>\state.json` | phân công: id, label, subtask, engine/tier, status, depth, timestamps |
| `nested-request/response-*.json`, `chain-request-*`, `relay-*` | intent ủy quyền đang chờ/đã xử |
| `agent-<id>-out.jsonl` (codex) | hành động + "tư duy": lệnh `$`, ✓/✗, ✎ file, ▣ result decisions |
| `agent-<id>-result.{json,md}` | kết luận worker |
| `claudeSessionId` → `~/.claude/projects/<slug>/<uuid>.jsonl` | leader/worker claude: thinking + messages |

Thiếu duy nhất: **bộ tổng hợp 1-lệnh** (hiện `watch-agent.js` chỉ soi 1 agent, không có cái nhìn wave/phân công). → Phase 1 thêm `scripts/orch-status.js` (mỏng, tái dùng `orch-forensics-map.js` + `createCodexRenderer`); Phase 2 viết SKILL.md điều phối các công cụ; Phase 3 validate trên dữ liệu thật (wave `gantt-sync` govoff do session 2 vừa chạy 2026-06-12 20:50 — 2 đợt, 3 worker codex, completed).

Mode: fast (task nhỏ, rõ, chỉ chạm repo này + `.claude/skills/` local). YAGNI: không build daemon/UI; chỉ script tổng quan + skill hướng dẫn.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Helper script orch-status](./phase-01-helper-script-orch-status.md) | Pending |
| 2 | [Skill watch-agent SKILL.md](./phase-02-skill-watch-agent-skill-md.md) | Pending |
| 3 | [E2E validation va docs](./phase-03-e2e-validation-va-docs.md) | Pending |

## Dependencies

- Không block / không bị block bởi plan nào (4 plan trước đều done; xây trên tooling đã ship ở `260610-2149` + `260612-0026`).
- Three-tier + multi-repo doctrine: theo `docs/orchestration-system.md` (Multi-repo mode) — skill chỉ ĐỌC, không spawn/kill nên không đụng RootPane/reaper.

## Quyết định thiết kế chốt

1. **Skill project-local** tại `.claude/skills/watch-agent/SKILL.md` repo này (user: "ngay tại repo recursive-orchestrator này là đủ").
2. **`[tên session]` resolve linh hoạt** (thứ tự): absolute path (state.json | wave dir | repo) → tên wave dưới `<cwd>\.orch-run\` → tên repo `C:\Users\Bee\<tên>` có `.orch-run` (quét mọi wave, mới nhất trước) → không arg = discovery (cwd + các work-repo đã biết, tối thiểu govoff).
3. **Tách vai 2 công cụ:** `orch-status.js` = tổng quan wave + tail nhanh codex; `watch-agent.js` (sẵn có) = soi sâu 1 agent (codex replay/claude transcript).
4. **Bounded reads mọi nơi** — không cat nguyên out.jsonl/transcript (15MB bài học govinv); tail theo byte slice.
5. Orchestrator session của repo đích KHÔNG nằm trong `.orch-run` — "orchestrator đang nghĩ gì" đọc best-effort từ jsonl mtime mới nhất trong `~/.claude/projects/<slug>/`, tail bounded, chỉ đọc.
