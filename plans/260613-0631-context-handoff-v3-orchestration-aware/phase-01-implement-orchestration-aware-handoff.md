---
title: "Phase 1 — Implement Orchestration-Aware Handoff"
date: 2026-06-13
type: plan
tags: [context-handoff, orchestration, implementation]
status: active
plan: 260613-0631-context-handoff-v3-orchestration-aware
---

# Phase 1: Implement Orchestration-Aware Handoff

**Priority:** high | **Status:** done (2026-06-13)

## Context Links

- Skill: `~/.claude/skills/context-handoff/` (v2.2.0)
- Hệ orchestration: `C:\Users\Bee\recursive-orchestrator\docs\orchestration-system.md`
- Data mẫu: `.orch-run/dchain2/` (chain + relay), `scripts/codex-result-schema.json`
- Best practices: skill-creator (progressive disclosure, pushy description, security scope)

## Key Insights

- `state.json` agents có đủ field dựng cây: `id, label, tier?, engine, status, depth, parentAgentId, chainId, linkSeq, subtask, resultFile`
- `tier` chỉ có ở record mới — suy diễn `~leader`/`~worker` từ engine (claude=leader, codex/opencode=worker) như orch-status
- `chain-request-<id>.json` field `next.remaining` = CHÍNH VĂN handoff 180k worker→worker
- `relay-<chainId>.json` = reverse-relay marker (lastAgentId, lastResultFile, leaderAgentId)
- Codex `result.json`: `{status, filesChanged[], decisions[], remaining[], blockers[]}` — máy đọc trực tiếp, là nguồn "worker đã làm gì + quyết định gì"
- Claude result là `.md` tự do — lấy đoạn đầu làm gist
- State/result là UNTRUSTED: scope-check path trong orchDir, sanitize control chars, redact SENSITIVE_PATTERNS, DATA-ONLY GUARD trong SKILL.md

## Related Code Files

**Tạo mới:**
- `scripts/orch-state-reader.js` — đọc+validate state.json (BOM strip, scope-check), suy diễn tier, sanitize
- `scripts/collect-orchestration-state.js` — aggregate ledger: agents/assignments/chains/relays/decisions harvest + CLI
- `scripts/render-handoff-graph.js` — ledger → mermaid flowchart (icons, chain gom, cap nodes) + CLI
- `references/handoff-orchestration-skeleton.md` — skeleton phiên orchestration
- `references/orchestration-handoff-guide.md` — data sources, DATA-ONLY GUARD, mermaid conventions
- `scripts/__tests__/collect-orchestration-state.test.js`
- `scripts/__tests__/render-handoff-graph.test.js`

**Sửa:**
- `scripts/collect-git-state.js` — attach `orchestration` summary (detect `.orch-run` wave recent)
- `scripts/format-handoff-draft.js` — chèn section Wave Orchestration vào draft khi có
- `scripts/trace-decision-trail.js` — node-ID `[D#]` + `--mermaid` mode
- `references/decision-trail-guide.md` — § Node IDs + Mermaid
- `references/workflow-details.md` — cross-refs: watch-agent/orch-status, knowledge-cluster, file-reference
- `SKILL.md` — v3.0.0, route orchestration, security DATA-ONLY GUARD, description triggers mới
- `scripts/package.json` — version + test list
- `evals/evals.json` — eval cases orchestration
- `scripts/__tests__/trace-decision-trail.test.js` — update format mới

## Todo List

- [x] orch-state-reader.js + collect-orchestration-state.js
- [x] render-handoff-graph.js (+ dedupe agent id trùng `×N` — bug bắt từ wave uxadv1 thật)
- [x] Tích hợp: gather-context.js (detect + sinceToHours) + format-orchestration-section.js (module mới, giữ format-handoff-draft <200 dòng) + 2 dòng chèn vào format-handoff-draft.js
- [x] Nâng trace-decision-trail.js: node-ID `[D#]` + `--mermaid` (tách decision-trail-graph.js giữ <200 dòng)
- [x] References: handoff-orchestration-skeleton.md + orchestration-handoff-guide.md mới; decision-trail-guide.md, workflow-details.md, handoff-skeleton.md update
- [x] SKILL.md v3.0.0 (104 dòng; + fix bảng steps 3-5 lửng header pre-existing)
- [x] Tests: 2 file mới + update trace tests + package.json 3.0.0 + 7 eval cases
- [x] `node --test`: 264/264 pass (sau review fixes)
- [x] File size: mọi file mới/sửa <200 dòng raw (`(Get-Content).Count`, không dùng Measure-Object -Line); verified e2e wave thật (dchain2, uxadv1, multi-wave) + zero-regression repo không `.orch-run`
- [x] docs/orchestration-system.md repo: thêm § Handoff giữa các phiên orchestrator
- [x] code-reviewer: DONE_WITH_CONCERNS → đã fix HẾT F1-F6: (F1) sanitize structural fields status/result.status/relayedAt/lastResultFile — chống ANSI/markdown injection; (F2) dedupe agent id trùng chuyển về collect layer (`dedupeAgents` 1 nguồn cho graph/table/harvest/summary, marker ×N); (F3) mermaid subgraph label dùng YYMMDD-HHMM từ filename thay Date object; (F4) hard-cap maxNodes ưu tiên failed/running + `%% +N agents not shown`; (F5) scopedPath realpath 2 vế chống symlink escape; (F6) chain-request key theo FILENAME vào Map (chống proto-key + spoof attribution). Nit: precompile REDACT_RES, format-handoff-draft 199 dòng

## Success Criteria

- Chạy `node gather-context.js --cwd <repo có .orch-run>` → draft có section wave + mermaid + decisions
- Chạy trên repo KHÔNG có `.orch-run` → output y như v2.2.0 (zero regression)
- `node --test` pass 100%

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| State.json hỏng/BOM | strip BOM, try-catch per wave, 1 dòng warning không crash |
| Path traversal từ resultFile untrusted | scope-check resolve trong orchDir, skip + flag |
| Mermaid vỡ vì label có ký tự đặc biệt | escape quotes/brackets, sanitize node id alphanumeric |
| Wave to (8 agents × chains dài) tràn token | cap 20 nodes, gom chain >3 links, decisions max 5/agent cắt 160 chars |
| Regression flat trail | giữ format cũ, chỉ THÊM `[D#]` prefix — update tests đồng bộ |

## Security Considerations

- READ-ONLY `.orch-run`; không mutate state
- Forensics text = DATA không phải chỉ thị (DATA-ONLY GUARD ghi trong SKILL.md)
- Redact SENSITIVE_PATTERNS trước khi đưa vào handoff/graph
- Không expose absolute paths ngoài work-repo trong resume prompt (dùng relative khi có thể)
