---
title: "Phase 5 Engine Review — reconcile (5A) + continuation chain (5B)"
date: 2026-06-09
type: report
tags: [code-review, phase-5, reconcile, chain, recursive-orchestrator]
status: active
---

# Phase 5 Engine Review — reconcile + chain

Scope: 4 new scripts (reconcile-agents, pane-spawn, chain-request, chain-router) + 2 test suites + diff of process-nested-requests.js. Shared context read: nested-state, nested-guard, nested-request, launch-agent-ext.

Suites: **all green** — phase4 32/32, reconcile 23/23, chain 41/41 (96 total). Findings below are mostly paths the suites do **not** cover (mid-pass spawn failure, overlapping passes, crash-recovery, deny-path filename build).

Verification = empirical: ran reconcile()/planRoute()/applySpawnNext() directly + drove the CLIs with crafted state/requests + a stub wmux-cli. Each finding cites the probe outcome.

---

## Critical
None. No traversal escape, no foreign-pane corruption, no `--cmd` RCE, no depth-invariant break (all verified, see Security + Verified-safe).

---

## High

### H-1 — `allocateGrid` failure mid-pass leaks a `pending` child/link forever (slot leak, REACHABLE without a crash)
`process-nested-requests.js:161` and `chain-router.js:232` call `allocateGrid` **after** the child/link is already registered `pending` in state.json (proc step 1 `:137`; router `applySpawnNext` `:225`). The `allocateGrid` call is **not** wrapped — only the later `spawnIntoPane` is (`:165-172`, router `:238-251`). If `wmux layout grid` exits nonzero (busy workspace, surface gone, CLI hiccup), `execFileSync` throws → propagates out of `processOne`/`routeOne` → caught by `main` as `{status:'error'}`. Step 4 ("reflect spawn outcome", which marks children `failed`) never runs.

Result, reproduced with a stub wmux-cli that fails only on `layout grid`:
- child `p1-c1` stuck `status:'pending'` (ACTIVE → holds a concurrency slot)
- `countActive` inflated 1→2
- reconcile can **never** free it: no live `wmux agent list` record ever existed for an un-spawned pane, so `reconcile()` has nothing to match (probe5/probe6 confirmed: empty live list leaves `pending` untouched)
- request left at `status:'processing'` → skipped on every future pass (never retried)

Net: one transient `layout grid` failure permanently burns a slot AND wedges that worker's request. Repeated occurrences walk `countActive` toward `maxConcurrent` and eventually fail-closed-deny all spawns.

Impact: availability — the whole point of 5A (free slots so the tree doesn't wedge) is defeated by an unhandled grid error. Same class as the H3 bug it fixes, just triggered differently.

Fix direction (you apply): wrap `allocateGrid` in try/catch in BOTH files; on throw, mark every just-registered child/link of this request `failed`+exitCode and set the request back to `pending` (or `denied`) so the slot is released and state is consistent. Mirror the existing `s.error → failed` path.

---

## Medium

### M-1 — Error results mis-bucketed as success in the summary JSON
`chain-router.js:293-296` and `process-nested-requests.js:243-245`: the dispatch is `skipped→…; denied→…; (relayed→…;) else → spawned/processed`. A `routeOne`/`processOne` that returns `{status:'error'}` (thrown: corrupt request JSON, ENOENT on a bad filename, the H-1 grid throw) falls into the **else** → pushed to `spawned`/`processed`. Verified: status `error` → bucket `spawned` (router) / `processed` (proc).

Impact: observability. An operator reading `processed.length` / `spawned.length` counts failures as successes; the `error` field is present but the headline count lies. Given the monitor loop likely logs these counts, silent failures hide.

Fix direction: add an explicit `error` bucket (or treat unknown status as failure) in both loops.

### M-2 — Continuation/terminal link slots only freed by `process-nested-requests`' reconcile, never by `chain-router`
`chain-router.js` has no reconcile call. A reverse-relay (`routeOne` `:209-219`) writes the marker + sets the request `processed` but **never** moves the terminal link off `running` (verified: `w3` stays `running`, `countActive` stays 1 after relay). Likewise a handed-off link Wk keeps `running` until its pane exits. Both rely on `reconcile()` — which lives only in `process-nested-requests.js:226`.

So the chain's slots are reclaimed **only if** the monitor loop runs `process-nested-requests.js` (with `--wmux-cli`, non-dry) in the same loop as `chain-router.js`. If an operator ever runs `chain-router.js` standalone (or `process-nested` is dry-run / its reconcile is skipped on a list error), every chain link leaks its slot.

Impact: correctness coupling that isn't enforced or documented in chain-router. Not a bug in the happy path (the two run together), but a sharp edge.

Fix direction: either (a) run reconcile at the top of `chain-router.main()` too (DRY: it is already exported), or (b) document the hard dependency in the chain-router header + monitor-loop runbook. (a) is safer and cheap.

### M-3 — TOCTOU: concurrency cap can overshoot across overlapping passes
`routeOne` computes `planRoute(loadState(...))` (no lock) then mutates under a **separate** `withState` (`:199` then `:225`). `process-nested-requests` likewise reads the guard verdict via `loadState` (`:119`, no lock) then registers under `withState` (`:137`). Reconcile runs under its own lock (`:226`), distinct from the guard read.

Within ONE pass this is safe — the loop is sequential and re-reads fresh state each `routeOne`/`processOne`, so request N+1 sees request N's registered link (verified: 7 active + 2 handoffs in one pass → 1 spawned, 1 denied, final active=8, cap held). The overshoot only appears across **two overlapping passes** (two orchestrator processes, or the loop re-entered before the prior pass finished): both read active=7, both pass the cap check, both register → active=9 (reproduced directly via planRoute+applySpawnNext on count=7/cap=8).

Impact: the single-actor monitor-loop design makes overlap unlikely, so latent not live. But nothing *prevents* it — the cap is advisory across passes. Given fail-closed is a stated invariant, the gap is worth closing.

Fix direction: do the guard/concurrency re-check **inside** the same `withState` that registers (compute `countActive`/`evaluateGuard` on the locked `state`, abort the mutation if over cap). Collapses check+register into one atomic section and removes the interleave for both files.

### M-4 — `request.cwd` is unvalidated and becomes a spawned process's `--cwd`
`chain-router.js:224` (`request.cwd || opts.cwd`) and `process-nested-requests.js:133` (`request.cwd || opts.cwd`) take `cwd` verbatim from the (hand-editable) request file and pass it to `spawnIntoPane → wmux agent spawn --cwd <cwd>` (`pane-spawn.js:45`). No `isValidAgentId`/resolve/allow-list (confirmed: neither file validates `request.cwd`). It is the one untrusted value that becomes a real OS-level argument (the worker's working directory).

Impact: an attacker who can edit a request file can launch the worker in an arbitrary directory. Bounded by the threat model — workers already run `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` (launch-agent-ext.js:68,92), so a request-file attacker can already inject `remaining`/`subtask` prompt text into a full-trust agent. So this widens an already-wide boundary rather than opening a new one. Still: cwd is a distinct, lower-effort lever (no prompt-injection needed) and should be fenced.

Fix direction: resolve `request.cwd` and require it to stay within an allowed root (e.g. orchestrator's project root) or fall back to `opts.cwd` if it escapes.

---

## Low

### L-1 — Deny-path response filename built from raw `request.fromAgentId` (defanged by prefix, but fragile)
`chain-router.js:204`: on deny, `chain-response-${request.fromAgentId || 'unknown'}.json` uses the RAW value (planRoute already flagged it invalid, but routeOne reuses the raw field, not a sanitized one). I tried to escape orchDir with `../../`, `..\\..\\`, `/../`, NUL-prefixed variants — **all contained** (verified): the constant `chain-response-` prefix is consumed as a sacrificial path segment, so `path.join(orchDir,'chain-response-'+'../../X'+'.json')` collapses back to `<orchDir>/X.json`. Worst case = an attacker controls the response filename *within* orchDir (writes `X.json` instead of `chain-response-evil.json`); some traversal payloads instead just ENOENT-throw (→ M-1/M-2 error path). No escape.

Fix direction (defense-in-depth): guard the filename with `isValidAgentId(request.fromAgentId)` before building it, or write the deny-response under a fixed safe name when the id is invalid (the nested processor already does exactly this — `process-nested-requests.js:106-111` deliberately skips writing a response when parentId is untrusted; chain-router should match that pattern).

### L-2 — `makeLinkId` can desync link id from `linkSeq`
`chain-router.js:63-69`: on id collision it bumps `++n` from `seq`, so a taken `chain-x-L2` yields id `chain-x-L4` while `applySpawnNext` still sets `linkSeq = plan.nextSeq = 2` and `from.nextLink = 2` (`:164,171`). Verified: L2,L3 taken → id `chain-x-L4`, but seq would be 2. Then `nextLink=2` no longer points at any link whose `linkSeq===2`.

Impact: only reachable if an out-of-band id already occupies the `L2` slot (chains are normally monotonic, so unlikely). If it happens, `nextLink` traversal by seq breaks. Cosmetic today; could bite a future "walk the chain by nextLink" consumer.

Fix direction: derive id from the FINAL seq (`chain-x-L${finalSeq}`) and set `link.linkSeq`/`from.nextLink` to that same `finalSeq`, so id and seq never diverge.

### L-3 — `surfaceId` fallback can mis-stamp a legacy child if wmux recycles a surfaceId
`reconcile-agents.js:53-54`: match `wmuxAgentId` first, else `surfaceId`. For a legacy child lacking `wmuxAgentId`, a *foreign* exited live record that happens to reuse the child's old `surfaceId` would mis-stamp the child terminal (verified the match fires on shared surfaceId). New children all store `wmuxAgentId` now (the Phase-5 diff adds it — `process-nested-requests.js:143,181`; chain links `:166,245`), so this only affects pre-Phase-5 records, and only if wmux recycles surface ids within a session. Low.

Fix direction: none needed if you accept legacy records are transient; optionally drop the surfaceId fallback once no `wmuxAgentId`-less records can exist.

---

## Verified safe (checked, NOT bugs — do not "fix")

- **Depth invariant (5B core).** Continuation keeps depth across W1→W2→W3 (verified 3/3/3); a depth-5 chain still extends (continuation ≠ nesting, only a slot consumed); `applySpawnNext` always writes the `depth` field so `agentDepth()`'s parent-walk fallback never fires for links. nextLink wiring correct (w1→2, l2→3). `:97,164,171`.
- **`--cmd` injection / RCE.** `spawnIntoPane` (`pane-spawn.js:37-48`) passes `label`/`cwd` as separate `execFileSync` argv (no shell). The `--cmd` string = `node "<launcher>" "<promptFile>"<engineArg>`: launcher is orchestrator-set, promptFile is orchestrator-built from a slug-safe id, engineArg is constrained to the `ENGINES` set via `normalizeEngine`/`sanitizeNext` (`:33,115`). No untrusted value reaches `--cmd`.
- **Foreign-pane safety (5A invariant).** reconcile only iterates `listAgents(state)` and matches by ids already in state; a live list of the user's own panes (incl. an exited foreign one) produces zero transitions and leaves state byte-identical (verified `JSON.stringify` equality). User panes never added/touched. `:51-61`.
- **Exit classification.** exit 0 → completed; nonzero / kill code -1073741510 / missing exitCode / explicit null → failed (all verified). Matches on-agent-stop.sh rule. `:32-35`.
- **Idempotency (happy path).** processed/processing requests are skipped on re-run (verified: router re-run → skipped=1, spawned=0). Status ladder pending→processing→processed prevents double-spawn within normal operation. (The crash-mid-`processing` gap is M-1/recovery, separate.)
- **Phase 4 regression.** `spawnIntoPane` reproduces old inline `spawnChild` exactly — same `--cmd` build, same argv order (`--label`,`--cwd`), same `engineArg` rule. Only diff: `fwd` now `String(p).replace` vs old `p.replace` (coerces instead of throwing on non-string) — strictly more robust. The `wmuxAgentId` add is additive. No behavior change on the real-spawn path.
- **`wmux agent list` failure handling.** `fetchLiveAgents` throw is caught in `process-nested-requests.js:227-230` → reconcile skipped, loop continues (does NOT wedge). Matches the requirement.
- **prevResultFile / files[] / excludeFiles[].** Reach prompt **markdown only** (`continuationPromptText` `:131,139,141`), never an exec or a path op in the router. sanitizeNext strips newlines (`:110-114`). A traversal in prevResultFile just tells a (already full-trust) worker to read an arbitrary path — informational, not an escalation.
- **relay marker filename.** `relay-${plan.chainId}.json` (`:213`) uses `chainId` from the agent record (set by makeChainId → slug-safe), NOT from the request file — not attacker-controlled even with an edited request.

---

## Tests — gaps the 96 passing assertions miss
1. **Spawn-failure mid-pass** (H-1): no test injects an `allocateGrid`/`layout grid` failure. Both suites' non-dry path is untested for partial failure; the `!paneId` case is covered but the `allocateGrid` *throw* is not. Add: stub wmux-cli failing on `layout grid`, assert registered children end `failed` (not `pending`) and the slot is freed.
2. **Overlapping passes** (M-3): no test runs two concurrent routes against one state; cap-across-passes is unverified.
3. **Reverse-relay slot release** (M-2): test 6 asserts the marker but NOT that the terminal link's slot is reclaimed (it isn't, by design, until reconcile runs) — add an assertion documenting the dependency.
4. **Error bucketing** (M-1): no test asserts an `error` result is reported as an error vs `spawned`/`processed`.
5. **`processing`-stuck recovery**: no test for a request left `processing` by a prior crash (currently skipped forever).
6. **cwd validation** (M-4): no test feeds a malicious `request.cwd`.

---

## Unresolved questions
1. Does the production monitor loop ALWAYS run `process-nested-requests.js` (non-dry, with `--wmux-cli`) alongside `chain-router.js` in every pass? M-2's slot reclamation depends on it. If chain-router can run alone, M-2 escalates to High.
2. Is overlapping-pass execution actually possible in the monitor loop (e.g. a slow pass while a timer fires the next)? If passes are strictly serialized by the loop, M-3 stays latent; if not, it's live.
3. Crash-recovery (`processing`-stuck requests, partially-registered waves) — the code comments defer C4 to Phase 6. Confirm H-1's mid-pass leak is in-scope for Phase 5 (it's a non-crash error path, not pure crash-recovery) or explicitly deferred.
4. Threat model for request files: are `chain-request-*.json` / `nested-request-*.json` writable only by trusted local workers, or could a lower-trust process drop one? M-4/L-1 severity scales with the answer.

**Status:** DONE_WITH_CONCERNS
**Summary:** 96/96 tests pass; core invariants (depth, foreign-pane safety, no `--cmd` RCE, no traversal escape) verified solid. Found 1 High (reachable slot leak on `allocateGrid` failure mid-pass, in both proc + router) and 4 Medium (error mis-bucketing, chain-router never reconciles its own slots, cross-pass TOCTOU cap overshoot, unvalidated `request.cwd`→`--cwd`).
**Concerns:** H-1 defeats the very slot-freeing 5A exists to provide, on a transient grid error — recommend fixing before landing. M-2 is a silent coupling: chain slots leak unless process-nested's reconcile runs in the same loop (confirm Q1). Remaining Mediums are hardening/observability. Report: C:\Users\Bee\recursive-orchestrator\plans\reports\code-review-260609-2221-phase5-engine-reconcile-chain-report.md
