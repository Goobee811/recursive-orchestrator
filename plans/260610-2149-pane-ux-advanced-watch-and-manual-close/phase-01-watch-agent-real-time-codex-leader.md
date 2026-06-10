---
phase: 1
title: "Watch agent real-time (codex + leader)"
status: pending
priority: P1
effort: 5h
dependencies: []
---

# Phase 1: Watch agent real-time (codex + leader)

## Overview

Tao script `scripts/watch-agent.js`: nhan `<agentId|paneId>`, resolve qua scan `.orch-run/*/state.json` **(co disambiguation — xem F2 ben duoi)**, roi **tail forensics dia render real-time**. Codex worker -> tail `agent-<id>-out.jsonl` render compact qua `createCodexRenderer` (replay tu dau + follow). Leader claude -> tail transcript `~/.claude/projects/<slug>/<sessionId>.jsonl` (`sessionId` la UUID sinh tai caller spawn va truyen qua co `claude --session-id <uuid>`, ghi `claudeSessionId` vao state.json luc spawn — xem F1/Step 4). Chay trong console orchestrator hoac pane phu (split) — wmux KHONG tao duoc surface trong pane ton tai.

**Boi canh (self-contained):** `wmux read-screen` tra `{"text":"","note":"..."}` o wmux 0.5.0 -> KHONG doc duoc scrollback bang lenh. Workaround: forensics dia. Codex worker ghi `out.jsonl` lien tuc (`launch-agent-ext.js:188-191` — `out.write(chunk)` moi chunk). Leader claude chay TUI, KHONG ghi out.jsonl, chi co transcript.

**Sanitize (red-team F6):** out.jsonl / transcript la output tu worker codex KHONG dang tin (untrusted). Truoc khi `write` ra stdout, MOI field text untrusted phai qua bo loc control-char (strip moi C0 tru `\n`/`\t`, strip CSI `\x1b[...` + OSC `\x1b]...`). Khong sanitize -> worker in OSC 52 ghi clipboard orchestrator / CSI gia mao dong che lenh pha hoai. Chi ap len watch path moi, KHONG dong vao hanh vi pane echo hien huu (ngoai scope).

## Context Links

- Handoff §9 (theo doi scrollback): `plans/reports/handoff-260610-2050-pane-ux-3wi-implemented-pushed.md:121-140`
- Research mapping + leader watch: `plans/260610-2149-pane-ux-advanced-watch-and-manual-close/research/researcher-02-harvestkill-wiring-forensics-mapping-report.md` §2, §4, §5
- Research keybinding NO-GO: `researcher-01-wmux-keybinding-capability-report.md` §3
- Pattern transcript scan: `scripts/context-meter.js:49-59` (sessionId doc tu env la INPUT cho meter `:36` — bang chung env la OUTPUT cua claude, F1)
- Plumb session-id (F1): `scripts/launch-agent-ext.js:48-54`, `scripts/pane-spawn.js:28-41` + comment `:75-77`, `scripts/safe-launch-wrapper.ps1`, `scripts/spawn-by-split.js:87-96`, `scripts/process-nested-requests.js:150`, `scripts/chain-router.js:287`

## Key Insights (evidence file:line)

- `createCodexRenderer` export tai `launch-agent-ext.js:199`; signature `(options={})` -> `{write(chunk), end()}`; nhan `write` callback (`:58-59`), co `noColor`/`rawEcho` option; stateful buffer chia dong (`:139-141`) — replay file tinh OK. **CHU Y (F6):** renderer KHONG strip ESC — `aggregated_output` in qua `firstLine` (`:106-107`), `agent_message` `.replace(/\s+/g,' ')` (`:118`) khong diet `\x1b`, non-JSON line `write(line+'\n')` raw (`:128`). Sanitize phai lam o lop GOI renderer (truoc `write`), khong sua renderer.
- State schema: `state.waves[].agents[]`, moi agent co `id, paneId, surfaceId, wmuxAgentId, engine, resultFile` (verified `.orch-run/p7e2e/state.json:38-59`). **Agent KHONG co field waveIndex** — phai lay tu vong lap `state.waves`.
- **agentId KHONG unique across runs (F2, verified grep):** `orch-root-c1` ton tai trong 63 file qua nhieu `.orch-run/*` dir; `nested-state.js:128-133` chi dedupe trong 1 state. Flat-map last-write-wins (readdirSync alphabetical) -> resolve nham run stale -> tail file cu. Resolver bat buoc disambiguation (Step 1b).
- **Codex forensics path convention (citation sua):** prompt file `agent-<id>-prompt.md` (`spawn-by-split.js:61`) -> base bo `-prompt`/ext -> `<base>-out.jsonl` (`launch-agent-ext.js:157-162`, ham `runCodex`). => `path.join(orchDir, 'agent-'+id+'-out.jsonl')`. (Citation cu "`harvest-results.js:47`" SAI — `:47` la `result.json`, khong phai out.jsonl.) Resolver nen fallback glob `agent-<id>-*out.jsonl` / `*-out.jsonl` neu convention lech.
- **Leader claude session-id = CO `claude --session-id <uuid>`, KHONG phai env (F1, verified):** `CLAUDE_CODE_SESSION_ID` la bien claude CLI **EXPORT RA** (output — dung lam INPUT cho meter o `context-meter.js:36`), KHONG phai bien truyen vao child; va `wmux agent spawn` **KHONG truyen env** duoc (`pane-spawn.js:75-77` comment ro). Nhanh claude hien tai (`launch-agent-ext.js:48-54`) chay `execFileSync('claude', args)` KHONG co `--session-id`, KHONG set sessionId. Co che dung: caller sinh `crypto.randomUUID()` -> truyen co `claude --session-id <uuid>` qua chuoi `--cmd` -> claude ghi transcript `~/.claude/projects/<*>/<uuid>.jsonl`. state.json luu `claudeSessionId=<uuid>`. Transcript tim qua scan (`context-meter.js:52-58`).
- wmux KHONG co `new-surface --pane <id>` (research §5) -> watch chay console orchestrator (don gian nhat) HOAC pane phu tao bang `wmux split` (upgrade tuy chon).
- Keybinding NO-GO (`researcher-01` §3): kich hoat = user go `node scripts/watch-agent.js <id>`.

## Requirements

### Functional
- F1: `node scripts/watch-agent.js <agentId|paneId> [--state <path>] [--no-color] [--from-start] [--once]` resolve target qua scan `.orch-run/*/state.json`.
- F2: Codex engine -> tail `out.jsonl`, render qua `createCodexRenderer`. Mac dinh replay tu dau roi follow (poll append). `--once` = render het file roi thoat (khong follow).
- F3: Leader claude engine -> doc `claudeSessionId` tu state.json -> tim transcript -> tail render compact (1 event -> 1 dong: `[user]`/`[assistant]`/`[tool]`/`[result]`). Neu thieu `claudeSessionId` -> bao loi ro rang + huong dan (khong doan mtime).
- F4: Resolve fail (id khong thay) -> in danh sach agentId hop le gan nhat + exit code != 0.
- **F5 (viet lai theo red-team F1): plumb co `claude --session-id <uuid>` qua 5 file.** Caller spawn leader/agent claude sinh `crypto.randomUUID()` -> truyen co `--session-id <uuid>` xuyen chuoi `--cmd` -> ghi `agent.claudeSessionId=<uuid>` vao state.json (chi them field). KHONG dung env `CLAUDE_CODE_SESSION_ID` (env la output cua claude, va `wmux agent spawn` khong truyen env duoc). Plumbing day du:
  1. `launch-agent-ext.js` nhanh claude (`:48-54`): them arg `--session-id <uuid>` vao mang `args` (doc tu flag/arg moi).
  2. `pane-spawn.js` `buildLaunchCmd` (`:28-41`): forward `--session-id` vao chuoi `--cmd` (nhanh non-safeWrapper) + duong safeWrapper.
  3. `safe-launch-wrapper.ps1` (duong safeWrapper): forward `-SessionId` xuong launcher.
  4. Ghi state `claudeSessionId` tai cac spawn-site claude (noi goi `spawnIntoPane`): `spawn-by-split.js` (`withState` `:87-96`), `chain-router.js` (`withState` `:293`). `process-nested-requests.js:150` chi tao pending record (fan-out spawn qua spawn-by-split) -> sua NEU re-grep thay goi spawn truc tiep. Re-grep `spawnIntoPane` + nhanh engine=claude xac nhan du spawn-site.
- **F6 (red-team): sanitize control-char** moi field text untrusted (codex `aggregated_output`/`agent_message`/non-JSON line; claude event text) TRUOC `write` stdout: strip C0 tru `\n`/`\t`, strip CSI (`\x1b[...`) + OSC (`\x1b]...`). Helper dung chung Phase 2 snapshot.

### Non-functional
- NF1: File < 200 dong; neu mapping/resolve qua lon -> tach `scripts/orch-forensics-map.js` (module dung chung voi Phase 2 — **Phase 1 OWN module nay**, F14). Voi logic disambiguation F2 + helper sanitize F6, resolve module gan chac > 200 -> **du kien PHAI tach** (khong con chi YAGNI).
- NF2: Khong sua app.asar / cli/wmux.js.
- NF3: Khong `Date.now()` an trong logic test-able; nhan timestamp khi can (Phase 2 dung lai).
- NF4: Poll follow interval mac dinh 500ms (can bang responsiveness vs CPU); cho phep `--interval <ms>`.
- **NF5 (F13): offset follow PHAI theo BYTE** (`Buffer.byteLength(content,'utf8')`, khong `content.length` — file co tieng Viet/multibyte). Doc byte moi qua `createReadStream({start: lastSize})`. KHONG stat-sau-doc (race ghi tiep). Size giam (truncate khi respawn cung id, `createWriteStream` flags `'w'` `:178`) -> reset `lastSize=0` + in `--- file truncated, replaying ---`.

## Architecture (data flow)

```text
user: node scripts/watch-agent.js lead-p7e2e-c1 [--state <path>]
        |
        v
[resolve] scan glob(.orch-run/*/state.json) (+ .orch-run/state.json goc)
  build map: agentId -> [entries...] (mang, kem statePath/mtime)  // F2
            paneId  -> entry (unique theo live tree)
  resolveTarget: --state > paneId > agentId-1-run
                 > agentId-N-run: watch=mtime moi nhat+canh bao; strict=ERROR liet ke  // F2
        |
        +-- engine=codex --> tail out.jsonl
        |       replay: lastSize=Buffer.byteLength(content)        // F13 byte
        |       follow: size<last -> truncate-reset; size>last -> createReadStream({start})
        |       -> createCodexRenderer.write -> sanitizeControl -> stdout  // F6
        |
        +-- engine=claude(leader) --> claudeSessionId(uuid tu --session-id) -> findTranscript()
                tail <uuid>.jsonl
                replay + follow (byte) -> renderCompactClaude -> sanitizeControl -> stdout  // F6
```

- **Vao**: agentId|paneId (CLI arg).
- **Bien doi**: scan state -> lookup -> chon nguon forensics theo engine -> render compact.
- **Ra**: ANSI compact stream ra stdout (console orchestrator hoac pane phu).

## Related Code Files

**Create:**
- `scripts/watch-agent.js` — CLI watch chinh (~120-160 dong).
- `scripts/orch-forensics-map.js` — **Phase 1 OWN (F14)**. `buildLookup()`, `resolveTarget(idOrPane, {state})` voi disambiguation F2, `forensicsPath(agent, orchDir)`, `sanitizeControl(str)` helper F6 (dung chung Phase 2). Du kien PHAI tach (vuot 200 dong khi gop disambiguation + sanitize).
- `scripts/spike/fixtures/` — **(F13)** commit fixture toi thieu: vai dong JSONL (`watch-sample-out.jsonl`) + `watch-sample-state.json` mau. KHONG dua test moi vao fixture `.orch-run/*` (gitignored, khong reproducible tu clone). Note: `test-codex-render.js` hien cung le thuoc `.orch-run` (no cu — KHONG bat sua trong plan nay, chi KHONG nhan them le thuoc).
- `scripts/spike/test-watch-agent.js` — test dung fixture trong `scripts/spike/fixtures/`: resolve + render replay + disambiguation + sanitize injection.

**Modify (F1 plumbing — 5 file, plus 1 file F13):**
- `scripts/launch-agent-ext.js` — nhanh claude (`:48-54`): them arg `--session-id <uuid>` vao mang `args`. CHU Y file dang 199 dong sat gioi han 200 -> neu them lam vuot, tach helper.
- `scripts/pane-spawn.js` `buildLaunchCmd` (`:28-41`): forward `--session-id <uuid>` vao chuoi `--cmd` (ca nhanh non-safeWrapper `:39-40` lan nhanh safeWrapper `:30-37`).
- `scripts/safe-launch-wrapper.ps1` — duong safeWrapper: nhan `-SessionId` -> forward xuong launcher claude.
- `scripts/spawn-by-split.js` — spawn-site claude (`spawnIntoPane` `:74`): sinh UUID, truyen vao spawn (de vao `--cmd`), ghi `f.agent.claudeSessionId = <uuid>` o `withState` `:87-96`.
- `scripts/chain-router.js` — spawn-site claude (`spawnIntoPane` `:287`): tuong tu, ghi `claudeSessionId` o `withState` `:293`.
- `scripts/process-nested-requests.js` (`:150`) — chi TAO pending record (chua spawn); chi sua NEU re-grep thay no goi `spawnIntoPane` truc tiep (fan-out thuong qua spawn-by-split). Co the KHONG can sua.

> Worker RE-GREP `spawnIntoPane` + nhanh engine=claude de xac nhan day du spawn-site truoc khi sua (du kien 2: spawn-by-split + chain-router). UUID chi sinh cho engine=claude. Lifetime check: state.json la per-run (1 file/`.orch-run` dir), khong shared cross-run; UUID per-agent.

**Delete:** none.

## Implementation Steps

0. **Spike `claude --session-id` (5 phut, BAT BUOC truoc code — F1):** chay `claude --help` xac nhan co `--session-id <uuid>`; chay thu `claude --session-id <uuid> --dangerously-skip-permissions --model <m> -- "say hi"` (prompt positional) -> verify file `~/.claude/projects/*/<uuid>.jsonl` TON TAI sau do; lap lai QUA `safe-launch-wrapper.ps1` (duong safeWrapper) de chac co di xuyen wrapper. <!-- Updated: Validation Session 1 - spike fail => CAT leader-watch --> **Neu co khong ton tai / transcript khong sinh -> BO leader-watch khoi scope (validation 2026-06-10, user chot): CAT F3 + F5 + Step 4 + Step 5, watch chi codex; KHONG fallback mtime-heuristic; ghi ket qua spike vao result + bao orchestrator.** KHONG code F5 truoc khi spike pass.

1. **Resolve module `orch-forensics-map.js` (Phase 1 OWN)**: viet `buildLookup({state})`:
   - `glob('.orch-run/*/state.json')` (dung `fs.readdirSync('.orch-run')` + filter, KHONG can dep ngoai) — gom them `.orch-run/state.json` cap goc neu ton tai (F13c; hoac note `--state` da cover).
   - Voi moi state: `JSON.parse`, `orchDir = path.dirname(statePath)`, doc `mtime`; lap `state.waves[].agents[]`; tinh `forensicsPath`: codex -> `join(orchDir, 'agent-'+id+'-out.jsonl')` (fallback glob `agent-<id>-*out.jsonl` neu thieu), claude -> `agent.resultFile` + `claudeSessionId` neu co.
   - Build map: `byAgent` (gia tri = MANG cac entry trung id, kem `statePath`/`mtime`), `byPane` (paneId unique theo live tree -> 1 entry). Entry `{agentId, paneId, surfaceId, engine, orchDir, statePath, mtime, forensicsPath, claudeSessionId}`.
1b. **Resolver disambiguation (F2 — BAT BUOC):** `resolveTarget(idOrPane, {state})`:
   - Neu `--state <path>` truyen -> chi resolve trong state do (uu tien tuyet doi).
   - paneId match -> tra entry duy nhat (paneId unique theo live tree).
   - agentId match dung 1 run -> tra entry do.
   - agentId match >=2 run -> mac dinh chon entry co `mtime` MOI NHAT; **NHUNG** neu goi tu duong destructive (Phase 2 truyen `{strict:true}`) -> **ERROR liet ke tat ca run** (`agentId 'X' co trong N run: <statePath list>; chi dinh --state`), exit != 0. Watch (read-only) co the auto-chon mtime moi nhat + in canh bao "da chon run moi nhat: <statePath>".
2. **CLI parse**: arg dau = idOrPane; flags `--state <path>`, `--no-color`, `--from-start` (mac dinh ON cho codex), `--once`, `--interval`. Neu khong resolve duoc -> in `Unknown target. Known agents:` + list `byAgent.keys()`, exit 1.
3. **Codex watch**:
   - `renderer = createCodexRenderer({ noColor, write: s => process.stdout.write(sanitizeControl(s)) })` — **sanitize F6 o lop write** (strip C0 tru `\n`/`\t`, strip CSI/OSC) vi renderer khong strip ESC.
   - Replay: doc file hien co, `lastSize = Buffer.byteLength(content,'utf8')` (F13 — byte, khong `.length`), split `/\r?\n/`, `renderer.write(line + '\n')`.
   - Follow (neu khong `--once`): `setInterval(interval)` -> `fs.statSync`; neu `size < lastSize` -> file truncated (respawn cung id, `createWriteStream 'w'` `:178`) -> in `--- file truncated, replaying ---`, `lastSize=0`; neu `size > lastSize` doc byte moi qua `createReadStream({start: lastSize})` -> `renderer.write(chunk)` -> cap nhat `lastSize=size`. KHONG stat-sau-doc (race). SIGINT -> `renderer.end()` + thoat.
   - File chua ton tai -> cho (poll), in `waiting for out.jsonl...`.
4. **Plumb `claude --session-id` (F1 — luc spawn claude, 5 file):**
   - `launch-agent-ext.js` nhanh claude (`:48-54`): doc UUID tu flag/arg moi -> them `'--session-id', uuid` vao mang `args` truoc `'--', prompt`.
   - `pane-spawn.js` `buildLaunchCmd` (`:28-41`): forward `--session-id <uuid>` vao chuoi `--cmd` (nhanh non-safeWrapper `:39-40`: `node "<launcher>" "<promptFile>" --session-id <uuid>`; nhanh safeWrapper `:30-37`: them `-SessionId <uuid>`). UUID slug-constrained (`/^[0-9a-fA-F-]+$/`) chong inject token.
   - `safe-launch-wrapper.ps1`: nhan param `[string]$SessionId` -> khi engine=claude forward `--session-id $SessionId` xuong launcher.
   - Caller sinh UUID + ghi state — **chinh xac la noi GOI `spawnIntoPane` (nơi `--cmd` duoc rap), KHONG phai noi tao pending record**. Sinh `crypto.randomUUID()` 1 lan/agent claude, truyen vao `spawnIntoPane` (de vao `--cmd`) VA ghi `f.agent.claudeSessionId = uuid` o `withState` ngay sau spawn:
     - `chain-router.js`: `spawnIntoPane` `:287` -> `withState` `:293` (giong mau spawn-by-split). Ghi `claudeSessionId` o `:293`.
     - `spawn-by-split.js`: `spawnIntoPane` `:74` -> `withState` `:87-96`. Ghi `claudeSessionId` o `:87-96`.
     - `process-nested-requests.js`: `:150` chi TAO pending record (`paneId/wmuxAgentId = null`, chua spawn) — fan-out pending agents spawn QUA `spawn-by-split.js` path, nen viec ghi sessionId xay ra o spawn-by-split. NEU process-nested co goi spawn truc tiep (re-grep `spawnIntoPane` trong file) -> ghi tai do; neu khong, chi spawn-by-split + chain-router la 2 spawn-site claude.
   - **Liet ke day du spawn-site claude truoc khi sua** (re-grep `spawnIntoPane` + nhanh engine=claude). UUID chi can cho engine claude (codex khong dung transcript).
   - Fallback (validation 2026-06-10, user chot): spike Step 0 fail -> **CAT toan bo Step 4 + Step 5 (bo leader-watch)**; KHONG lam heuristic; watch-agent.js van bao loi ro rang khi gap agent claude ("leader-watch ngoai scope — xem plan.md Validation Log").
5. **Leader watch (claude)**: tai dung `findTranscript(sessionId)` (copy logic `context-meter.js:49-59`, KHONG import vi context-meter la script chay truc tiep — extract neu can). Render compact: doc tung dong JSON, map `type` -> 1 dong (`[user] N chars` / `[assistant] N tokens` / `[tool] <name> <arg1>` / `[result] ok/err`), **qua `sanitizeControl` truoc write (F6)**. Follow byte giong codex (Step 3).
6. **Pane phu (tuy chon, ghi vao docs khong bat buoc code)**: user co the `node $env:WMUX_CLI split --down` tao pane phu roi chay watch trong do. Ghi vao Next Steps, KHONG implement split tu dong (YAGNI).
7. **Test** `scripts/spike/test-watch-agent.js` — dung fixture trong `scripts/spike/fixtures/` (F13, KHONG `.orch-run`), assert: (a) resolve byAgent/byPane dung tu `watch-sample-state.json`; (b) render `--once` chua `$ ` va `▣ result `; (c) target khong ton tai -> non-zero; (d) **disambiguation F2**: 2 state cung agentId -> watch chon mtime moi nhat + canh bao; strict mode -> ERROR liet ke; (e) **sanitize F6 injection**: feed dong chua `\x1b]52;c;...\x07` (OSC 52) + `\x1b[2A` (cursor-up) -> output KHONG con byte ESC. Dung pattern `check()` cua `test-codex-render.js`.

## Todo List

- [ ] **Step 0 spike**: `claude --session-id` sinh transcript `.jsonl` + qua safe-launch-wrapper (BAT BUOC truoc code F5)
- [ ] `buildLookup({state})` scan `.orch-run/*/state.json` (+ goc) -> byAgent (mang) + byPane
- [ ] `resolveTarget` disambiguation F2 (--state > mtime moi nhat > ERROR strict mode)
- [ ] CLI parse + `--state` flag + resolve fail -> list known agents
- [ ] `sanitizeControl()` helper (strip C0/CSI/OSC) — dung chung Phase 2
- [ ] Codex watch: replay + follow BYTE-offset + truncate-reset (F13) + sanitize (F6)
- [ ] Liet ke moi caller spawn claude (file:line) truoc khi plumb
- [ ] Plumb `--session-id <uuid>` 5 file (launch-agent-ext, pane-spawn buildLaunchCmd, safe-launch-wrapper, + ghi state o spawn-by-split/process-nested-requests/chain-router)
- [ ] Leader watch: findTranscript + render compact + follow + sanitize
- [ ] Commit fixture `scripts/spike/fixtures/` (KHONG dung `.orch-run`)
- [ ] `test-watch-agent.js` PASS (gom disambiguation + injection case), suite tong van xanh
- [ ] `node --check` watch-agent.js + orch-forensics-map.js

## Success Criteria

- [ ] `node scripts/watch-agent.js <codex-agentId> --once` render dung compact ANSI tu fixture (chua `$ ` + `▣ result `), do bang test.
- [ ] `node scripts/watch-agent.js <paneId>` resolve dung sang agentId tuong ung (paneId tu `.orch-run/p7e2e/state.json:50`).
- [ ] Target sai -> in danh sach agentId hop le + exit code != 0.
- [ ] **(F2)** agentId trung >=2 run: watch chon mtime moi nhat + canh bao; strict mode (Phase 2) ERROR liet ke run. Do bang test.
- [ ] **(F1, doi tu "state co field"):** sau spawn leader claude, file `~/.claude/projects/*/<uuid>.jsonl` TON TAI (transcript thuc su sinh ra), `<uuid>` == `state.json.claudeSessionId`. Kiem bang dogfood Phase 3.
- [ ] **(F6)** input chua OSC 52 / cursor-up -> output da strip ESC (test injection PASS).
- [ ] **(F13)** out.jsonl bi truncate (size giam) -> watch reset + replay, khong dong bang. Test bang fixture cat ngan.
- [ ] Suite `scripts/spike/test-*.js` van 214 PASS hoac hon (+ test moi), 0 FAIL.
- [ ] `watch-agent.js` < 200 dong; `orch-forensics-map.js` < 200 dong (du kien PHAI tach).

## Risk Assessment

| Rui ro | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| **(F1)** `claude --session-id` khong hoat dong nhu ky vong / khong sinh transcript qua safe-launch-wrapper | Med | Med (giam tu High — validation: fail chi cat scope leader, codex-watch khong anh huong) | **Step 0 spike BAT BUOC** truoc code: verify co + transcript file ton tai + qua wrapper; **fail -> CAT leader-watch (F3/F5/Step4/Step5), KHONG heuristic** (validation 2026-06-10) |
| `launch-agent-ext.js` vuot 200 dong khi them `--session-id` | Med | Med | Chi them ~2 token vao mang `args` (`:51`); ghi state o caller; tach helper neu can |
| Plumb `--session-id` xuyen 5 file bo sot 1 caller | Med | Med | Re-grep liet ke moi caller spawn claude truoc khi sua; lifetime check state.json per-run |
| **(F13)** follow theo `content.length` thay vi byte -> lech offset voi file multibyte (tieng Viet) | Med | Med | `Buffer.byteLength(content,'utf8')` + `createReadStream({start})`; truncate-reset; test fixture |
| multi-window: scan state.json tra agent window khac | Low | Med | Single-window wmux 0.5.0 (decision #5); watch chi doc dia, khong dung tree -> it rui ro hon Phase 2 |
| out.jsonl chua ton tai luc watch (worker chua ghi) | Med | Low | Poll cho file, in `waiting...`; khong crash |

## Security Considerations

- Chi DOC forensics + transcript (read-only); khong ghi/kill gi -> rui ro thap.
- **(F6)** out.jsonl/transcript la output worker untrusted -> sanitize control-char (C0/CSI/OSC) truoc moi `write` stdout, chong OSC 52 ghi clipboard / CSI gia mao dong. Ap len watch path moi, KHONG dong vao pane echo hien huu.
- Transcript leader co the chua noi dung nhay cam (token usage, prompt) — chi in ra console local, khong ghi ra ngoai `.orch-run`. Khong log token cu the ra file.
- `claudeSessionId` la UUID, khong phai secret; ghi vao state.json (da chua paneId/agentId) chap nhan duoc.

## Next Steps

- Phase 2 tai dung `orch-forensics-map.js`: `resolveTarget(id, {strict:true})` (disambiguation F2 — moi destructive op phai qua) + `sanitizeControl()` (F6 snapshot). Phase 1 OWN module nay (F14).
- Phase 3 dogfood: spawn 1 worker codex that -> `watch-agent.js` theo doi real-time -> verify render khop out.jsonl; verify transcript `.jsonl` leader ton tai (F1).
- Tuy chon ngoai scope: AutoHotkey bind phim `node scripts/watch-agent.js` (researcher-01 §7); pane phu split tu dong cho watch.
