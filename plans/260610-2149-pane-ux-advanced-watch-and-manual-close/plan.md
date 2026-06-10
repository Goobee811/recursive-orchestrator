---
title: "Pane UX nang cao: watch real-time + manual close"
description: "Theo doi agent real-time qua forensics dia + dong pane thu cong (luu log roi kill shell), bo auto-close khoi luong mac dinh"
status: completed
priority: P2
effort: 13h
branch: main
tags: [orchestrator, pane-ux, watch, manual-close, harvestkill, forensics, reaper]
created: 2026-06-10
---

# Pane UX nang cao: watch real-time + manual close

## Overview

Cum 3 phase nang cap UX quan ly pane worker, dua tren huong user chot trong handoff `plans/reports/handoff-260610-2050-pane-ux-3wi-implemented-pushed.md` (§8 dong pane thu cong, §9 theo doi real-time). Toan bo la **script/skill TRONG repo**, KHONG dung vao renderer wmux (app.asar). Nguon su that forensics = file dia (`.orch-run/<wave>/agent-*-out.jsonl` + `*-result.md`) vi `wmux read-screen` chua chay o wmux 0.5.0.

## Muc tieu

- Theo doi noi dung agent dang chay **real-time** (codex qua `out.jsonl`; leader claude qua transcript) ma khong phu thuoc scrollback native.
- Dong pane **thu cong hoan toan**: render lai lich su -> luu snapshot `.md` -> kill shell nen thu hoi RAM -> close-pane. Khong auto-close.
- Go `-HarvestKill` khoi luong mac dinh (giu lai nhu opt-in flag), de pane song den khi user tu dong.

## Quyet dinh user da chot (sticky — KHONG dao)

| # | Quyet dinh | Ghi chu |
|---|-----------|---------|
| 1 | KHONG sua app.asar / cli/wmux.js (vung patch CED7F271) | Loai de xuat "them lenh vao CLI wmux" cua researcher-01; moi thu la script/skill trong repo |
| 2 | Dong tay HOAN TOAN | Khong auto-close, khong auto-reap o luong mac dinh; `-HarvestKill` van TON TAI (opt-in), chi khong truyen mac dinh |
| 3 | Keybinding NO-GO | Kich hoat = user go lenh; AutoHotkey chi la ghi chu tuy chon ngoai scope, khong phase rieng |
| 4 | `read-screen` khong chay wmux 0.5.0 | Forensics dia la nguon DUY NHAT de doc lich su |
| 5 | Gia dinh single-window (wmux 0.5.0) | Ghi ro o moi cho dung tree/list-surfaces; giu guard reaper khi map pid |

## Key research findings

- **Keybinding NO-GO**: `wmux 0.5.0` khong co keybind/accelerator/globalShortcut (researcher-01 §3, 443 JS file 0 match) -> kich hoat bang go lenh.
- **`-HarvestKill` wiring**: chi 2 dong can comment — `orchestrate-start.ps1:101`, `orchestrator-pass.ps1:75`; `harvest-results.js:81,114` SKIP kill khi thieu `--kill`, agent van mark completed tu result (`:97-99`). Verified.
- **`createCodexRenderer`** export san tai `launch-agent-ext.js:199`, signature `(options={})` nhan `write` callback (`:58-59`) -> tai dung truc tiep replay file tinh, KHONG can tach module.
- **Mapping**: scan `.orch-run/*/state.json` -> `state.waves[].agents[]` co `id/paneId/surfaceId/wmuxAgentId/engine/resultFile` (verified `.orch-run/p7e2e/state.json:38-59`). Agent KHONG tu chua waveIndex — phai lay tu vong lap waves.
- **agentId KHONG unique across runs** (red-team F2, verified grep): `orch-root-c1` ton tai trong 63 file qua nhieu `.orch-run/*` dir. Resolver BAT BUOC disambiguation: `--state <path>` uu tien -> default state.json mtime moi nhat -> agentId match >=2 run thi ERROR liet ke. paneId thi unique theo live tree.
- **Co che session-id leader = CO `claude --session-id <uuid>`, KHONG phai env** (red-team F1, verified `claude --help` + grep): `CLAUDE_CODE_SESSION_ID` la bien claude CLI EXPORT RA (output, dung o `context-meter.js:36`), khong phai input; va `wmux agent spawn` KHONG truyen env (`pane-spawn.js:75-77`). Caller sinh UUID -> truyen co `--session-id <uuid>` qua chuoi `--cmd`.
- **Khong tao surface trong pane ton tai**: wmux khong co `new-surface --pane` (researcher-02 §5) -> watch chay trong console orchestrator hoac pane phu (split), KHONG nhet vao pane agent.

## Phases

| Phase | Name | Effort | Status |
|-------|------|--------|--------|
| 1 | [Watch agent real-time (codex + leader)](./phase-01-watch-agent-real-time-codex-leader.md) | ~5h | ✅ Completed — wave uxadv1 (W1/W2/W3) + remediation W4/W8; suite 249 PASS; review APPROVE |
| 2 | [Manual close skill (luu log roi kill)](./phase-02-manual-close-skill-luu-log-roi-kill.md) | ~6h | ✅ Completed — wave uxadv2b (W5/W6) + remediation W8 (10 findings); verify APPROVE |
| 3 | [Default-mode switch + docs + dogfood](./phase-03-default-mode-switch-docs-dogfood.md) | ~2h | ✅ Completed — orchestrator trực tiếp: docs + memory + dogfood E2E PASS (daemon no-kill → pane sống → watch 13-run disambiguation → close 9/9 exit 0 → 15 orphan reaped → 0 orphan; phát hiện + vá W9 pid-dead success path; suite 250 PASS) |

## Dependencies

- **Khong co blocking cross-plan.** Plan nen `260609-1722` chi con BASF criterion (doc lap, khong dung file cum nay). Plan `260610-1734` DONE.
- **Soft overlap**: Phase 3 sua `orchestrator-pass.ps1` + `orchestrate-start.ps1` — 2 file plan `260610-1734` da cham. Khong conflict noi dung (chi comment 2 dong), nhung worker phai pull moi nhat truoc khi sua.
- **Noi bo (red-team F14 — module resolve dung chung)**: `scripts/orch-forensics-map.js` do **Phase 1 OWN** (Phase 1 tach module resolve + ghi logic disambiguation F2). **Phase 2 cho module resolve cua Phase 1 xong truoc** (`dependencies: [1]`); neu lam song song se conflict ownership hoac 2 resolver phan ky (fix F2 khong lan sang copy). Rieng phan PS1 reaper mods cua Phase 2 (`reap-orphan-shells.ps1`: `shells[]` JSON, `-OrchestratorPane`, TOCTOU re-check) KHONG dung file cua Phase 1 -> co the lam song song voi Phase 1. Phase 3 phu thuoc Phase 1 + Phase 2 (dogfood E2E goi ca watch + manual-close).

## Red Team Review

**Session — 2026-06-10**
**Findings: 15** (15 accepted, 0 rejected; dedup tu 25 raw cua 3 reviewer: Security Adversary, Failure Mode Analyst, Assumption Destroyer)
**Severity: 2 Critical, 6 High, 7 Medium**

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| F1 | Co che session-id leader SAI (env la OUTPUT, khong phai input; `wmux agent spawn` khong truyen env) -> dung co `claude --session-id <uuid>` sinh tai caller, plumb 5 file | Critical | Accepted | Phase 1 (F5, Step 0/4, Related Files, Success criterion) |
| F2 | `agentId` KHONG unique across runs (63 file co `orch-root-c1`) -> resolver bat buoc disambiguation (`--state` > mtime moi nhat > ERROR neu match >=2) | Critical | Accepted | Phase 1 (resolver) + Phase 2 (guard moi destructive op) + plan.md |
| F3 | Resolve pid qua "doc JSON dry-run reaper" BAT KHA THI (JSON chi co pid phang, khong co cap sid<->pid) -> sua reaper them `shells:[{pid,sid,reason}]`, match dung-1-pid hoac ABORT | High | Accepted | Phase 2 (Step 3 + reaper mods) |
| F4 | `-OrchestratorPane` default `$env:WMUX_PANE_ID` chet sau resume -> close script tu resolve pane live qua `WMUX_SURFACE_ID`; khong resolve duoc -> ABORT TRUOC close-pane | High | Accepted | Phase 2 (F4/F-gate, Step, Requirements, risk) + docs Phase 3 |
| F5 | Dogfood sai co che 3 cho ("dang ky tay" khong spawn; "(dry, khong wmux)" khong ton tai; verify reaper tran -> gate stale -> exit 3 ket luan 0 orphan gia) | High | Accepted | Phase 3 (Dogfood Steps viet lai) |
| F6 | ANSI/escape injection tu output untrusted (createCodexRenderer khong strip ESC) -> sanitize C0/CSI/OSC truoc stdout + truoc ghi `.md`; test case injection | High | Accepted | Phase 1 (watch) + Phase 2 (snapshot) |
| F7 | Thieu guard close-khi-running -> slot leak vinh vien (countActive van dem, nested-guard tu choi spawn) -> doc agent.status, running/pending REFUSE; `--force` warn + bat tu mark state | High | Accepted | Phase 2 (Requirements, Steps, test) |
| F8 | Reap-fail silent + "exit 0 = killed" SAI + "sweep dinh ky" hu cau -> poll tree -> reap -> parse JSON assert pid in killed[]; retry 1; fail -> in lenh khac phuc + exit non-zero | High | Accepted | Phase 2 (Step 5) + docs Phase 3 |
| F9 | Thieu `wmux agent kill <wmuxAgentId>` -> zombie record 'running' tich -> them best-effort agent-kill TRUOC close-pane (mirror reapPane) | Medium | Accepted | Phase 2 (Step 5) |
| F10 | TOCTOU reaper (4 khoa validate luc SCAN, Stop-Process sau khong re-check; pid-reuse Windows) -> re-fetch Win32_Process + so signature+CreationDate ngay truoc Stop-Process | Medium | Accepted | Phase 2 (reaper mods, risk table) |
| F11 | Path traversal snapshot (agentId ban `..\..`) -> whitelist `/^[A-Za-z0-9._-]+$/` + assert resolved path trong orchDir | Medium | Accepted | Phase 2 (Step render+save) |
| F12 | Secret trong snapshot (aggregated_output co the chua `cat .env`) -> chay `scan-secrets.js` truoc khi ghi, redact dong match | Medium | Accepted | Phase 2 (Step render+save) + docs |
| F13 | Watch robustness (truncate respawn dong bang; offset PHAI theo byte; fixture .orch-run gitignored khong reproducible) -> reset lastSize khi size giam; `Buffer.byteLength`; commit fixture toi thieu | Medium | Accepted | Phase 1 (Steps, test fixtures) |
| F14 | Phase 1/2 "song song" mau thuan share `orch-forensics-map.js` -> Phase 1 OWN module; Phase 2 `dependencies: [1]` cho phan resolve | Medium | Accepted | plan.md (Dependencies) + phase-02 frontmatter |
| F15 | Auto-memory `dogfood-worker-lifecycle-result-based` day "dong bang -HarvestKill" -> ship xong hanh vi cu quay lai -> todo BAT BUOC: bang phan vai 3 cong cu + nhac sua memory | Medium | Accepted | Phase 3 (todo bat buoc) |

**Citation sai da sua (fact-check):**
- phase-02 ~dong 28: claim "docs ghi id doi moi resume" -> nguon dung la handoff-260610-2050 §2 (docs `:213`/`:426` chi noi ENV rong sau resume) — sua attribution.
- phase-01 citation "out.jsonl convention theo `harvest-results.js:47`" SAI — `:47` la result.json; convention dung: prompt file `agent-<id>-prompt.md` (`spawn-by-split.js:61`) -> `<base>-out.jsonl` (`launch-agent-ext.js:157-162`); resolver fallback glob `*-out.jsonl` neu convention lech.

**Quyet dinh user GIU NGUYEN (xac nhan khong dao):** dong tay hoan toan; KHONG sua app.asar/cli wmux; keybinding NO-GO; `-HarvestKill` giu opt-in; forensics dia la nguon su that. Moi finding tren la hardening / sua-gia-dinh-sai, KHONG mo rong scope.

### Whole-Plan Consistency Sweep

**Files reread sau khi sua (4):** `plan.md`, `phase-01-*.md`, `phase-02-*.md`, `phase-03-*.md`.

**Decision deltas da reconcile xuyen 4 file:**
| Delta | Tu (cu) | Sang (moi) | File anh huong |
|-------|---------|-----------|----------------|
| session-id | env `CLAUDE_CODE_SESSION_ID` cho child | co `claude --session-id <uuid>` sinh tai spawn-site, plumb 5 file | plan.md, phase-01 |
| resolver | scan flat last-write-wins | disambiguation (--state > mtime > strict-ERROR) | plan.md, phase-01, phase-02 |
| reaper pid | doc JSON `excludedPids` | reaper them `shells:[{pid,sid,reason}]`, match dung-1 | phase-02 |
| OrchestratorPane | default `$env:WMUX_PANE_ID` | resolve LIVE qua `WMUX_SURFACE_ID`, rong -> ABORT truoc close; reaper param KHONG default env | phase-02, phase-03 docs |
| reap verify | "exit code 0 = killed" | parse JSON `killed[]`; retry 1; fail -> exit non-zero | phase-02, phase-03 |
| dogfood spawn | "dang ky agent vao state" tay | nested-request-*.json / spawn-by-split | phase-03 |
| dogfood verify | reaper tran -> "0 orphan" | reaper DA VA + `-OrchestratorPane <live>` -> assert orphanCount==0 (phan biet exit 3) | phase-03 |
| sweep | "reaper sweep dinh ky don sau" | KHONG auto-sweep; user chay TAY; docs ghi ro | phase-02, phase-03 |
| sanitize/path/secret | (thieu) | F6 sanitize + F11 whitelist + F12 scan-secrets | phase-01, phase-02 |
| close-when-running | (thieu guard) | F7 status-guard REFUSE + --force | phase-02 |
| agent-kill | (thieu) | F9 `agent kill` truoc close-pane | phase-02 |
| TOCTOU | "re-check truoc kill" (sai — o scan) | F10 re-fetch Win32_Process truoc Stop-Process | phase-02 |
| dependency | phase-2 song song phase-1 | phase-2 `dependencies:[1]` (module resolve); reaper PS1 mods song song duoc | plan.md, phase-02 frontmatter |
| memory/role | "neu can" | F15 BAT BUOC: bang phan vai 3 cong cu + nhac sua memory | phase-03 |
| effort | 9h (3+4+2) | 13h (5+6+2) | plan.md, 3 phase frontmatter |
| citation | `harvest-results.js:47` (out.jsonl); "docs ghi id doi resume" | spawn-by-split.js:61 -> launch-agent-ext.js:157-162; handoff §2 | plan.md, phase-01, phase-02 |

**Grep term cu da quet (0 con sot ngoai cho mo ta finding):** `CLAUDE_CODE_SESSION_ID env cho child`, `exit code 0 = killed`, `doc JSON excludedPids`, `dang ky agent vao state` (dogfood), `dry, khong wmux`, `song song` (da reconcile), `reaper sweep dinh ky`, `get-shell-pid-by-surface`, `tham so hoa default env`, `harvest-results.js:47`.

**Verify-against-codebase trong sweep (re-grep, khong copy scout):** F1 (`launch-agent-ext.js:48-54` khong co --session-id; `context-meter.js:36` env la input cho meter), F2 (63 file co `orch-root-c1`), F3/F8 (`reap-orphan-shells.ps1:300-314` JSON pid phang, `:288-297` fail khong doi exit), F4 (`:63-69` hardcode + 64-bit gate), F10 (`:190-223` scan vs `:290` Stop-Process), spawn-site (`chain-router.js:287/293`, `spawn-by-split.js:74/87-96`, `process-nested-requests.js:150` pending), tool ton tai (`scan-secrets.js`, `crash-recovery.js:176` --mark refuse-without-wmux-cli, `safe-launch-wrapper.ps1`), nested-request mau (`.orch-run/dsplit|agfix/nested-request-orch-root.json`).

**Unresolved contradictions: 0.** (2 unresolved QUESTIONS hop le ben duoi — la cau hoi spike, khong phai mau thuan.)

## Unresolved Questions

1. **(F1 — Phase 1 buoc 0 spike se tra loi):** `claude --session-id <uuid>` co thuc su (a) chap nhan prompt positional cung luc, va (b) sinh transcript `~/.claude/projects/*/<uuid>.jsonl` khi chay QUA `safe-launch-wrapper.ps1`? Verified co co qua `claude --help` + grep, NHUNG chua chay thu end-to-end qua wrapper. Spike 5 phut bat buoc truoc khi code F5; **fail -> BO leader-watch khoi scope (validation 2026-06-10, user chot): cat F3/F5 + plumb session-id, watch chi codex; KHONG fallback mtime-heuristic.**
2. **(F4 — Phase 2 buoc verify dau se tra loi):** `$env:WMUX_SURFACE_ID` co PERSIST dung sau resume khong (de close-script tu resolve pane live)? docs `:213`/`:426` noi `WMUX_PANE_ID` rong sau resume, nhung CHUA xac nhan `WMUX_SURFACE_ID` con song. Neu ca `WMUX_SURFACE_ID` cung stale -> close-script PHAI bat user truyen `--orchestrator-pane` tuong minh (da co abort-path). Verify o buoc resolve-pane dau Phase 2.

## Validation Log

### Session 1 — 2026-06-10
**Trigger:** Post-red-team validate (mode=prompt, user chon "Validate roi cook")
**Questions asked:** 3 (range 3-8; verification pass SKIP — Red Team Review da co evidence; chi con 2 unresolved questions hop le)

#### Questions & Answers

1. **[Scope/Risk]** Phase 1: neu spike `claude --session-id` FAIL (khong sinh transcript dung ten khi chay qua safe-launch-wrapper), xu ly leader-watch the nao?
   - Options: Bo leader-watch giu codex-watch (Recommended) | Fallback scan-mtime heuristic | BLOCKED hoi lai
   - **Answer:** Bo leader-watch, giu codex-watch
   - **Rationale:** YAGNI — codex worker la doi tuong watch chinh (ghi out.jsonl lien tuc); cat scope sach hon heuristic kem chinh xac.

2. **[Architecture/Execution]** Mo hinh thuc thi cook 3 phase qua he pane wmux?
   - Options: Wave tuan tu worker codex (Recommended) | Leader Opus dan dat tron cum | Mix: codex code, orchestrator dogfood
   - **Answer:** Mix — Phase 1+2 wave worker codex; Phase 3 (docs + memory + dogfood E2E) ORCHESTRATOR tu lam truc tiep
   - **Rationale:** Dogfood can spawn/watch/close tuong tac song — orchestrator lam truc tiep hieu qua hon worker headless; docs/memory la markdown khong phai code.

3. **[Tradeoff/Safety]** Phase 2 `--force` (dong pane khi agent CON DANG chay): sau khi kill, xu ly state the nao?
   - Options: Skill TU mark failed (Recommended) | Chi in lenh user tu mark
   - **Answer:** Chi in lenh, user tu mark (giu plan hien tai)
   - **Rationale:** Skill khong tu mutate state — do rui ro ghi de state.json dang duoc daemon doc; user giu quyen quyet dinh tren destructive path.

#### Confirmed Decisions
- Spike F1 fail -> CAT leader-watch (F3/F5 + plumb), khong heuristic — propagated phase-01.
- Executor: Phase 1+2 = wave codex; Phase 3 = orchestrator truc tiep — propagated phase-03.
- Force-close giu "chi in lenh" (khong tu mark state) — phase-02 giu nguyen, danh dau CONFIRMED.

#### Action Items
- [x] Propagate phase-01 (Step 0 outcome, F3/F5 conditional, Step 4 fallback, risk row)
- [x] Propagate phase-03 (executor = orchestrator)
- [x] Phase-02 marker CONFIRMED force-close
- [x] Consistency sweep sau propagate

#### Impact on Phases
- Phase 1: spike fail-path doi tu "dung + bao lai" -> "cat leader-watch"; scope codex-watch khong doi.
- Phase 2: khong doi noi dung (confirmed).
- Phase 3: them executor note (orchestrator), worker wave chi cook Phase 1+2.

### Whole-Plan Consistency Sweep (Session 1)
- Files reread: plan.md, phase-01, phase-02, phase-03 (sau propagate)
- Decision deltas checked: 3 (spike fail-path; executor mix; force-close confirmed)
- Reconciled stale references: phase-01 Step 0/Step 4/F3/F5/risk; phase-03 Overview/executor; phase-02 marker
- Unresolved contradictions: 0 (2 unresolved questions giu nguyen — la spike, khong phai mau thuan)
