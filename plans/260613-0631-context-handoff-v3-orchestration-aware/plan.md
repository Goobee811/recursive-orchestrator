---
title: "Context-Handoff v3 — Orchestration-Aware Handoff Ledger"
date: 2026-06-13
type: plan
tags: [context-handoff, skill-upgrade, orchestration, mermaid, decision-trail]
status: done
---

# Plan: context-handoff v3.0.0 — Orchestration-Aware

Nâng skill global `~/.claude/skills/context-handoff` (v2.2.0 → v3.0.0) thành **khớp nối** của hệ recursive orchestration: ghi nhận chuỗi handoff đa tầng Orchestrator → Leader → Worker → (chain 180k) → reverse-relay → Leader → Orchestrator, render mermaid graph cho user, duy trì decision tree có node-ID qua các phiên cho AI.

## Gaps (verified từ code)

| # | Gap | Bằng chứng |
|---|-----|-----------|
| 1 | Skill mù orchestration | `gather-context.js` chỉ đọc git; `.orch-run/<wave>/` có state.json (parentAgentId/tier/chainId/linkSeq), chain-request (chính là handoff text 180k), relay, result.json codex structured decisions[] — bị bỏ qua hoàn toàn |
| 2 | Mermaid phải vẽ tay | skeleton `## Sơ Đồ Hệ Thống` là placeholder, không auto-generate dù data đầy đủ trên đĩa |
| 3 | Decision trail flat | `trace-decision-trail.js` ra 3 bullet list; không node-ID, không tree, không mermaid |
| 4 | Cross-skill mỏng | `workflow-details.md` thiếu watch-agent/orch-status, knowledge-cluster, file-reference |

## Phases

| Phase | Nội dung | Status |
|-------|----------|--------|
| [Phase 1](phase-01-implement-orchestration-aware-handoff.md) | Scripts mới (orch-state-reader, collect-orchestration-state, render-handoff-graph) + nâng gather/trail + skeleton/references + SKILL.md + tests + evals | done |

## Key Dependencies

- Format `.orch-run` đã ổn định (verified: dchain2, p7pack waves + `codex-result-schema.json`)
- Skill GLOBAL — KHÔNG phụ thuộc scripts repo recursive-orchestrator (tự đọc state.json, portable mọi work-repo)
- Node built-in only (no deps), test runner `node --test`
- READ-ONLY tuyệt đối với `.orch-run` + DATA-ONLY GUARD (học từ skill watch-agent)

## Success Criteria

- `gather-context.js` tự phát hiện wave recent → draft chứa bảng wave + mermaid + decisions harvest 3 tầng
- `render-handoff-graph.js` ra mermaid hợp lệ: assignment edges, chain dashed, relay thick, status icons, cap 20 nodes
- `trace-decision-trail.js` có node-ID `[D#]` + `--mermaid` mode; flat trail backward-compat
- Toàn bộ `node --test` pass; file code <200 dòng/file
- SKILL.md <300 dòng, references <300 dòng/file
