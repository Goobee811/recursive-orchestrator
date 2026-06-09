---
title: "Phase 6 Safety Layers Review — data-fence + scan-secrets + crash-recovery + safe-launch-wrapper"
date: 2026-06-09
type: report
tags: [code-review, phase-6, safety, data-fence, scan-secrets, crash-recovery, safe-launch-wrapper, recursive-orchestrator]
status: active
---

# Phase 6 Safety Layers Review

Scope: 5 new files (data-fence.js, scan-secrets.js, crash-recovery.js, safe-launch-wrapper.ps1, test-safety-phase6.js) + opt-in integration diff in pane-spawn.js / process-nested-requests.js / chain-router.js. Shared context read: nested-state.js, reconcile-agents.js, context-handoff/scripts/utils.js.

Suite: **51/51 green** (`node scripts/spike/test-safety-phase6.js`). Verification = empirical: ran data-fence/scan-secrets/crash-recovery/buildLaunchCmd directly with crafted inputs, AST-parsed the wrapper, and used PowerShell ground-truth probes (`[Parser]::ParseFile`, real here-string close, real `Resolve-Path -Relative`, real porcelain parse). Each finding cites the probe outcome. All probe artifacts removed after the run; suite re-confirmed green.

Context: Phase 5 report's H-1 (allocateGrid leak) and M-1 (error bucketing) are **now fixed** in the integration files (proc `:165-167,253`; router `:237-238,320` both wrap the grid call + add an `errored` bucket) — not re-raised here.

Threat model: workers run FULL BYPASS, so nothing inside a running agent is policeable. These layers sit on the launch path. The plan explicitly accepts "giảm thiểu, không tuyệt đối" for denylist/write-fence and names **backup + git** the real net. Findings are graded against that stated model.

---

## Critical
None. No backup-dir escape (traversal `..` residue is trimmed before `Join-Path` — verified), no `--cmd` injection from any untrusted value (engine/agentId slug-constrained; launcher/promptFile/stateFile orchestrator-set — verified), no fail-open in the secret gate (exit 1 AND 2 both abort — verified), no broken wave-close invariant from crash-marking (`failed` is terminal in reconcile — verified).

---

## High

### H-1 — `data-fence.js` is built + tested but NOT wired into any prompt-building path (the layer is dormant)
`data-fence.js` is only reachable via its own CLI (`check`/`fence`) and the test suite. Grep for live callers returns **zero** outside the file itself and a stale comment (`nested-request.js:35` is a comment, not a call). Meanwhile both prompt builders interpolate untrusted content **raw**:
- `process-nested-requests.js:60-93` `childPromptText` injects `child.subtask`, `child.label`, `child.files` directly.
- `chain-router.js:121-153` `continuationPromptText` injects `link.remaining`, `link.label`, `link.prevResultFile` directly.

Neither calls `fence()` or `assertSafeForHereString()`. So a prior worker's result text (or a hand-edited request spec) flows into a downstream worker's prompt **un-fenced** — exactly the prompt-injection surface data-fence exists to neutralize. The primitive itself is sound (see Verified-safe), but unwired it provides no protection.

The wrapper's secret pre-flight DOES scan `$PromptFile` (which embeds the subtask), so a *credential* in the subtask is caught — but injection text ("ignore your instructions…") is not a credential and passes the secret scan untouched.

Impact: Phase 6's stated layer-2 ("bọc nội dung spec/handoff/output trong DATA block") is not in force on the real path. Success-criterion "Nội dung chứa injection không thực thi (data-fence)" is met only by the unit tests, not by the running system.

Fix direction (you apply): in both prompt builders, wrap the untrusted fields through `fence(content, label)` before interpolation, and/or call `assertSafeForHereString` on any field that will later ride the PowerShell wrapper. This is the wiring step; no change to data-fence.js itself.

### H-2 — heartbeat can FALSE-CRASH a live worker on a single long unit (with `--mark`)
`crash-recovery.js:65-86` `findStaleRunning` uses `marker.updatedAt || agent.startedAt` as the heartbeat. Markers are written only **after** each completed unit (per the header + `runMark`), so before unit 1 finishes the only timestamp is `startedAt`. Probe (`now=12:00`, `startedAt=11:45`, no marker, window 10m): the agent is flagged stale though it is alive and busy.

If the monitor passes `--mark`, `markCrashed` (`:91-106`) sets a **still-running** pane's status to `failed`, frees its slot, and records the last marker as the resume point. Under full bypass the pane keeps running (uncloseable from here), so a successor spawned from that marker means **two workers on the same unit → duplicate writes / corrupted result**.

Mitigations already present: (a) `--mark` is opt-in — plain `detect` only reports (non-destructive); (b) `--heartbeat-ms` overridable; (c) reconcile (reading real `wmux agent list`) is the *primary* slot-freeing path, so heartbeat only matters for a pane that died but still shows alive — and a busy-but-slow worker is precisely the false-positive population. Currently **not wired into any loop** (CLI-only), so latent until Phase 7.

Impact: data-correctness under a realistic workload (any unit > window with no interim marker). High because the failure mode is silent duplicate work, but gated behind the opt-in `--mark` and not yet loop-wired.

Fix direction: before `--mark`-ing, require the agent be stale across **N consecutive** detect passes (consecutive-miss counter), or cross-check `wmux agent list` shows it actually gone/exited (not merely silent), or raise the default window well above the largest expected single unit. Document that `detect --mark` must run *after* reconcile in the same pass.

---

## Medium

### M-1 — write-fence misparses renames and quoted paths → wrong out-of-zone list + `-RestoreOutOfZone` silently no-ops
`safe-launch-wrapper.ps1:152` parses `git status --porcelain` with `($_ -replace '^...', '').Trim()` and then `-like`-matches each result against the allowed globs (`:157`). PowerShell ground-truth probe on synthetic porcelain:
- **Rename** `R  old.js -> new.js` → after `-replace '^...'` the whole string `old.js -> new.js` is treated as ONE path. The `-like '*.js'` check then runs against the arrow blob (here matched `*.js` by luck of the trailing suffix; a rename `src/x.js -> evil/y.bin` would be classified on the wrong segment). And `-RestoreOutOfZone` runs `git checkout -- 'old.js -> new.js'` — a bogus single pathspec that **fails silently** (`2>$null`), so renamed out-of-zone files are never reverted.
- **Quoted path** (git quotes paths with special chars when `core.quotepath=true`, the default): `"file with spaces.txt"` keeps its surrounding quotes → `-like '*.txt'` is **False** (string ends in `"`). An out-of-zone special-char file is still flagged out-of-zone (it won't match any in-zone glob), but an *in-zone* special-char file is mis-flagged out-of-zone (false positive), and `git checkout -- '"file…"'` with literal quotes fails to revert.

Impact: the surfaced out-of-zone list can be wrong for renames/special-char paths, and the `-RestoreOutOfZone` guarantee does not hold for them. Per the plan, write-fence is "detect, cannot prevent — only surface + optionally undo," and **backup is the real net**, so this degrades a secondary advisory layer rather than the primary recovery layer → Medium, not Critical.

Fix direction: use `git status --porcelain -z` (NUL-separated, no arrow ambiguity) or `git diff --name-only --no-renames` + `git ls-files --others --exclude-standard`; for renames take the destination path; set `-c core.quotepath=false` so paths come through unquoted; pass the parsed path to `git checkout -- <path>` as a single literal arg (not the blob).

### M-2 — denylist `Format-(Volume|Table\s+/|)\b` has an empty alternation → blocks ALL `Format-*` cmdlets (false positive)
`safe-launch-wrapper.ps1:84`. The trailing `|)` makes the group able to match the empty string, so `Format-\b` matches any `Format-*`. Probe: `Format-Table`, `Format-List`, `Format-Hex`, `Format-Custom` all → **true** (blocked). These are harmless display cmdlets a legit spec routinely mentions (`Get-Process | Format-Table`). The plan explicitly wants to avoid false-positives blocking legit work.

Impact: any spec mentioning a `Format-*` display cmdlet is aborted (exit 4) unless `-AllowDestructive` is passed (which over-permits everything). Annoyance + pushes operators toward the blanket override.

Fix direction: target only the destructive verb — `Format-Volume\b` (and `Format-Disk\b` if desired); drop the empty alternation and the redundant `|Format-Volume` tail.

### M-3 — scan-secrets / safe-wrapper scan only the PROMPT, never the RESULT files before the Leader reads them
Plan step 3 ("Secret-scan chạy trên mọi spec/result/-o/JSONL TRƯỚC khi Leader đọc … không cho vào handoff") is only half-wired. `safe-launch-wrapper.ps1:72` scans `$PromptFile` **pre-launch**. Grep confirms no caller scans `agent-*-result.md` (or `prevResultFile`) on the **post-run read path** before aggregation/handoff. So a worker that echoes a credential into its *result* (the exact scenario the plan calls out — "Workers … may echo an env var … into their result") flows downstream un-scanned.

Impact: the layer-3 read-path gate is absent; the building block (`scanFiles`, exit-code gate) exists and works, only the hook is missing. Likely Phase 7 (read path lives in the monitor/relay loop), but flagging since the plan attributes it to Phase 6.

Fix direction: in the monitor/relay step that ingests a result before it reaches a Leader/handoff, run `scan-secrets.js <resultFile>` and quarantine on exit 1 (the plan's "quarantine + cảnh báo"). No change to scan-secrets.js.

### M-4 — backup over-collects on glob entries containing `..` (unbounded copy)
`safe-launch-wrapper.ps1:111` `Get-ChildItem -Path (Join-Path $agentCwd $entry)`. Probe: an `agent.files` entry of `..\..\*` expanded to **756 files** (all of `%TEMP%`) and the loop would attempt to copy every one into the backup dir; `..\outside\secret.txt` is silently backed up too. The destination stays *inside* the backup dir (traversal residue trimmed — verified, no escape), but the **set** copied is unbounded and includes files outside the declared zone.

Impact: a hand-edited request whose child `files` contains a `..`-glob makes the mandatory backup copy a huge unrelated tree (latency, disk, and snapshotting files the worker shouldn't touch). `agent.files` originates from the request file (`t.files` → `child.files`), which the threat model treats as editable. Absolute-path entries (`C:\…`) are neutered (joined onto cwd → 0 matches — verified), so only `..`-globs bite.

Fix direction: reject or strip `agent.files` entries containing `..` (mirror `isValidAgentId`'s `..` ban) before the backup loop; optionally cap the per-agent backup file count and resolve each match stays under `$agentCwd`.

---

## Low

### L-1 — `buildLaunchCmd` does not lowercase engine → not byte-identical for a mixed-case engine (UNREACHABLE on the real path)
`pane-spawn.js:29,39`: the guard is `/^[a-z]+$/i` (case-insensitive) but the value is used as-is, and `engine !== 'claude'` is case-sensitive. Probe: `engine:'CLAUDE'` → `node "L" "P" --engine CLAUDE` whereas the old normalizing build → `node "L" "P"`. **But** both callers pass engine through `normalizeEngine` (lowercases + constrains to `ENGINES`) before it reaches `buildLaunchCmd` (proc `:142` `child.engine`; router `:116` `spec.engine`), so the value is always lowercase on the real path — the DIFF never manifests (the 104 legacy + 51 new tests all route through the normalizing callers). Cosmetic / defense-in-depth only.

Fix direction: `const safeEngine = /^[a-z]+$/i.test(engine||'') ? String(engine).toLowerCase() : 'claude';` so the helper is self-contained regardless of caller.

### L-2 — unquoted `"` in launcher/promptFile/safeWrapper/stateFile would break `--cmd` (UNREACHABLE — no untrusted value reaches them)
`pane-spawn.js:31` `q(p) = "<fwd(p)>"` with no embedded-quote escaping. Probe: a `"` in any of these four breaks the quoted token. **But** all four are orchestrator-set: `promptFile = path.join(orchDir,'agent-<id>-prompt.md')` with `id` slug-validated, and `launcher`/`safeWrapper`/`stateFile` come from CLI opts. No request-controlled value reaches them (traced both callers). Same posture as the Phase 5 verified-safe `--cmd` finding. Latent robustness gap only.

Fix direction (defense-in-depth): escape `"`→`""` (or `\"`) inside `q()`, or assert these paths contain no `"` before building the command.

### L-3 — denylist secret/destructive scan also trips on PROSE mentioning a command
`safe-launch-wrapper.ps1:90-96` matches the whole prompt text, which includes mission prose. Probe: a spec saying "Do NOT run `rm -rf` anywhere" → blocked (exit 4). A worker given security-style guidance that *names* a forbidden command in prose is aborted. Minor; same `-AllowDestructive` escape hatch as M-2.

Fix direction: acceptable to leave (fail-safe bias), or restrict the denylist scan to fenced code blocks / lines that look like commands rather than all prose.

---

## Verified safe (checked, NOT bugs — do not "fix")

- **data-fence forged-marker defense.** Content mimicking the gutter is double-guttered (a reader stripping one level still sees it inside); a forged END mid-block leaves exactly **1** bare terminator; CRLF content keeps the real terminator intact (trailing `\r` cosmetic). `:50-63`.
- **data-fence label injection.** Label sanitizer `replace(/[\r\n=]/g,' ')` (`:51`) strips `=`/newlines, so a crafted label cannot forge an un-guttered END — output has exactly 1 real END marker (verified).
- **here-string terminator detection has NO under-detection gap for the real PS threat.** PowerShell ground truth: only `'@`/`"@` at **column 0** actually closes a here-string (`CLOSED_EARLY`); `space+'@` and `tab+'@` stay `INTACT` in PS. The regex `/^[ \t]*['"]@/m` *allows* leading whitespace → it OVER-detects (refuses safe content) = fail-safe, never under-detects. VT/FF/NBSP/em-space leave the here-string intact in PS and the regex correctly ignores them. CR-only/U+2028 are flagged by JS `^` but are over-detection (harmless). `:32-36`.
- **fence() output is always embed-safe.** Every content line gets the `┃ ` gutter, so no line can begin with `'@`/`"@` — the fenced form is safe to carry through a here-string (verified: `hasHereStringTerminator(fence(payload))===false`). `:50-63`.
- **PEM private-key block IS detected.** The `-----BEGIN … PRIVATE KEY-----` header is a single-line anchor, so the per-line scan catches a multi-line key on its header line (verified). Value-only patterns (sk-ant, AKIA, ghp_, …) also catch a secret whose *label* is on a prior line, because they match the value token alone. `scan-secrets.js:62-71`.
- **scan-secrets reuse == fallback (no divergence).** The context-handoff skill IS installed here, so the live path loads `utils.js` (15 patterns). The in-repo `FALLBACK_PATTERNS` is byte-identical to `utils.js:48-64` (diffed) — reuse and fallback agree. `:26-57`.
- **secret gate is fail-safe, no fail-open.** PS probe: `& node $scan $f | Out-Null` preserves `$LASTEXITCODE`; exit 0 → launch, exit 1 (leak) → ABORT, exit 2 (unreadable) → ABORT. The CLI's "unreadable → exit 2 → block" (`scan-secrets.js:105`) wires correctly into the wrapper's `-ne 0` gate. `safe-launch-wrapper.ps1:72-73`.
- **markCrashed preserves wave-close + countActive invariants.** `failed` is a terminal status in reconcile's wave-close (`reconcile-agents.js:71` `completed||failed`) and is excluded from `countActive` (`nested-state.js:107-108`), so a crash-marked agent both closes its wave and frees its slot — exactly what the test asserts (`test-safety-phase6.js:124-126`). Using `failed` (not a new status) was the right call. `crash-recovery.js:91-106`.
- **marker write is atomic and lock-free of state.json.** `writeMarker` writes `progress-<id>.json.tmp.<pid>` then `renameSync` (atomic), to a **separate file** from state.json — never contends on `state.lock`. The worker owns its marker; the orchestrator owns state.json under `withState`. `markCrashed` itself runs inside `withState` (`:146`). No interleave. `:47-49`.
- **findStaleRunning never crash-flags an un-timeable agent.** An agent with neither marker nor `startedAt` yields `NaN` age and is skipped (`:73`); pending agents skipped (`:69`). Only agents it can *prove* went stale are flagged (verified: `notime` agent not flagged). The false-positive in H-2 is the *long-unit-with-startedAt* case, distinct from this.
- **engine/agentId injection neutralized in buildLaunchCmd.** `agentId:'w1;rm -rf'` → `-AgentId` dropped (`/^[A-Za-z0-9._-]+$/` at `pane-spawn.js:36`); `engine:'claude; del *'` → coerced to `claude` (`/^[a-z]+$/i` at `:29`). Verified, matches test assertions `:157-160`.
- **backup destination cannot escape the backup dir.** PS probe: `Resolve-Path -Relative` on a cross-root/UNC path returns a `..\..\…` string, but `TrimStart('.', '\\', '/')` (`:114`) strips ALL leading dots/slashes, so `..\x`→`x`, `..\..\..\..\` → empty; every `dest` resolves under `BACKUPDIR` (`ESCAPES_BACKUPDIR=False` for all samples incl. `sub\..\w.txt`). Absolute-path entries match 0 files (joined onto cwd). `:111-117`.
- **integration is opt-in, default OFF.** `safeWrapper` defaults to `''` (proc `:208`, router `:284`) → `buildLaunchCmd` takes the `node "<launcher>"` branch. Byte-identical to the old inline build for all normal (lowercase, normalized) engines — verified SAME on `claude`/`codex`/`opencode`/undefined; the only DIFF is the unreachable mixed-case L-1 case. No Phase 4/5 regression (51 new + prior suites green).
- **Phase 5 H-1/M-1 now fixed.** Both grid calls are wrapped (proc `:166-167`, router `:237-238`) and both loops have an explicit `errored` bucket (proc `:253`, router `:320`). The slot-leak + error-mis-bucketing from the Phase 5 report are resolved in this diff.

---

## Tests — gaps the 51 passing assertions miss
1. **data-fence wiring** (H-1): no test asserts that `childPromptText`/`continuationPromptText` actually fence their untrusted fields — the suite tests `fence()` in isolation, so the dormant-layer gap is invisible to CI.
2. **long-unit false-crash** (H-2): no test feeds a live `running` agent whose `startedAt` exceeds the window with no marker, then asserts it should NOT be `--mark`ed (or should require N consecutive misses).
3. **write-fence rename/quoted-path** (M-1): no test drives a real `git status --porcelain` with a rename or a special-char filename through the post-run block; `[8]` only checks happy/denylist/secret on out.txt.
4. **denylist Format-* false-positive** (M-2): no test asserts a legit `Format-Table` spec is allowed.
5. **result-file secret scan** (M-3): no test scans an `agent-*-result.md` on a read path (none exists yet).
6. **`..`-glob backup over-collection** (M-4): no test feeds `files: ['..\\*']` and asserts the backup is bounded / rejects traversal.

---

## Unresolved questions
1. **data-fence (H-1):** is wiring `fence()` into the two prompt builders in-scope for Phase 6, or deferred to the Phase 7 read/relay path? The plan lists it under Phase 6 (layer 2) but the code ships it unwired. If deferred, the Phase 6 success-criterion "injection không thực thi (data-fence)" should be marked test-only-for-now.
2. **crash-detect wiring (H-2):** who wires `crash-recovery detect [--mark]` into the monitor loop, and will it run AFTER reconcile in the same pass? The false-crash risk is gated entirely on the `--mark` policy chosen there.
3. **result-file scan (M-3):** confirm the post-run secret scan of result files belongs to Phase 7 (monitor/relay) rather than Phase 6 — the plan text attributes it to Phase 6 step 3.
4. **`agent.files` trust:** are child `files`/`excludeFiles` (which drive backup globbing M-4 and write-fence zoning) writable only by trusted local workers, or can a lower-trust process drop/edit a request file? M-4 and write-fence accuracy scale with the answer (same open question as Phase 5 Q4).
5. **`-AllowDestructive` granularity:** it overrides the ENTIRE denylist at once. With the M-2 false-positive pushing operators toward it, a single legit `Format-Table` would disable `rm -rf` blocking too. Is per-pattern override wanted, or is the all-or-nothing switch acceptable?

**Status:** DONE_WITH_CONCERNS
**Summary:** 51/51 tests pass; the four primitives are individually sound and well-tested — data-fence forged-marker/label defenses verified robust, here-string detection has no real under-detection gap (PS column-0 ground truth), secret gate is fail-safe (exit 1+2 abort), backup cannot escape its dir, markCrashed preserves wave-close/countActive, and the integration is opt-in/byte-identical when off. Found 2 High (data-fence built but NOT wired into either prompt builder → layer-2 dormant; heartbeat false-crashes a live long-unit worker under `--mark`) and 4 Medium (write-fence misparses renames/quoted paths so `-RestoreOutOfZone` silently no-ops; Format-* empty-alternation false-positive; result-file secret scan unwired vs plan step 3; backup over-collects on `..`-globs).
**Concerns:** H-1 means the headline injection defense isn't actually in force on the running system — recommend wiring `fence()` into childPromptText/continuationPromptText before Phase 7 runs real workers. H-2 is latent until the monitor loop wires `detect --mark`, but needs a consecutive-miss or list-cross-check guard before it goes live or it will spawn duplicate workers on slow units. Mediums are advisory-layer degradations (backup remains the real net, which is verified-safe). Report: C:\Users\Bee\recursive-orchestrator\plans\reports\code-review-260609-2303-phase6-safety-layers-report.md
