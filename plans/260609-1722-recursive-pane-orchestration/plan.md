---
title: "Recursive Pane Orchestration System (Hybrid: nen wmux-orchestrator + delta)"
description: "Mo rong plugin wmux-orchestrator@0.1.1 da cai san: them Codex engine, nested recursion, chuoi 180k continuation + reverse-relay handoff, context-meter, va 4 lop an toan. KHONG build lai phan plugin da co."
status: pending
priority: P1
created: 2026-06-09
blockedBy: []
blocks: []
---

# Recursive Pane Orchestration System — Hybrid (nền plugin + delta)

## Overview

Sau red-team: máy đã cài sẵn **`wmux-orchestrator@0.1.1`** làm gần hết phần "spawn agent vào pane wmux + điều phối wave". Hướng đã chốt với user = **Hybrid**: dùng plugin làm nền, chỉ **build phần delta** mà plugin chưa có (Codex engine, nested recursion, chuỗi 180k + reverse-relay, context-meter, 4 lớp an toàn). Không xây lại layout/spawn/registry/monitor/dashboard.

**Khả thi: CAO (đã có baseline production).** 2 blocker cũ (`--pane`/`--cmd` auto-run) đã được `spawn-agents.sh:62-91` chứng minh chạy thật. Blocker còn lại = **nested recursion** (worker tự spawn sub-worker), cần spike riêng.

## Gap Analysis — plugin có gì vs build gì

| Năng lực | Plugin đã có | Delta cần build |
|---|---|---|
| Detect wmux + degraded mode | ✅ `detect-wmux.sh` | — |
| Decompose + file-ownership (allowed/excluded) | ✅ `SKILL.md` Phase 3 | Runtime **enforce** (write-fence) — plugin chỉ ghi vào prompt, không chặn |
| Wave plan + parallel trong wave | ✅ flat waves max 5 | **Nested recursion** (worker→leader, pane con) |
| Coupling drift (VD VI/EN) | ✅ `wave-{N}-contract.md` (Phase 4.5) | Tận dụng nguyên |
| Layout + spawn vào pane | ✅ `spawn-agents.sh` (layout grid + `--pane --cmd`) | Spike spawn từ **pane worker** (nested) |
| Registry | ✅ `state.json` | Mở rộng cho cây nested + chuỗi continuation |
| Monitor + live dashboard | ✅ sidebar watch `state.json` | — |
| Agent engine | ✅ `launch-agent.js` (claude/opencode) | **Thêm Codex branch** + Leader đọc `-o` |
| Result/handoff | ✅ 1 result file/agent | **Chuỗi 180k continuation** + **reverse-relay** về Leader |
| Đo context 180k | ❌ không có | **context-meter** (dùng `CLAUDE_CODE_SESSION_ID`) |
| An toàn (backup/denylist/secret/fence) | ❌ full bypass, không enforce | **4 lớp an toàn** |
| Decision trail chuỗi | ⚠️ `context-handoff --trail` (slug-prefix, order theo phút) | Sửa thành **chainId + seq** (fix H5) |

## Kiến trúc Hybrid

```
Orchestrator (Claude Opus) = plugin /orchestrate (Phase 0-9)
  ├─ decompose → wave plan (PLUGIN) + nested cho luồng cần đệ quy (DELTA)
  ├─ spawn-agents.sh → layout grid + agent spawn --pane --cmd (PLUGIN)
  │     └─ launch-agent.js: claude | opencode | CODEX (DELTA branch)
  ├─ worker chạy 1 luồng; >180k → continuation chain qua worker kế (DELTA)
  │     └─ worker có sub-task → tự spawn sub-worker vào pane con (DELTA, nested)
  ├─ Wn cuối chuỗi → reverse-relay về Leader → Orchestrator (DELTA)
  ├─ Leader đọc result/-o (kể cả Codex) → handoff tổng (DELTA)
  └─ monitor qua state.json + sidebar (PLUGIN); collect-results + reviewer (PLUGIN)
An toàn: backup+denylist, data-fence, secret-scan, runtime write-fence bọc launch path (DELTA)
```

## Quyết định đã chốt với user

| # | Quyết định | Ghi chú |
|---|---|---|
| Hướng | **Hybrid**: nền plugin + build delta | red-team C1 |
| Khởi chạy | `agent spawn --pane --cmd` (đã chứng minh chạy) | qua `spawn-agents.sh` |
| Codex v1 | **GIỮ** — Leader (Claude) đọc `-o` output viết handoff cho Codex | dùng `--output-schema` để parse được |
| Đa tầng | **GIỮ nested recursion** (worker→leader, pane con) | KHÁC flat-waves plugin → cần spike |
| Ngưỡng | 180k: <180k làm tiếp đoạn nữa; ≥180k handoff worker kế; Wn → ngược về Leader | continuation chain |
| Đo 180k | `CLAUDE_CODE_SESSION_ID` (đã verify tồn tại) + đếm work-units primary, token = safety eject | né auto-compact non-monotonic (M4) |
| An toàn | **Cả 4 lớp**: backup+denylist, data-fence+secret-scan, crash-recovery (heartbeat+marker), runtime write-fence | red-team C2-C4, H4 |
| Repo home | **Repo riêng + git init** (vd `C:\Users\Bee\orchestrator`, tên tạm) — tích hợp wmux/Claude/Codex/ClaudeKit như runtime NGOÀI; KHÔNG nuốt wmux binary / cmux config | validate Q1 |
| ClaudeKit | Không đóng gói skill riêng — chỉ cần `ck` global hoạt động khi `cd` vào repo | validate Q2 |
| Codex sandbox | `danger-full-access` (full bypass) → Phase 6 (backup/denylist/write-fence) là BẮT BUỘC | validate Q2 |
| Ngưỡng trigger | Trigger **sát 180k** (không biên 150k) → crash-recovery marker là cơ chế chống mất tiến độ chính | validate Q3 |
| Nested limit | depth **5**, đồng thời **8** | validate Q4 |

## Blocker còn lại (sau khi 2 blocker cũ đã giải)

- **Nested spawn từ pane worker:** `split`/`layout grid` thao tác trên focused/anchor surface; worker là 1 claude instance trong pane riêng — liệu nó gọi được `layout grid --anchor-surface <surface của nó>` để tạo pane con? CHƯA verify → spike Phase 1.

## Phases

| Phase | Tên | Priority | Phụ thuộc | Status |
|-------|------|----------|-----------|--------|
| 1 | [Repo Bootstrap + Baseline + Nesting Spike](./phase-01-spike-verify-wmux.md) | P1 | — | ✅ Done — baseline PASS; nested=FALLBACK ([spike report](../reports/spike-260609-nested-spawn-capability-report.md)) |
| 2 | [Codex Engine + Wrapper Protocol](./phase-02-file-protocol-scaffolding.md) | P1 | P1 | ✅ Done — codex headless verified (direct + wmux pane), result đúng schema + JSONL forensics; plugin gốc nguyên |
| 3 | [Context Meter (180k)](./phase-03-context-meter.md) | P2 | — | ✅ Done — meter 5 nhánh pass; child worker có session-id riêng, scan-UUID tìm đúng transcript con |
| 4 | [Nested Recursion Engine](./phase-04-orchestration-engine.md) | P1 | P1 | ✅ Done — FALLBACK (Orchestrator trung gian): guard chốt cứng + register nested wave + request/response; 32 test PASS + e2e spawn thật; 4 hardening (C1/C2/H1/H2); GO-nested bỏ (YAGNI per spike) |
| 5 | [Continuation Chain + Reverse-Relay](./phase-05-handoff-chain-lifecycle.md) | P1 | P2,P3 | 🚧 In-progress — 5A reconcile (**H3 giải**) ✅ + 5B chain/reverse-relay ✅ (104 test PASS, review pass); 5C leader-aggregate pending |
| 6 | [Safety Layers](./phase-06-safety-layers.md) | P1 | P2 | ✅ Done — 4 lớp (backup+git+denylist+write-fence, data-fence, secret-scan, crash-recovery heartbeat+marker) bọc launch path **opt-in** (default off → Phase 4/5 zero regression); 64 test PASS; review fix H1(fence wiring)/H2(false-crash)+M1-M4 |
| 7 | [E2E Test + Default Mode Packaging](./phase-07-default-mode-packaging.md) | P2 | P4,P5,P6 | Pending |

## Rủi ro tổng

- **[VERIFIED 2026-06-09 — confirmed]** Nested spawn KHÔNG khả thi sạch từ pane worker: `layout grid --anchor-surface` reshape phẳng + gom nhầm surface orchestrator; `split` không có anchor (chỉ focused pane → focus-steal/race). → Phase 4 dùng **Orchestrator trung gian** (worker ghi intent → Orchestrator spawn hộ, registry chain giữ cây nested logic). Chi tiết: [spike report](../reports/spike-260609-nested-spawn-capability-report.md).
- **[RESOLVED 2026-06-09 — Phase 5A]** H3 (nested/chain child kẹt `running`): `wmux agent spawn` không nhận hook `on-agent-stop` (chỉ native subagent). → `reconcile-agents.js` poll `wmux agent list` mỗi monitor pass → `exited`→terminal + giải phóng slot + đóng wave. Verified 27 test + daemon thật.
- **Sửa plugin (`launch-agent.js`) làm hỏng path claude/opencode** → fork bản copy thay vì sửa in-place; giữ plugin gốc nguyên vẹn.
- **180k token non-monotonic do auto-compact** → đếm work-units là primary, token chỉ safety eject.
- **Codex chết trước khi ghi `-o`** → capture `--json` ra file + Leader verify diff file đích trước khi báo done.
- Phiên bản plugin nâng cấp → delta patch có thể lệch; ghim version `0.1.1` + kiểm tra trước khi chạy.

## Dependencies (cross-plan)

Không có. Plan `260531-1634-basf-ppm-marketing-master-plan` là domain marketing, độc lập hoàn toàn.

## Red Team Review

### Session — 2026-06-09
**Reviewers:** 4 (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic) — Full tier.
**Findings:** 16 sau dedup (5 Critical, 7 High, 4 Medium). Tất cả có `file:line` evidence (pass evidence filter).
**Kết quả:** User chọn **Hybrid** (C1), **giữ Codex v1** (M1), **giữ nested recursion** (M2), **áp dụng cả 4 lớp an toàn** (C2-C4, H4). Plan đã viết lại theo các quyết định này.

**Phát hiện lật bàn (verified độc lập phiên này):**
- Đã cài sẵn plugin `wmux-orchestrator@0.1.1` (`~/.claude/plugins/cache/wmux-orchestrator/0.1.1/`) implement gần hết: decompose→waves, `layout grid`, `agent spawn --pane --cmd`, `state.json` registry, `launch-agent.js` (quoting-safe qua execFileSync `--`), monitor, coupling-contract, degraded-mode.
- `spawn-agents.sh:62-91` chứng minh `--pane`+`--cmd` auto-run CHẠY THẬT → 2 blocker Phase 1 đã giải.
- `CLAUDE_CODE_SESSION_ID` env var tồn tại + transcript path đúng → Phase 3 self-discovery phần lớn được giải.

| # | Finding | Sev | Disposition | Áp dụng vào |
|---|---------|-----|-------------|------------|
| C1 | Plugin `wmux-orchestrator` đã cài, làm gần hết → đừng build lại (`spawn-agents.sh:62-91`) | Critical | **Accept** | Hybrid: toàn plan |
| C2 | Worker full bypass + đệ quy + non-git → blast radius vô biên, không rollback (`launch-agent.js:34-41`) | Critical | **Accept** | Phase 6 |
| C3 | Spec/handoff/Codex-output injection dưới bypass; here-string `'@` RCE | Critical | **Accept** | Phase 6 (data-fence, codegen-safe) |
| C4 | Worker chết giữa "đo 180k" và "handoff" → mất tiến độ + file dở | Critical | **Accept** | Phase 6 (crash-recovery) |
| C5 | context-meter fail-state chưa định nghĩa + race newest-mtime | Critical | **Accept (mod)** | Phase 3 (env var + fail-state) |
| H1 | Phase 1 "blocker" đã giải bởi `spawn-agents.sh` | High | **Accept** | Phase 1 thu còn baseline + nesting spike |
| H2 | `--pane` mislabel "verified" (CLI-parse-only) | High | **Accept** | đã sửa (gap table) |
| H3 | Registry ghi SAU spawn, không lock → orphan/clobber | High | **Accept** | dùng plugin `state.json` + intent-before-spawn |
| H4 | file-ownership không enforce runtime → parallel nhầm file | High | **Accept** | Phase 6 (write-fence) |
| H5 | `--trail` fuzzy (slug-prefix + order theo phút) | High | **Accept** | Phase 5 (chainId + seq) |
| H6 | Reverse-relay `chain_end` không ai đọc → termination undefined | High | **Accept** | Phase 5 (định tuyến qua state) |
| H7 | Codex `-o` chỉ last-message + chết trước khi ghi | High | **Accept** | Phase 2/5 (output-schema + capture --json + verify diff) |
| M1 | Codex v1 gold-plating | Medium | **User giữ** | Phase 2 (giữ Codex) |
| M2 | Nested recursion premature | Medium | **User giữ** | Phase 4 (giữ nested) |
| M3 | Phase 7 packaging premature | Medium | **Accept** | Phase 7 (defer "always" tới khi proven) |
| M4 | auto-compact → token non-monotonic | Medium | **Accept** | Phase 3 (work-units primary) |

**Whole-Plan Consistency Sweep (2026-06-09):**
- Files reread: plan.md + phase-01..07 (7 phase).
- Decision deltas checked: 8 (Hybrid pivot, 2 blocker cũ đã giải, giữ Codex, giữ nested, 4 safety, chainId+seq thay slug/chain_end, CLAUDE_CODE_SESSION_ID, work-units primary).
- Reconciled: deps plan.md-table ↔ phase frontmatter KHỚP cả 7; titles KHỚP; Codex flags nhất quán; phase-06 đổi sang safety-layers + e2e dời sang phase-07 (link đã sửa); bỏ hết "Sự thật đã verify"/"2 blocker" cũ.
- Unresolved contradictions: 0. (Cosmetic: vài filename slug cũ — `file-protocol-scaffolding`, `orchestration-engine`, `handoff-chain-lifecycle` — giữ nguyên để tránh phá ck; title/H1 bên trong đã chính xác.)

## Validation Log

### Session — 2026-06-09
**Câu hỏi:** 6 (4 critical + 2 follow-up repo/ClaudeKit). Verification pass: BỎ QUA (guard — Red Team Review đã có evidence; Failed=0).

**Quyết định chốt:**
- **Repo riêng + git init** (Q1): dời hệ thống ra repo mới (vd `C:\Users\Bee\orchestrator`, tên tạm) → giải gốc rollback-gap (red-team C2/C4). wmux (binary Electron) + cmux (config WezTerm) GIỮ NGOÀI; wmux tích hợp qua plugin mechanism. Plan + scripts di chuyển sang repo mới ở Phase 1.
- **ClaudeKit nhẹ** (Q2-followup): không đóng gói skill riêng; chỉ cần `ck` global dùng được khi `cd` vào repo.
- **Codex `danger-full-access`** (Q2): giữ full bypass → Phase 6 (backup/denylist/write-fence) là BẮT BUỘC, không phải tùy chọn; bỏ gợi ý hạ `workspace-write`.
- **Trigger sát 180k** (Q3): không dùng biên 150k → crash-recovery marker (Phase 6) là cơ chế chống mất tiến độ CHÍNH.
- **Nested depth 5 / đồng thời 8** (Q4).

**Propagate:** Phase 1 (+repo bootstrap, retitle), Phase 4 (depth 5/đồng thời 8), Phase 6 (trigger 180k + bỏ workspace-write + nhấn marker), Phase 7 (repo riêng + ck global).

### Whole-Plan Consistency Sweep (validate)
- Files reread: plan.md + phase-01..07.
- Decision deltas: 5 (repo riêng, full bypass, 180k no-margin, depth 5/8, ck global).
- Reconciled: Phase 1 title (+bootstrap), Phase 4 limits 5/8, Phase 6 180k + full-bypass + gỡ gợi ý workspace-write, Phase 7 repo home.
- Unresolved contradictions: 0. **Verification Failed=0 → plan đủ điều kiện cook.**
