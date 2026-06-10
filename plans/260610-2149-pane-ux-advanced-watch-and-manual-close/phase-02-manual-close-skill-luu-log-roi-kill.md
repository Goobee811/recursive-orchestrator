---
phase: 2
title: "Manual close skill (luu log roi kill)"
status: pending
priority: P1
effort: 6h
dependencies: [1]
---

# Phase 2: Manual close skill (luu log roi kill)

## Overview

Tao script `scripts/close-pane-with-log.js` (+ reaper mods PowerShell): nhan `<paneId|agentId>`, render forensics compact -> **luu snapshot** `.orch-run/<wave>/closed-pane-<agentId>-<ts>.md` -> `wmux agent kill` -> **close-pane** -> **kill shell nen** thu hoi RAM. Mac dinh **dry-run/confirm**. Thay the hanh vi auto-close `-HarvestKill` (go khoi luong mac dinh o Phase 3) bang dong tay co kiem soat.

**Boi canh (self-contained):** user chot dong tay HOAN TOAN (handoff §8). Pane worker song den khi user tu dong. Thao tac: (a) cho user doc lai forensics, (b) kill shell `-NoExit` (~115MB/shell) de thu hoi RAM. `wmux read-screen` khong chay -> render tu `out.jsonl`/`result.md` tren dia.

**Hardening tu red-team (tom tat, chi tiet o Steps):**
- **F2** moi hanh dong destructive resolve qua `resolveTarget(id, {strict:true})` (Phase 1 module) — agentId trung >=2 run thi ABORT liet ke, bat `--state`.
- **F7** REFUSE close khi agent.status = running|pending (tranh slot leak vinh vien); `--force` override + bat user tu mark state sau kill.
- **F3** resolve pid qua reaper `shells:[{pid,sid,reason}]` (them vao JSON), match dung-1-pid hoac ABORT.
- **F4** OrchestratorPane tu resolve pane LIVE luc chay (qua `WMUX_SURFACE_ID` cua chinh shell), khong resolve duoc -> ABORT TRUOC close-pane.
- **F8** reap verify qua JSON `killed[]`, "exit 0" KHONG du; retry 1; fail -> in lenh khac phuc + exit non-zero.
- **F9** `wmux agent kill <wmuxAgentId>` best-effort TRUOC close-pane (chong zombie record).
- **F6/F11/F12** snapshot: sanitize control-char + whitelist agentId/ts (chong path traversal) + scan-secrets redact.
- **F10** reaper re-check Win32_Process pid (signature+CreationDate) ngay truoc Stop-Process (chong TOCTOU/pid-reuse).

## Context Links

- Handoff §8 (dong pane thu cong): `plans/reports/handoff-260610-2050-pane-ux-3wi-implemented-pushed.md:89-119`
- Handoff §2 (paneId orchestrator DOI moi resume — nguon dung cho F4, KHONG phai docs): `plans/reports/handoff-260610-2050-pane-ux-3wi-implemented-pushed.md` §2
- Research wiring + mapping + kill: `research/researcher-02-harvestkill-wiring-forensics-mapping-report.md` §1, §2, §5
- Reaper guard 4 khoa + JSON summary: `scripts/reap-orphan-shells.ps1` (doc ky `:17-22`, `:63-69`, `:160-162`, `:175-229`, `:271-273`, `:288-314`)
- `createCodexRenderer` reuse: `scripts/launch-agent-ext.js:199`
- scan-secrets reuse (F12): `scripts/scan-secrets.js`; crash-recovery mark (F7): `scripts/crash-recovery.js:176`

## Key Insights (evidence file:line)

- Reaper kill shell theo pid xac dinh qua PEB reader `WmuxProcEnv.GetEnv` (`reap-orphan-shells.ps1:79-114`), doi chieu live tree (`:138-156`). 4 khoa: cmdline signature (`:73`, `:180-181`), parent==electron (`:214`), khong thuoc own ancestry (`:198`), `WMUX_SURFACE_ID` doc duoc + ABSENT khoi tree (`:210`, `:229`).
- **CANH BAO (F4 — citation sua):** reaper hardcode `$OrchestratorPaneId = "pane-fdc4920d-..."` (`:69`) va dung lam fail-safe gate (`:175-177`) — neu pane orchestrator KHONG khop -> reaper **exit 3, khong kill gi**. `$env:WMUX_PANE_ID` **RONG/STALE sau resume** (docs `orchestration-system.md:213`+`:426` ghi env nay rong sau resume; rieng claim "id DOI moi resume" nguon dung la **handoff-260610-2050 §2**, KHONG phai docs). => default `-OrchestratorPane $env:WMUX_PANE_ID` chet sau resume -> MOI close sau resume leak shell im lang. **Fix F4:** close script tu resolve pane LIVE luc chay (xem QUYET DINH TRINH TU + Step). Them constraint: reaper/close chi chay TRONG pane wmux (gate electron-ancestry `:160-162`) + PowerShell 64-bit (`:63-65`).
- **Reaper JSON summary chi co pid PHANG (F3, verified `:300-312`):** `orphanPids/youngSkippedPids/excludedPids/uncertainPids/killed/failed` — **KHONG co cap sid<->pid**. Pre-close target nam trong `excludedPids` (live surface in tree) lan moi shell live khac -> KHONG the doc JSON dry-run de map surfaceId->pid. **Fix F3:** them `shells:[{pid,sid,reason}]` vao JSON summary ($rec da co Sid+Pid luc scan `:196`), close script match dung-1-pid cho surfaceId.
- **Stop-Process fail KHONG doi exit code (F8, verified `:288-297`):** fail -> `$failed += $k` roi tiep tuc, summary `Write-Output JSON`, script exit 0. Phan biet killed/failed CHI trong JSON. => "exit 0 = killed" SAI; phai parse JSON `killed[]`.
- **Reaper validate 4 khoa luc SCAN (`:190-223`), Stop-Process (`:290`) chay sau KHONG re-check (F10, verified):** pid-reuse Windows giua scan va kill -> giet nham process moi. **Fix F10:** re-fetch Win32_Process pid ngay truoc Stop-Process, so CommandLine chua SurfaceSignature + CreationDate khop record luc scan; lech -> skip + bao.
- `-TargetPid` chi kill khi pid la confirmed orphan (`:271-273`, REFUSED exit 2 neu khong); YOUNG-SKIPPED neu < `MinOrphanAgeMin` (mac dinh 2 phut, `:49`, `:217-218`) — ke ca `-TargetPid`.
- Khi pane CON SONG, surface CON trong tree -> reaper xep `EXCLUDE: live surface in tree` (`:210-213`) -> KHONG the kill bang `-TargetPid` truoc khi close-pane.
- `harvest-results.js:71-76 reapPane()` = `agent kill` + `close-pane` (best-effort) nhung KHONG kill OS shell -> de lai orphan. Day chinh la cai ta thay the. **(F9)** Mirror buoc `agent kill <wmuxAgentId>` TRUOC close-pane de chong zombie record 'running' tich trong `wmux agent list` (headless codex report running forever — `harvest-results.js:2-10`).
- State mapping nhu Phase 1: `state.waves[].agents[]` co `paneId/surfaceId/wmuxAgentId/engine/resultFile` (`.orch-run/p7e2e/state.json:38-59`); `wmuxAgentId` san o `:52`.
- `wmux list-surfaces --pane <paneId>` tra `{surfaces:[{id,paneId,isActive}]}` (research §5, verified live).

## QUYET DINH TRINH TU KILL-vs-CLOSE (bat buoc — kem trade-off)

Hai lua chon, phan tich guard giu duoc:

**(a) close-pane TRUOC -> shell thanh orphan -> reap `-TargetPid -MinOrphanAgeMin 0`:**
- Sau `close-pane`, surface bien mat khoi tree -> shell thanh orphan that -> khoa 4 (absent-from-tree) THOA -> reaper kill hop le.
- GIU duoc CA 4 khoa reaper (an toan nhat ve mat nhan dien).
- Trade-off / race: (1) reaper fail-safe doi `OrchestratorPaneId` co trong tree (`:175-177`) — phai resolve pane LIVE (F4, KHONG default env vi env stale sau resume). (2) Sau close-pane, guard "moi live surface phai dinh vi duoc" (`:225-229`) co the fail tam thoi neu tree dang bien dong -> exit 3, khong kill (FAIL-SAFE, khong nguy hiem, chi la khong thu hoi RAM lan do). (3) `MinOrphanAgeMin 0` bo qua guard tuoi -> chap nhan vi day la pane user CHU DONG dong, khong phai sweep mu.

**(b) kill shell TRUOC roi close-pane:**
- Luc kill, pane con song -> surface con trong tree -> reaper xep EXCLUDE (`:210-213`) -> `-TargetPid` REFUSED. => KHONG dung duoc reaper as-is.
- Phai viet logic kill RIENG (tai dung PEB reader) BO check absent-from-tree -> **MAT khoa 4**. Con khoa 1 (signature), 2 (parent==electron), 3 (own ancestry).
- Trade-off: rui ro giet nham cao hon (mat 1 trong 4 khoa); nhung target xac dinh truc tiep tu paneId->surfaceId->pid, khong phu thuoc fail-safe gate hardcode.

**=> CHON (a)**, voi DIEU KIEN: F4 resolve pane gate LIVE (khong hardcode, khong default env stale) + F3 lay pid qua reaper `shells[]` + F10 re-check truoc kill + F8 verify qua JSON. Ly do: giu tron 4 khoa nhan dien la uu tien an toan cao nhat (user chot dong tay = phai chac chan khong giet nham worker khac). Phuong an (b) doi danh mat 1 khoa de tranh hardcode gate la danh doi sai huong (gate sua duoc; mat khoa thi khong).

**Trinh tu cuoi cung (sau guard F2 resolve + F7 status-check):**
1. resolve pid TRUOC khi close (qua reaper `shells[]` F3, match dung-1-pid cho surfaceId, 0/>1 -> ABORT khong kill).
2. resolve pane LIVE (F4): doc `$env:WMUX_SURFACE_ID` cua chinh shell close-script -> `wmux list-surfaces`/`tree` -> paneId hien hanh; khong resolve duoc -> bat user truyen co, default rong -> **ABORT TRUOC close-pane**.
3. render+luu log (sanitize F6 + path-guard F11 + secret-scan F12).
4. `wmux agent kill <wmuxAgentId>` best-effort (F9, catch bo qua).
5. `close-pane <paneId>`.
6. poll `wmux tree` den khi surface bien mat (timeout ~5s) -> reap `-TargetPid <pid> -MinOrphanAgeMin 0 -OrchestratorPane <pane-live>` -> parse JSON, assert `pid in killed[]` (F8). `failed`/`refused` -> retry 1 lan sau 2s -> van fail -> in lenh khac phuc CHINH XAC + exit non-zero.

> **KHONG co "reaper sweep dinh ky" tu dong** (F8, verified 0 caller; va decision user cam auto-reap). Neu reap fail het retry -> in lenh `reap-orphan-shells.ps1 -TargetPid <pid> -OrchestratorPane <pane>` de USER chay TAY. Default mode KHONG sweep — ghi ro o docs Phase 3.

## Requirements

### Functional
- F1: `node scripts/close-pane-with-log.js <paneId|agentId> [--state <path>] [--ts <iso>] [--confirm] [--force] [--no-color]` — resolve qua `resolveTarget(id, {strict:true})` (Phase 1 module, F2). agentId trung >=2 run -> ABORT liet ke run, bat `--state`.
- F2: Render forensics compact (codex: `out.jsonl` qua `createCodexRenderer`; claude: `result.md` raw) -> ghi `.orch-run/<wave>/closed-pane-<agentId>-<ts>.md`. `<ts>` truyen tham so (KHONG `Date.now()` trong workflow); neu khong truyen, lop CLI ngoai tao 1 lan roi truyen vao logic. **(F6/F11/F12):** sanitize control-char (`sanitizeControl` Phase 1) + whitelist `agentId`/`ts` `/^[A-Za-z0-9._-]+$/` + assert resolved path trong `orchDir` + chay `scan-secrets.js` redact dong match TRUOC khi ghi.
- **F3 (viet lai): Resolve `surfaceId -> pid` qua reaper `shells:[{pid,sid,reason}]`** (them vao JSON summary reaper — xem Modify) TRUOC khi close. Match dung-MOT-pid cho surfaceId; 0 hoac >1 match -> **ABORT khong kill** (in ly do).
- **F4 (viet lai): OrchestratorPane resolve LIVE luc chay** (KHONG default `$env:WMUX_PANE_ID` vi stale sau resume): doc `$env:WMUX_SURFACE_ID` cua chinh shell close-script -> `wmux list-surfaces`/`tree` -> paneId hien hanh -> truyen `-OrchestratorPane <pane-live>`. Khong resolve duoc -> bat user truyen co tuong minh; default rong -> **ABORT TRUOC close-pane**.
- **F5: Mac dinh dry-run**; chi close/kill khi `--confirm`. Dry-run VAN ghi snapshot `.md` (read-only forensics, vo hai) nhung KHONG close/kill.
- **F7 (close-when-running guard): doc `agent.status` tu state TRUOC `--confirm`** — running|pending -> **REFUSE** kem huong dan (worker dang chay, dong se mat result + ket agent). `--force` override: in canh bao to "result se KHONG bao gio co; sau khi kill PHAI tu mark state" + lenh mau (`node -e ...` set status / `crash-recovery --mark`). <!-- Updated: Validation Session 1 - CONFIRMED --> **(CONFIRMED validation 2026-06-10: giu "chi in lenh, user tu mark" — skill KHONG tu mutate state.json sau force-kill; worker KHONG tu "cai tien" sang auto-mark.)**
- **F8: close + reap co verify** (xem Step 5): poll tree -> reap -> parse JSON assert `pid in killed[]`; retry 1; fail -> in lenh khac phuc + exit non-zero. "exit 0" KHONG du.
- **F9: `wmux agent kill <wmuxAgentId>` best-effort TRUOC close-pane** (mirror `reapPane`, chong zombie record).
- **F10 (reaper mod): re-check truoc Stop-Process** — re-fetch Win32_Process pid, so signature + CreationDate khop record luc scan; lech -> skip.
- **F-reaper-gate: them param `-OrchestratorPane <id>` (KHONG default env, hoac default `''` -> fail-safe)** thay hardcode `:69`; giu fail-safe behavior khi gate vang.

### Non-functional
- NF1: Moi file < 200 dong. Tach guard PowerShell rieng neu can; tai dung `reap-orphan-shells.ps1` thay vi copy logic kill.
- NF2: Khong sua app.asar / cli/wmux.js.
- NF3: KHONG `Date.now()` trong logic test-able; timestamp truyen vao.
- NF4: Single-window assumption (decision #5) — ghi ro o cho dung tree.
- **NF5 (constraint F4):** close script + reaper chi chay TRONG pane wmux (gate electron-ancestry `:160-162`) + PowerShell 64-bit (`:63-65`). Ghi vao Requirements + docs.

## Architecture (data flow)

```text
user: node scripts/close-pane-with-log.js lead-p7e2e-c1 --confirm [--state <p>] [--force]
        |
        v
[resolve F2] resolveTarget(id, {strict:true}) -> {paneId, surfaceId, wmuxAgentId, engine, orchDir, forensicsPath}
        |   (agentId trung >=2 run -> ABORT liet ke, bat --state)
        v
[guard F7] agent.status running|pending -> REFUSE (tru --force + canh bao mark state)
        |
        v
[resolve pid F3] reaper shells:[{pid,sid}] -> pid cho surfaceId (dung-1 hoac ABORT)
        |
        v
[resolve pane F4] $env:WMUX_SURFACE_ID -> list-surfaces -> paneId LIVE (rong -> ABORT truoc close)
        |
        v
[render+save F6/F11/F12] sanitize + whitelist path + scan-secrets redact
        |   -> .orch-run/<wave>/closed-pane-<id>-<ts>.md
        v   (--confirm moi sang cac buoc duoi; dry-run dung o day)
[agent kill F9] wmux agent kill <wmuxAgentId> (best-effort)
        |
        v
[close] close-pane <paneId>   (surface roi tree -> shell thanh orphan)
        |
        v
[reap+verify F8/F10] poll tree den surface bien mat (~5s)
        -> reap-orphan-shells.ps1 -TargetPid <pid> -MinOrphanAgeMin 0 -OrchestratorPane <pane-live>
        -> parse JSON: pid in killed[]? OK : retry 1 -> fail: in lenh khac phuc + exit != 0
        v
done
```

- **Vao**: paneId|agentId + (optional) `--state`/`--ts`/`--force`/`--confirm`.
- **Bien doi**: resolve(strict) -> status-guard -> resolve pid -> resolve pane live -> render+sanitize+scan -> agent-kill -> close -> reap+verify.
- **Ra**: snapshot `.md` da sanitize/redact + pane dong + shell bi kill (RAM thu hoi) + agent-kill clear zombie.

## Related Code Files

**Create:**
- `scripts/close-pane-with-log.js` — orchestrate luong (resolve, render+save, goi close + reap). ~130-170 dong.
- `scripts/spike/test-close-pane-with-log.js` — test: resolve, render+save tao file dung ten/duong dan, dry-run KHONG goi close/kill (dung fake-wmux + stub reaper). Pattern `test-codex-render.js`.

**Modify:**
- `scripts/reap-orphan-shells.ps1` — 3 sua (cung dot, file nay du nao cung sua):
  1. **F-gate:** them param `[string]$OrchestratorPane = ''`; thay hardcode `:69` `$OrchestratorPaneId = "pane-fdc4920d-..."` bang `$OrchestratorPaneId = $OrchestratorPane`. **KHONG default `$env:WMUX_PANE_ID`** (stale sau resume — F4); param rong -> fail-safe `:175-177` exit 3 nhu cu. Caller (close script) tu resolve pane live va truyen tuong minh.
  2. **F3:** them `shells = @($candidates | ForEach-Object { @{ pid=...; sid=...; reason=... } })` (hoac dung cac `$rec` da phan loai) vao `$summary` `:300-312` (`{pid, sid, reason}`). Backward-compat: chi THEM key, giu nguyen cac mang pid cu.
  3. **F10:** ngay truoc `Stop-Process` (`:290`), re-fetch `Get-CimInstance Win32_Process -Filter "ProcessId=$k"`; neu `CommandLine` khong chua `$SurfaceSignature` HOAC `CreationDate` lech record luc scan -> skip pid do + `Write-Output` canh bao (TOCTOU/pid-reuse guard).

**Reuse (khong sua):**
- `scripts/launch-agent-ext.js` `createCodexRenderer` (`:199`).
- `scripts/orch-forensics-map.js` (**Phase 1 OWN, F14**) — `resolveTarget(id, {strict:true})` + `sanitizeControl()`. Phase 2 cho module nay xong (dependencies: [1]).
- `scripts/scan-secrets.js` (san co) — redact secret trong snapshot (F12).

**Delete:** none.

## Implementation Steps

1. **Resolve (F2 strict)**: `resolveTarget(idOrPane, {strict:true})` (Phase 1 module — **cho Phase 1 xong**, F14). Tra `{agentId, paneId, surfaceId, wmuxAgentId, engine, orchDir, forensicsPath, resultFile, statePath}`. agentId trung >=2 run -> ABORT liet ke run + bat `--state`. Fail -> list known + exit != 0.
2. **Status guard (F7)**: doc `agent.status` tu state da resolve. running|pending -> **REFUSE**: in "agent dang <status>, dong se mat result + ket agent. Cho agent xong, hoac --force." + exit != 0. `--force` -> tiep tuc nhung in canh bao to: "result se KHONG bao gio co; sau khi kill PHAI tu mark state: `node scripts/crash-recovery.js detect --state <statePath> --wmux-cli <wmuxCli> --mark`".
3. **Resolve pid (F3)**: goi reaper che do liet ke (dry-run) parse JSON `shells:[{pid,sid,reason}]` (vua them o Modify) -> loc entry co `sid == surfaceId`. Match dung-1 -> lay pid; 0 hoac >1 -> **ABORT khong kill** (in: "khong xac dinh duoc dung 1 pid cho surface <sid>"). KHONG tu viet PEB logic (DRY — reaper da co).
4. **Resolve pane LIVE (F4)**: doc `$env:WMUX_SURFACE_ID` cua chinh shell -> `node $wmuxCli list-surfaces` / `tree` -> tim paneId chua surface do = pane orchestrator hien hanh. Rong/khong resolve duoc -> bat user truyen `--orchestrator-pane <id>`; van rong -> **ABORT TRUOC moi thao tac destructive** (in huong dan). Day la gia tri truyen `-OrchestratorPane`.
5. **Render + save (F6/F11/F12)**:
   - **F11 whitelist**: `agentId`/`ts` phai khop `/^[A-Za-z0-9._-]+$/` (reject path chars; pattern `pane-spawn.js:36`). `logPath = path.join(orchDir, 'closed-pane-'+agentId+'-'+ts+'.md')`; sau join `assert(path.resolve(logPath).startsWith(path.resolve(orchDir)+path.sep))` truoc khi ghi.
   - Codex: `createCodexRenderer({ noColor:true, write: s => buf += sanitizeControl(s) })` (**F6** sanitize C0/CSI/OSC); feed `out.jsonl` tung dong; header (`# closed pane <agentId> @ <ts>` + paneId/surfaceId/engine).
   - Claude: doc `result.md`, `buf = sanitizeControl(content)` + header. Khong co forensics -> "no forensics found".
   - **F12 secret-scan**: ghi `buf` ra file tam -> `node scripts/scan-secrets.js <tmp>` -> parse JSON `findings[].line`; voi moi line match, thay dong do bang `[REDACTED — scan-secrets: <label>]`; ghi ket qua da redact vao `logPath`; xoa tmp. (scan-secrets bao line+label, khong redact in-place -> close script tu redact theo line.)
6. **Dry-run gate**: KHONG `--confirm` -> in ke hoach (logPath, paneId close, wmuxAgentId kill, pid kill) + "(dry-run, them --confirm)" + VAN ghi snapshot `.md` (read-only forensics, vo hai); DUNG o day. `--confirm` moi sang Step 7.
7. **Execute (`--confirm`)** — trinh tu F9 -> close -> F8 reap-verify:
   - **F9**: `execFileSync('node', [wmuxCli, 'agent', 'kill', wmuxAgentId])` best-effort (try/catch bo qua) TRUOC close.
   - `execFileSync('node', [wmuxCli, 'close-pane', paneId])` (best-effort, catch).
   - **F8 poll**: lap `node $wmuxCli tree` (timeout ~5s, interval ~500ms) den khi surface bien mat khoi tree.
   - `execFileSync('powershell', ['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/reap-orphan-shells.ps1','-TargetPid',pid,'-MinOrphanAgeMin','0','-OrchestratorPane',paneLive])` — capture stdout, parse dong `JSON {...}`.
   - **F8 verify**: `assert pid in summary.killed`. Neu pid in `failed`/`refused`(exit 2)/fail-safe(exit 3) -> sleep 2s -> retry 1 lan. Van fail -> in lenh khac phuc CHINH XAC (`powershell -File scripts/reap-orphan-shells.ps1 -TargetPid <pid> -OrchestratorPane <paneLive>`) + **exit non-zero** (de user biet shell chua thu hoi). "exit code 0" KHONG du de ket luan killed.
8. **Test** `test-close-pane-with-log.js` (dung fixture `scripts/spike/fixtures/` F13, fake-wmux + stub reaper):
   - Resolve tu state mau -> dung paneId/surfaceId/wmuxAgentId; **F2** 2 state cung agentId -> ABORT liet ke.
   - **F7** status=running -> REFUSE; `--force` -> tiep + in canh bao mark.
   - Render+save: file `closed-pane-*.md` ton tai, header + `▣ result`; **F6** input OSC52 -> output strip ESC; **F11** agentId `..\x` -> reject; **F12** input chua `api_key=...` -> dong do `[REDACTED`.
   - Dry-run: KHONG goi fake-wmux `close-pane`/`agent kill` (kiem FAKE_WMUX_LOG).
   - `--confirm`: goi `agent kill` (F9) ROI `close-pane` dung paneId; goi reaper `-TargetPid` + `-MinOrphanAgeMin 0` + `-OrchestratorPane`; **F8** stub reaper tra `killed=[pid]` -> PASS; stub tra `failed=[pid]` -> retry roi exit non-zero.
   - `node --check` script moi.
9. **Reaper mods sanity (F3/F10/F-gate)**: sau sua reaper, chay dry-run voi `-OrchestratorPane <pane-live>` -> xac nhan: JSON co key `shells`; gate dung param (khong hardcode); re-check truoc Stop-Process khong lam dry-run kill nham. (Reaper PS1 mods co the lam SONG SONG voi Phase 1 — F14.)

## Todo List

- [ ] (F2) Resolve target `{strict:true}` -> {paneId, surfaceId, wmuxAgentId, engine, orchDir}; trung run -> ABORT
- [ ] (F7) Status guard running|pending -> REFUSE; `--force` + canh bao mark state
- [ ] (F3) Resolve surfaceId -> pid qua reaper `shells[]` (dung-1 hoac ABORT)
- [ ] (F4) Resolve pane LIVE qua `WMUX_SURFACE_ID`; rong -> ABORT truoc close
- [ ] (F6/F11/F12) Render+save: sanitize + whitelist path + scan-secrets redact
- [ ] (F-gate) reaper `-OrchestratorPane` (KHONG default env) thay hardcode `:69`
- [ ] (F3) reaper JSON them `shells:[{pid,sid,reason}]`
- [ ] (F10) reaper re-check Win32_Process signature+CreationDate truoc Stop-Process
- [ ] Dry-run mac dinh; `--confirm` moi destructive
- [ ] (F9) `agent kill <wmuxAgentId>` TRUOC close-pane
- [ ] (F8) poll tree -> reap -> assert pid in killed[]; retry 1; fail -> lenh khac phuc + exit != 0
- [ ] `test-close-pane-with-log.js` PASS (gom F2/F6/F7/F8/F9/F11/F12 case); suite tong van xanh
- [ ] `node --check` + reaper dry-run sanity (shells key + gate param)

## Success Criteria

- [ ] Dry-run (khong `--confirm`): in ke hoach + ghi snapshot `.md`, KHONG close/kill/agent-kill (kiem FAKE_WMUX_LOG).
- [ ] **(F2)** agentId trung >=2 run -> ABORT liet ke; `--state` resolve dung 1 run.
- [ ] **(F7)** agent running|pending -> REFUSE; `--force` in canh bao mark state.
- [ ] `--confirm`: snapshot `.md` dung ten `closed-pane-<agentId>-<ts>.md` trong `orchDir`, da sanitize (**F6**) + redact secret (**F12**); **(F9)** `agent kill` goi TRUOC `close-pane`; pane dong.
- [ ] **(F8, doi tu "exit khong throw"):** reap verify qua JSON `pid in killed[]` (KHONG dua vao exit 0); fail het retry -> in lenh khac phuc + **exit non-zero**.
- [ ] **(F4)** reaper `-OrchestratorPane <pane-live resolve runtime>` PASS gate; default env rong/stale -> ABORT truoc close (khong leak im lang).
- [ ] **(F11)** agentId chua path char -> reject; resolved path ngoai orchDir -> reject.
- [ ] **(F3/F10)** reaper JSON co `shells[]`; re-check signature+CreationDate truoc Stop-Process.
- [ ] Suite `scripts/spike/test-*.js` 214+ PASS, 0 FAIL.
- [ ] Moi file moi/sua < 200 dong.

## Risk Assessment

| Rui ro | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| **(F4)** OrchestratorPane default env stale sau resume -> gate sai -> MOI close leak shell im lang | **High** | **High** | Resolve pane LIVE qua `WMUX_SURFACE_ID` luc chay (KHONG default env); rong -> ABORT TRUOC close. Note: gate "pane toi dang o" yeu hon neo co dinh -> bu bang F10 re-check truoc kill |
| **(F2)** agentId trung run -> resolve nham run stale -> kill nham theo mapping cu | **High** | **High** | `resolveTarget {strict:true}` ABORT liet ke khi trung; bat `--state` |
| **(F8)** reap fail im lang ("exit 0 = killed" sai) -> bao thanh cong nhung shell van song | Med | High | Parse JSON `killed[]` (KHONG exit code); retry 1; fail -> exit non-zero + lenh khac phuc |
| **(F10)** pid-reuse Windows giua scan va Stop-Process -> giet nham process moi | Low | High | Re-fetch Win32_Process pid, so signature + CreationDate ngay truoc kill (sua mitigation cu sai: re-check truoc DAY o scan, gio them o kill) |
| Race close-pane <-> reap: "live surface not located" guard fail tam thoi (`:225-229`) | Med | Low | FAIL-SAFE exit 3 -> retry 1; van fail -> in lenh USER chay tay (KHONG co sweep tu dong); pane van da dong |
| Giet nham shell khac (mat khoa) | Low (chon (a) giu 4 khoa) | High | Giu tron 4 khoa reaper; `-TargetPid` REFUSED neu khong phai orphan (`:271-273`) |
| `MinOrphanAgeMin 0` bo guard tuoi giet shell vua spawn | Low | Med | Chi ap cho pane user CHU DONG dong (da resolve dung agentId), khong sweep mu; F3 surfaceId match dam bao dung pane |
| **(F7)** dong worker dang running -> codex chet khong ghi result -> slot leak vinh vien | Med | High | Status guard REFUSE; `--force` bat user mark state sau kill |
| forensics khong ton tai (worker chua ghi) | Med | Low | Snapshot ghi chu "no forensics"; van close+kill duoc |

## Security Considerations

- Kill OS process: chi pid qua 4 khoa reaper + F10 re-check (khong sweep mu). `--confirm` bat buoc cho hanh dong pha huy (close + kill + agent-kill).
- **(F6)** snapshot sanitize control-char (OSC 52 ghi clipboard / CSI gia mao) truoc khi ghi `.md` — khong de escape nhiem file vinh vien.
- **(F11)** agentId/ts whitelist + path-prefix assert chong traversal ghi file ngoai `.orch-run` (state.json la untrusted boundary, docs `:428`).
- **(F12)** snapshot chay scan-secrets redact dong match (worker co the in `cat .env`). `.orch-run` gitignored (khong commit) nhung file ton tai tren dia vo thoi han -> redact + docs ghi ro snapshot co the con noi dung nhay cam sot.
- Snapshot `.md` ghi vao `.orch-run/<wave>/` (cung noi forensics goc) — khong ro ri ra ngoai repo.
- Single-window assumption: neu tuong lai multi-window, reap co the dinh sai surface window khac -> re-validate (decision #5).

## Next Steps

- Phase 3 go `-HarvestKill` khoi luong mac dinh (hanh vi auto-close cu) — script nay la cong cu thay the.
- Phase 3 dogfood: spawn codex that -> de xong -> `close-pane-with-log.js --confirm` -> verify 0 orphan (qua reaper DA VA + assert orphanCount==0) + snapshot `.md` dung.
- Tuy chon ngoai scope: AutoHotkey bind phim chay script nay (researcher-01 §7).
