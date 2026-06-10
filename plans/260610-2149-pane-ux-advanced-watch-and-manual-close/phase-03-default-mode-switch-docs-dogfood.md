---
phase: 3
title: "Default-mode switch + docs + dogfood"
status: pending
priority: P2
effort: 2h
dependencies: [1, 2]
---

# Phase 3: Default-mode switch + docs + dogfood

<!-- Updated: Validation Session 1 - executor = ORCHESTRATOR truc tiep -->
> **Executor (validation 2026-06-10, user chot): ORCHESTRATOR tu lam tron Phase 3** (docs + memory note + dogfood E2E) — KHONG giao worker wave. Ly do: dogfood can spawn/watch/close tuong tac song; docs/memory la markdown. Phase 1+2 cook qua wave codex.

## Overview

Dam bao `-HarvestKill` KHONG nam trong **luong mac dinh** (grep da chung minh code default da OFF — xem Key Insights), giu lai nhu opt-in flag (KHONG xoa code), de pane song den khi user tu dong. Cong viec thuc te = **DOCS** (`docs/orchestration-system.md` phan anh dung hanh vi + 2 cong cu watch/close-with-log) + **dogfood E2E**: spawn 1 worker codex -> watch no -> de xong -> dong tay bang skill Phase 2 -> verify 0 orphan + snapshot `.md` dung.

**Boi canh (self-contained):** user chot dong tay HOAN TOAN (handoff §8, decision #2). `-HarvestKill` (khi opt-in) lam `harvest-results.js` close-pane + `agent kill` (de lai orphan shell). Mac dinh khong truyen -> pane song; Phase 2 skill la cong cu thu hoi. Tham so `[switch]$HarvestKill` VAN giu de opt-in `orchestrate-start.ps1 -HarvestKill`.

## Context Links

- Handoff §8 quyet dinh "dong tay hoan toan": `plans/reports/handoff-260610-2050-pane-ux-3wi-implemented-pushed.md:93-105`
- Research wiring 2 dong can comment: `research/researcher-02-harvestkill-wiring-forensics-mapping-report.md` §1
- Docs hien tai: `docs/orchestration-system.md` (§ "orchestrator-pass.ps1" `:204-206`, § "Lifecycle worker headless Codex" `:387-399`)
- Phase 1 (`watch-agent.js`) + Phase 2 (`close-pane-with-log.js`) phai DONE truoc dogfood.

## Key Insights (evidence file:line) — KET LUAN DA CHOT bang grep

**Grep toan repo (`-HarvestKill`, da loai `plans/`) — verified:**

| File:line | Noi dung | Loai |
|-----------|----------|------|
| `scripts/orchestrate-start.ps1:7` | `[switch]$HarvestKill,` | khai bao param |
| `scripts/orchestrate-start.ps1:101` | `if ($HarvestKill) { $args += "-HarvestKill" }` | opt-in gate (default $false) |
| `scripts/orchestrator-pass.ps1:42` | `[switch]$HarvestKill,` | khai bao param |
| `scripts/orchestrator-pass.ps1:75` | `if ($HarvestKill) { $hv += "--kill" }` | opt-in gate (default $false) |
| `docs/orchestration-system.md:205` | `-HarvestKill` trong vi du orchestrator-pass | DOCS — vi du mac dinh |
| `docs/orchestration-system.md:212` | "-HarvestKill reap pane da co result" | DOCS — mo ta |
| `docs/orchestration-system.md:397` | "orchestrator-pass.ps1 -HarvestKill goi harvest va reap" | DOCS — Lifecycle |

**KET LUAN (confidence cao, verified):** KHONG co script/wrapper/alias nao truyen `-HarvestKill` mac dinh. Hai dong `:101`/`:75` da la `if ($HarvestKill)` voi `[switch]` default `$false` -> **hanh vi mac dinh HIEN TAI da la "khong kill pane"**. Pane chi bi reap khi user CHU DONG truyen `-HarvestKill`.

**=> Phase 3 KHONG sua code 2 dong `:101`/`:75`** (decision #2: giu flag wired; comment chung se giet opt-in). Viec thuc su can lam:
1. **Docs only**: bo `-HarvestKill` khoi VI DU mac dinh (`orchestration-system.md:205`); chuyen 3 tham chieu (`:205`, `:212`, `:397`) sang muc "opt-in legacy".
2. **Dogfood** chung minh default = pane song.

Khi default (khong co flag): `orchestrator-pass.ps1` khong nhan flag -> `harvest-results.js` `doKill=false` (`:81`) -> block kill SKIP (`:114`) -> pane SONG; agent VAN mark completed tu result (`:95-99`), wave VAN dong (`:104-109`). Verified research §1.

**Luu y cho worker**: research §1 de xuat "comment 2 dong" — de xuat do MAU THUAN voi decision #2 (giu opt-in). Grep da chung minh khong can sua code. Neu worker thay mot caller mac dinh truyen `-HarvestKill` (khong tim thay luc plan) -> go o CALLER, KHONG comment gate. Re-grep truoc khi sua.

## Requirements

### Functional
- F1: Luong mac dinh (chay `orchestrate-start.ps1` khong co `-HarvestKill`) -> pane worker SONG sau khi agent completed.
- F2: Opt-in van hoat dong: `orchestrate-start.ps1 ... -HarvestKill` -> van close-pane nhu cu (KHONG xoa duong nay).
- F3: `docs/orchestration-system.md` cap nhat: (a) hanh vi mac dinh moi (pane song, dong tay), (b) muc 2 cong cu `watch-agent.js` + `close-pane-with-log.js`, (c) `-HarvestKill` chuyen sang muc opt-in/legacy.
- F4: Dogfood E2E that (PowerShell, wmux live) — xem Dogfood Steps.

### Non-functional
- NF1: Khong xoa tham so `$HarvestKill` o 2 file (decision #2).
- **NF2 (F15 — BAT BUOC, khong "neu can"):** cap nhat auto-memory `dogfood-worker-lifecycle-result-based` luc ship — memory hien day "dong bang `-HarvestKill`" se lam hanh vi cu quay lai neu khong sua. Phan vai 3 cong cu (xem docs Step 3).
- NF3: Khong sua app.asar.
- NF4: Single-window assumption + constraint chay-trong-pane-wmux/PS-64-bit (F4) ghi ro trong docs cho ca 2 cong cu.

## Architecture (data flow — thay doi)

```text
HIEN TAI (code default da OFF; chi DOCS goi y -HarvestKill):
  orchestrate-start.ps1            (khong ai truyen -HarvestKill mac dinh)
    -> orchestrator-pass.ps1       (khong flag, default $false)
    -> harvest-results.js          (khong --kill, doKill=false)
    -> agent mark completed tu result; pane SONG
  => chi can SUA DOCS de phan anh dung + bo sung quy trinh dong tay.

SAU (lam ro hanh vi + cong cu):
  orchestrate-start.ps1  -> pane SONG sau completed
    -> user CHU DONG (dong LE, co log):
       close-pane-with-log.js --confirm
         -> render+sanitize+redact+luu -> agent-kill -> close-pane -> reap+verify (F8/F9)
    -> don KHAN (state hong, hang loat, KHONG log): cleanup-panes.ps1
    -> KHONG co reaper sweep TU DONG (F8); user chay reap-orphan-shells.ps1 TAY khi can

OPT-IN (giu nguyen, KHONG xoa):
  orchestrate-start.ps1 -HarvestKill
    -> orchestrator-pass.ps1 -HarvestKill -> harvest-results.js --kill
    -> reapPane(): agent kill + close-pane (pane DONG, shell thanh orphan, KHONG kill OS shell)
```

## Related Code Files

**Modify (DOCS ONLY — grep da chung minh khong can sua code):**
- `docs/orchestration-system.md` — cap nhat:
  - § orchestrator-pass example: bo dong `-HarvestKill` (`:205`) khoi vi du mac dinh.
  - § ghi chu duoi vi du (`:212`): doi "-HarvestKill reap pane da co result" -> them "(opt-in legacy; mac dinh pane song, dong tay)".
  - § Lifecycle worker headless Codex (`:397`): doi "orchestrator-pass.ps1 -HarvestKill goi harvest va reap pane idle" -> "mac dinh pane SONG sau completed; dong tay qua close-pane-with-log.js; -HarvestKill la opt-in legacy".
  - Them § "Theo doi va dong pane thu cong": mo ta `watch-agent.js` + `close-pane-with-log.js` + **bang phan vai 3 cong cu** (F15) + **ghi ro default KHONG co reaper sweep tu dong** (F8) + constraint chay-trong-pane-wmux/PS-64-bit (F4).

**KHONG sua (giu nguyen — decision #2):**
- `scripts/orchestrate-start.ps1` `:101`, `scripts/orchestrator-pass.ps1` `:75` — opt-in gate da dung; KHONG comment.

**Create:**
- (khong file code moi o Phase 3 — chi docs + dogfood)

**Memory (ngoai repo code, trong `.claude` — F15 BAT BUOC):**
- Cap nhat `dogfood-worker-lifecycle-result-based`: "default = pane song; dong LE qua close-pane-with-log.js (co log); cleanup-panes.ps1 don khan khong log; -HarvestKill legacy opt-in". (Orchestrator sua file memory that luc ship.)

**Delete:** none.

## Implementation Steps

1. **Re-grep verify** (TRUOC sua): chay lai `-HarvestKill` toan repo (loai `plans/`) xac nhan bang Key Insights van dung (khong caller nao truyen mac dinh). Neu khop -> docs-only. Neu xuat hien caller moi truyen mac dinh -> go o CALLER (KHONG comment gate).
2. **Verify default da OFF (F5b — sua "dry, khong wmux"):** KHONG co che do "dry, khong wmux" — `orchestrate-start.ps1:3` default CLI thuc + `orchestrator-pass.ps1:32` fallback env, deu cham wmux that. Cach verify dung = **doc code-path**: xac nhan `orchestrate-start.ps1:101` + `orchestrator-pass.ps1:75` la `if ($HarvestKill)` voi `[switch]` default `$false` (grep da chung minh), va `harvest-results.js:81` `doKill=false` khi thieu `--kill` -> block kill SKIP `:114`. Khong can chay process that cho buoc nay; viec chay that nam o Dogfood E2E (buoc 2). KHONG sua code.
3. **Docs**: cap nhat `docs/orchestration-system.md`:
   - § "orchestrator-pass.ps1": bo `-HarvestKill` khoi vi du mac dinh (`:204-206`), them dong "opt-in: them `-HarvestKill` neu muon reap pane tu dong (legacy)".
   - § "Lifecycle worker headless Codex" (`:387-399`): doi "`-HarvestKill` goi harvest va reap pane idle" -> "mac dinh pane SONG sau completed; dong tay qua `close-pane-with-log.js`; `-HarvestKill` la opt-in legacy".
   - Them § "Theo doi va dong pane thu cong": mo ta `watch-agent.js` + `close-pane-with-log.js` (cu phap, single-window assumption, dry-run mac dinh, constraint chay-trong-pane-wmux + PS 64-bit F4).
   - **(F8) ghi ro: default mode KHONG co reaper sweep tu dong** — khong co caller nao tu dong chay reaper (verified 0 caller; decision user cam auto-reap). `close-pane-with-log.js` tu reap pid no vua dong; con lai user chay `reap-orphan-shells.ps1` TAY khi can.
   - **(F15) bang phan vai 3 cong cu dong pane:**
     | Cong cu | Vai tro | Log forensics? |
     |---------|---------|----------------|
     | `close-pane-with-log.js` | dong LE co log (MAC DINH) | Co (snapshot `.md`) |
     | `cleanup-panes.ps1` | don KHAN khi state hong (dong hang loat) | **KHONG** — canh bao MAT forensics |
     | `-HarvestKill` (orchestrate-start/orchestrator-pass) | legacy opt-in | Khong |
4. **Memory note (F15 — BAT BUOC, khong "neu can"):** orchestrator (luc ship) PHAI cap nhat auto-memory `dogfood-worker-lifecycle-result-based` — memory hien day "MOI session dong bang `orchestrator-pass -HarvestKill`"; ship xong ma memory khong doi -> hanh vi cu quay lai. Sua thanh: "default = pane song; dong LE qua `close-pane-with-log.js` (co log); `cleanup-panes.ps1` chi don khan khong log; `-HarvestKill` legacy opt-in". (Plan chi NHAC; orchestrator sua file memory that luc ship.)
5. **Dogfood E2E** (xem Dogfood Steps).
6. `node --check` cac script da cham (neu cham), chay suite `scripts/spike/test-*.js` xac nhan 214+ PASS.

## Dogfood Steps (E2E that — chay duoc)

> Tien dieu kien: hash app.asar = `CED7F271E601015CEAF42FFE2EE005D698991B7A32EB31C73D1DE674BBD828B6`; `wmux tree` lay paneId orchestrator hien tai (DOI moi resume); chay TRONG pane wmux, PowerShell 64-bit (constraint Phase 2 F4).

1. **Chuan bi state + nested-request (F5a — KHONG "dang ky tay"):** spawn driven boi `nested-request-*.json` (`process-nested-requests.js:266`, `:106`) HOAC `spawn-by-split.js` cho agent pending. Tao `.orch-run/duxadv/` + `agent-<id>-prompt.md` (viec ngan: tao `.orch-run/duxadv/ok.txt` noi dung `WATCH_OK` roi exit) + **`nested-request-orch-root.json`** theo mau `.orch-run/dsplit/nested-request-orch-root.json` / `.orch-run/agfix/nested-request-orch-root.json` (engine=codex). (Chi "dang ky agent vao state" KHONG spawn duoc — spawn la driven boi nested-request hoac spawn-by-split.)
2. **Spawn** worker codex that (khong `-HarvestKill`):
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/orchestrate-start.ps1 `
     -State .orch-run/duxadv/state.json -RootPane <currentPane> -MaxPasses 3 -IntervalSec 15
   ```
   (KHONG truyen `-HarvestKill` -> verify default OFF. orchestrate-start cham wmux that — khong co che do "dry, khong wmux".)
   - **(F5 timeout/abort — codex capacity-stall):** pattern treo ~9 phut da ghi nhan (handoff §4). Neu `out.jsonl` khong tang byte trong ~10 phut -> nghi capacity-stall: mark agent state thu cong (`crash-recovery.js detect --state ... --wmux-cli ... --mark`) + `cleanup-panes.ps1` neu can, KHONG cho vo han.
3. **Watch** trong console khac / pane phu:
   ```powershell
   node scripts/watch-agent.js <agentId>
   ```
   Xac nhan render real-time khop `out.jsonl` (thay `$ `, `▣ result`); leader (neu co) -> transcript `.jsonl` ton tai (F1).
4. **De xong**: cho worker ghi result; harvest mark completed; **xac nhan pane VAN SONG** (`wmux tree` con pane do).
5. **Dong tay** bang Phase 2:
   ```powershell
   node scripts/close-pane-with-log.js <agentId>            # dry-run: xem ke hoach + snapshot
   node scripts/close-pane-with-log.js <agentId> --confirm  # agent-kill + close + kill + luu log
   ```
6. **Verify (F5c — reaper DA VA, KHONG chay tran):**
   - Snapshot `.orch-run/duxadv/closed-pane-<agentId>-<ts>.md` ton tai + chua forensics render (da sanitize/redact).
   - `wmux tree` KHONG con pane do.
   - **(F5c) reaper verify dung cach:** `powershell -File scripts/reap-orphan-shells.ps1 -OrchestratorPane <pane-live>` (DA VA gate F4 + JSON shells F3) -> **assert exit code 0 VA `orphanCount==0` doc tu JSON**. PHAN BIET RO: exit 3 = fail-safe gate vo hieu (KHONG phai pass, KHONG ket luan "0 orphan"); chay reaper TRAN (khong `-OrchestratorPane`) se exit 3 + khong in section orphan -> ket luan "0 orphan" GIA (verification mu). Phai dung pane-live va doc orphanCount.
   - `git status` sach ngoai `.orch-run/` (kiem `.orch-run` co trong `.gitignore`).

## Todo List

- [ ] Re-grep `-HarvestKill` xac nhan khong caller mac dinh (docs-only)
- [ ] Verify default OFF qua doc code-path (F5b — KHONG "dry, khong wmux") + opt-in van wired
- [ ] Docs: 3 muc sua (`:205`/`:212`/`:397`) + § cong cu moi + bang phan vai 3 cong cu (F15) + no-auto-sweep (F8) + constraint pane/PS64 (F4)
- [ ] **(F15 BAT BUOC) Memory note lifecycle**: ghi nhac orchestrator sua `dogfood-worker-lifecycle-result-based` luc ship
- [ ] Dogfood E2E (F5a): nested-request spawn -> watch -> de xong -> close tay -> verify
- [ ] (F5c) Verify reaper DA VA + `-OrchestratorPane <pane-live>` -> exit 0 VA orphanCount==0 (phan biet exit 3 vo hieu)
- [ ] (F5 timeout) abort path cho codex capacity-stall (~10 phut khong tang byte)
- [ ] Suite 214+ PASS

## Success Criteria

- [ ] Chay `orchestrate-start.ps1` (khong `-HarvestKill`) -> pane worker SONG sau completed (verified `wmux tree` o dogfood buoc 4).
- [ ] `orchestrate-start.ps1 -HarvestKill` van close-pane nhu cu (opt-in con song, decision #2).
- [ ] Sau `close-pane-with-log.js --confirm`: snapshot `.md` dung + `wmux tree` mat pane.
- [ ] **(F5c)** reaper DA VA + `-OrchestratorPane <pane-live>` -> exit 0 VA `orphanCount==0` doc tu JSON (KHONG ket luan tu reaper tran exit 3).
- [ ] `docs/orchestration-system.md` phan anh hanh vi moi + 2 cong cu + bang phan vai 3 cong cu (F15) + ghi ro KHONG co auto-sweep (F8) + opt-in legacy.
- [ ] **(F15)** memory `dogfood-worker-lifecycle-result-based` da co note cap nhat (nhac orchestrator sua luc ship).
- [ ] Suite `scripts/spike/test-*.js` 214+ PASS, 0 FAIL.

## Risk Assessment

| Rui ro | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| Worker comment cung 2 dong `:101`/`:75` theo research (giet opt-in, vi pham decision #2) | Med (research goi y sai) | **High** | Grep da chung minh docs-only, KHONG sua code; Key Insights ghi ro; re-grep Step 1 truoc khi dong |
| **(F15)** memory `dogfood-worker-lifecycle-result-based` khong sua -> hanh vi cu (-HarvestKill) quay lai sau ship | Med | **High** | NF2 nang memory-update thanh BAT BUOC; bang phan vai 3 cong cu trong docs + memory |
| Pane tich luy khi user quen dong -> RAM len | Med | Med | Chap nhan theo decision #2; `close-pane-with-log.js` (co log) la cong cu thu hoi LE; user chay reaper sweep TAY khi can (F8 — KHONG auto); ghi vao docs |
| Dogfood: pane orchestrator doi resume -> reaper gate sai (Phase 2 da fix) | Med | Med | `close-pane-with-log.js` resolve pane LIVE (Phase 2 F4); reaper dogfood dung `-OrchestratorPane <pane-live>` |
| **(F5)** Codex capacity stall lam worker treo lau (~9 phut, handoff §4) | **Med** | Med | KHONG cho vo han: out.jsonl khong tang byte ~10 phut -> mark state thu cong (`crash-recovery --mark`) + cleanup-panes neu can |
| Sua docs lan vao noi dung khong lien quan | Low | Low | Chi sua cac muc da chi; diff toi thieu |

## Security Considerations

- Khong them be mat tan cong moi (chi doi default + docs).
- Pane song lau hon = forensics tren dia ton tai lau hon (`.orch-run` ephemeral, khong commit) — chap nhan.
- Opt-in `-HarvestKill` giu hanh vi cu (close-pane qua wmux API, khong kill OS) — khong doi security posture.

## Next Steps

- Cum hoan tat -> co the chuyen sang BASF task (Phase 7 plan nen `260609-1722`).
- Tuy chon ngoai scope: AutoHotkey bind phim cho `watch-agent.js` + `close-pane-with-log.js` (researcher-01 §7).
- Re-validate ca 2 cong cu khi wmux len multi-window (decision #5).
