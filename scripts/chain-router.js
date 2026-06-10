#!/usr/bin/env node
// chain-router.js — the orchestrator side of the 180k continuation chain. A single
// thread of work may outlive one worker's context window, so it runs as a CHAIN of
// links W1 -> W2 -> ... -> Wn, each continuing from the previous link's result. When
// the thread finishes, the chain reverse-relays back to its Leader.
//
// Routing is driven by state, NOT by handoff-file frontmatter (red-team H5/H6: slug
// prefixes are fuzzy and `chain_end` markers were never read). Each link carries
// chainId + linkSeq + nextLink + leaderAgentId on its agent record:
//   - handoff (thread unfinished): spawn link seq+1, set this link's nextLink = seq+1.
//   - done    (thread finished):   nextLink stays null (the explicit terminator) and
//                                  we drop a relay marker the Leader reads.
//
// Continuation is NOT nesting: the next link keeps the SAME depth (same work, new
// session), so it does not consume a depth level — only a concurrency slot.
//
// Usage (orchestrator, in the monitor loop):
//   node chain-router.js --state <state.json> [--wmux-cli p] [--launcher p]
//        [--max-concurrent 8] [--dry-run]
// Usage (helper, seed a thread as link 1 before its first worker spawns):
//   node chain-router.js seed --state <s> --agent <id> [--leader <agentId>] [--chain-id <id>]
// Output (stdout JSON): { spawned: [...], relayed: [...], denied: [...], skipped: N }

'use strict';

const fs = require('fs');
const path = require('path');
const { loadState, withState, findAgent, addNestedWave, countActive, ENGINES, isValidAgentId } = require('./nested-state');
const { allocateGrid, allocateSplit, closeSurfaceQuiet, spawnIntoPane, fwd } = require('./pane-spawn');
const { reconcile, fetchLiveAgents } = require('./reconcile-agents');
const { fence } = require('./data-fence');

const MAX_LABEL = 200;
const MAX_REMAINING = 8000;
const normalizeEngine = (e) => { const v = String(e || 'claude').toLowerCase(); return ENGINES.has(v) ? v : 'claude'; };

// ── chain identity & seeding ────────────────────────────────────────────────

// Build a chainId unique within state. Deterministic (no Date/random): scan existing
// chainIds and bump a counter, so two seeds in one state never collide.
function makeChainId(state, seed) {
  const slug = (String(seed || 'thread').match(/[A-Za-z0-9._-]+/g) || ['thread']).join('-').slice(0, 40);
  const taken = new Set();
  for (const w of state.waves || []) for (const a of w.agents || []) if (a.chainId) taken.add(a.chainId);
  let id = `chain-${slug}`;
  let n = 1;
  while (taken.has(id)) id = `chain-${slug}-${++n}`;
  return id;
}

// Stamp an existing agent as link 1 of a new chain. Returns its chainId.
function seedChain(state, { agentId, leaderAgentId = null, chainId = null }) {
  const found = findAgent(state, agentId);
  if (!found) throw new Error(`seedChain: agent "${agentId}" not in state`);
  const a = found.agent;
  a.chainId = chainId || makeChainId(state, agentId);
  a.linkSeq = 1;
  a.nextLink = null;
  a.leaderAgentId = leaderAgentId;
  return a.chainId;
}

// A link id is unique + a safe slug (it becomes prompt/result filenames + travels
// into the --cmd string), mirroring makeChildId for nested children.
function makeLinkId(state, chainId, seq) {
  const taken = new Set();
  for (const w of state.waves || []) for (const a of w.agents || []) taken.add(a.id);
  let id = `${chainId}-L${seq}`;
  let n = seq;
  while (taken.has(id)) id = `${chainId}-L${++n}`;
  return id;
}

// ── pure routing decision ───────────────────────────────────────────────────

// Decide what to do with one chain-request WITHOUT mutating/spawning (testable).
// Returns { action: 'spawn-next' | 'reverse-relay' | 'deny' | 'skip', ... }.
function planRoute(state, request, { maxConcurrent = 8 } = {}) {
  if (!request || request.status !== 'pending') return { action: 'skip', reason: 'not pending' };
  const fromId = request.fromAgentId;
  if (!isValidAgentId(fromId)) return { action: 'deny', fromAgentId: fromId, reason: 'invalid fromAgentId' };
  const found = findAgent(state, fromId);
  if (!found || !found.agent.chainId) return { action: 'deny', fromAgentId: fromId, reason: 'from-agent is not a chain link' };
  const from = found.agent;
  const fromSeq = Number.isInteger(from.linkSeq) ? from.linkSeq : 1;

  if (request.done === true) {
    return { action: 'reverse-relay', chainId: from.chainId, fromAgentId: fromId, fromLinkSeq: fromSeq,
      leaderAgentId: from.leaderAgentId || null, lastResultFile: from.resultFile || null };
  }
  // handoff → spawn next link. Continuation keeps depth; it only needs a free slot.
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    return { action: 'deny', fromAgentId: fromId, reason: `invalid maxConcurrent ${maxConcurrent}; fail-closed` };
  }
  if (countActive(state) + 1 > maxConcurrent) {
    return { action: 'deny', fromAgentId: fromId, reason: `spawning next link would exceed maxConcurrent ${maxConcurrent}` };
  }
  return { action: 'spawn-next', chainId: from.chainId, fromAgentId: fromId, fromLinkSeq: fromSeq,
    nextSeq: fromSeq + 1, depth: Number.isInteger(from.depth) ? from.depth : 1, leaderAgentId: from.leaderAgentId || null };
}

// Re-validate the next-link spec from the (untrusted) request file. Defense in depth:
// the worker wrote it, but the file can be edited outside the worker path.
function sanitizeNext(next, orchDir, linkId) {
  const n = next || {};
  const label = String(n.label || '').trim();
  const remaining = String(n.remaining || '').trim();
  if (!label) throw new Error('next.label required');
  if (!remaining) throw new Error('next.remaining required');
  if (label.length > MAX_LABEL) throw new Error(`next.label exceeds ${MAX_LABEL}`);
  if (remaining.length > MAX_REMAINING) throw new Error(`next.remaining exceeds ${MAX_REMAINING}`);
  const files = (Array.isArray(n.files) ? n.files : []).map(String).filter((s) => !/[\r\n]/.test(s));
  const excludeFiles = (Array.isArray(n.excludeFiles) ? n.excludeFiles : []).map(String).filter((s) => !/[\r\n]/.test(s));
  // prevResultFile points the next link at the prior result; keep it inside orchDir.
  let prevResultFile = String(n.prevResultFile || '').trim();
  if (/[\r\n]/.test(prevResultFile)) prevResultFile = '';
  return { label, remaining, engine: normalizeEngine(n.engine), files, excludeFiles, prevResultFile };
}

function resolvePrevResultFallback(spec, orchDir, fromAgentId) {
  if (!spec.prevResultFile) return spec;
  const prevResultPath = path.isAbsolute(spec.prevResultFile) ? spec.prevResultFile : path.join(orchDir, spec.prevResultFile);
  if (fs.existsSync(prevResultPath)) return { ...spec, prevResultFileExists: true };
  const prevOutJsonl = path.join(orchDir, `agent-${fromAgentId}-out.jsonl`);
  return { ...spec, prevResultFileExists: false, prevOutJsonl: fs.existsSync(prevOutJsonl) ? prevOutJsonl : '' };
}

// ── prompt for a continuation link ──────────────────────────────────────────

function readFirstText(link) {
  if (link.prevResultFile && link.prevResultFileExists !== false) return `- ${link.prevResultFile}`;
  if (link.prevResultFile && link.prevOutJsonl) {
    return `- Result file not written yet for ${link.prevResultFile}; the previous link may have exited cleanly before harvest.
- Read ${link.prevOutJsonl} instead.
- The result file may appear later after harvest.`;
  }
  return '- (no prior result file recorded — read the chain so far)';
}

function continuationPromptText(link, ctx) {
  const list = (arr, empty) => (arr && arr.length ? arr.map((f) => `- ${f}`).join('\n') : empty);
  const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
  return `# Continuation: ${oneLine(link.label)}

## Chain Context
You are ${link.id} — link ${link.linkSeq} of continuation chain ${link.chainId}.
The previous link hit its context budget (180k) and handed off. Pick up EXACTLY where
it left off; do not redo finished work. Depth ${link.depth} (unchanged across the chain).
Working directory: ${ctx.cwd}

## Read First — previous link's result
${readFirstText(link)}
That file lists what was done, the decisions made, and the work that remains.

## Remaining Work
${fence(link.remaining, 'remaining-work spec from the previous link')}

## Your Zone of Work
Allowed files (you MAY modify these):
${list(link.files, '- (scope yourself within the remaining work)')}
Excluded files (you MUST NOT modify these):
${list(link.excludeFiles, '- (none specified)')}

## When You Finish
Write your result file to: ${link.resultFile}
### Summary / Decisions / Files Modified / Remaining / Risks

## If YOU also hit the budget before finishing
You cannot spawn your own successor. Record intent and the orchestrator continues the chain:
  node "${fwd(ctx.scriptsDir)}/chain-request.js" --state "${fwd(ctx.stateFile)}" --from ${link.id} --done false --label "<next>" --remaining "<what's left>"
When the WHOLE thread is finished instead, signal completion to reverse-relay to the Leader:
  node "${fwd(ctx.scriptsDir)}/chain-request.js" --state "${fwd(ctx.stateFile)}" --from ${link.id} --done true
`;
}

// ── apply (mutating, under lock by the caller via withState) ────────────────

// Register the next link as a new single-agent wave and wire this link's nextLink.
// Returns the new link agent (caller writes its prompt + spawns it).
function applySpawnNext(state, plan, spec, orchDir) {
  const id = makeLinkId(state, plan.chainId, plan.nextSeq);
  const link = {
    id, label: spec.label, subtask: spec.remaining, remaining: spec.remaining,
    files: spec.files, excludeFiles: spec.excludeFiles, engine: spec.engine,
    chainId: plan.chainId, linkSeq: plan.nextSeq, nextLink: null, leaderAgentId: plan.leaderAgentId,
    parentAgentId: plan.fromAgentId, depth: plan.depth, prevResultFile: spec.prevResultFile,
    prevResultFileExists: spec.prevResultFileExists, prevOutJsonl: spec.prevOutJsonl || '',
    paneId: null, surfaceId: null, wmuxAgentId: null, status: 'pending', exitCode: null, toolUses: 0,
    resultFile: path.join(orchDir, `agent-${id}-result.md`), startedAt: null, finishedAt: null,
  };
  addNestedWave(state, [link]);
  const from = findAgent(state, plan.fromAgentId);
  if (from) from.agent.nextLink = plan.nextSeq;
  return link;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

function setRequestStatus(file, status) {
  const req = JSON.parse(fs.readFileSync(file, 'utf8'));
  req.status = status;
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(req, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
function writeJsonAtomic(file, payload) {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function paneOf(stateFile, agentId) {
  const found = findAgent(loadState(stateFile), agentId);
  return found && found.agent ? found.agent.paneId : '';
}

function allocateContinuationPane(opts, fromPane) {
  if (opts.layout === 'split') {
    // harvest-results can kill the completed from-link pane before chain-router runs,
    // so prefer the exact chain pane but fall back to the orchestrator/root pane.
    for (const sourcePane of [fromPane, opts.rootPane].filter(Boolean)) {
      try { return { ...allocateSplit(opts.wmuxCli, sourcePane, 'vertical'), split: 'vertical', sourcePane }; }
      catch (e) { process.stderr.write(`chain-router: split from ${sourcePane} failed (${e.message})\n`); }
    }
  }
  try {
    const paneIds = allocateGrid(opts.wmuxCli, 1);
    return { paneId: paneIds[0] };
  } catch (e) {
    process.stderr.write(`chain-router: layout grid failed (${e.message})\n`);
    return {};
  }
}

function routeOne(requestFile, opts) {
  const orchDir = path.dirname(opts.stateFile);
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  const plan = planRoute(loadState(opts.stateFile), request, { maxConcurrent: opts.maxConcurrent });

  if (plan.action === 'skip') return { status: 'skipped', file: requestFile };
  if (plan.action === 'deny') {
    setRequestStatus(requestFile, 'denied');
    writeJsonAtomic(path.join(orchDir, `chain-response-${request.fromAgentId || 'unknown'}.json`),
      { status: 'denied', reason: plan.reason, respondedAt: new Date().toISOString() });
    return { status: 'denied', fromAgentId: plan.fromAgentId, reason: plan.reason };
  }

  if (plan.action === 'reverse-relay') {
    setRequestStatus(requestFile, 'processed');
    // Terminator is nextLink==null (already null on the terminal link); the marker is
    // what the Leader polls to know the chain is closed + where the last result is.
    const marker = path.join(orchDir, `relay-${plan.chainId}.json`);
    writeJsonAtomic(marker, { chainId: plan.chainId, status: 'relayed', leaderAgentId: plan.leaderAgentId,
      lastAgentId: plan.fromAgentId, lastLinkSeq: plan.fromLinkSeq, lastResultFile: plan.lastResultFile, relayedAt: new Date().toISOString() });
    writeJsonAtomic(path.join(orchDir, `chain-response-${plan.fromAgentId}.json`),
      { status: 'relayed', chainId: plan.chainId, leaderAgentId: plan.leaderAgentId, marker, respondedAt: new Date().toISOString() });
    return { status: 'relayed', chainId: plan.chainId, leaderAgentId: plan.leaderAgentId, lastLinkSeq: plan.fromLinkSeq };
  }

  // spawn-next
  const spec = resolvePrevResultFallback(sanitizeNext(request.next, orchDir, null), orchDir, plan.fromAgentId);
  const fromPane = paneOf(opts.stateFile, plan.fromAgentId);
  setRequestStatus(requestFile, 'processing');
  const ctx = { cwd: request.cwd || opts.cwd, scriptsDir: __dirname, stateFile: opts.stateFile };
  const link = withState(opts.stateFile, (state) => applySpawnNext(state, plan, spec, orchDir));

  link.promptFile = path.join(orchDir, `agent-${link.id}-prompt.md`);
  fs.writeFileSync(link.promptFile, continuationPromptText(link, ctx), 'utf8');

  let spawnInfo = { id: link.id, engine: link.engine, resultFile: link.resultFile };
  if (!opts.dryRun) {
    // Allocation failures must not escape: the link is already registered pending, and
    // no live wmux record exists for reconcile to close if the router wedges here.
    const allocation = allocateContinuationPane(opts, fromPane);
    const paneId = allocation.paneId;
    if (!paneId) {
      withState(opts.stateFile, (state) => { const f = findAgent(state, link.id); if (f) { f.agent.status = 'failed'; f.agent.exitCode = -1; } });
      spawnInfo.error = 'no pane allocated';
    } else {
      try {
        const { agentId, surfaceId } = spawnIntoPane(opts.wmuxCli, paneId, {
          launcher: opts.launcher, promptFile: link.promptFile, engine: link.engine, label: link.label, cwd: ctx.cwd,
          safeWrapper: opts.safeWrapper, stateFile: opts.stateFile, agentId: link.id,
        });
        closeSurfaceQuiet(opts.wmuxCli, allocation.defaultSurfaceId);
        const now = new Date().toISOString();
        withState(opts.stateFile, (state) => {
          const f = findAgent(state, link.id);
          if (f) { f.agent.paneId = paneId; f.agent.surfaceId = surfaceId; f.agent.wmuxAgentId = agentId; f.agent.status = 'running'; f.agent.startedAt = now; }
        });
        spawnInfo = { ...spawnInfo, paneId, agentId, surfaceId, split: allocation.split, sourcePane: allocation.sourcePane };
      } catch (e) {
        withState(opts.stateFile, (state) => { const f = findAgent(state, link.id); if (f) { f.agent.status = 'failed'; f.agent.exitCode = -1; } });
        spawnInfo.error = e.message;
      }
    }
  } else {
    spawnInfo.paneId = '(dry-run)';
  }

  setRequestStatus(requestFile, 'processed');
  writeJsonAtomic(path.join(orchDir, `chain-response-${plan.fromAgentId}.json`),
    { status: opts.dryRun ? 'dry-run' : 'spawned', chainId: plan.chainId, nextLink: spawnInfo, respondedAt: new Date().toISOString() });
  return { status: opts.dryRun ? 'dry-run' : 'spawned', chainId: plan.chainId, fromLinkSeq: plan.fromLinkSeq, nextLink: spawnInfo };
}

function runSeed() {
  const stateFile = getFlag('--state', '');
  const agentId = getFlag('--agent', '');
  if (!stateFile || !agentId) { process.stderr.write('Usage: node chain-router.js seed --state <s> --agent <id> [--leader <agentId>] [--chain-id <id>]\n'); process.exit(2); }
  const chainId = withState(stateFile, (state) => seedChain(state, { agentId, leaderAgentId: getFlag('--leader', null), chainId: getFlag('--chain-id', null) }));
  process.stdout.write(JSON.stringify({ seeded: agentId, chainId }) + '\n');
}

function main() {
  if (process.argv[2] === 'seed') return runSeed();
  const opts = {
    stateFile: getFlag('--state', ''),
    launcher: getFlag('--launcher', path.join(__dirname, 'launch-agent-ext.js')),
    wmuxCli: getFlag('--wmux-cli', process.env.WMUX_CLI || ''),
    safeWrapper: getFlag('--safe-wrapper', process.env.WMUX_SAFE_WRAPPER || ''),
    rootPane: getFlag('--root-pane', process.env.WMUX_PANE_ID || ''),
    layout: (getFlag('--layout', 'split') || 'split').toLowerCase(),
    maxConcurrent: parseInt(getFlag('--max-concurrent', '8'), 10),
    cwd: getFlag('--cwd', process.cwd()),
    dryRun: hasFlag('--dry-run'),
  };
  if (!opts.stateFile) { process.stderr.write('Usage: node chain-router.js --state <state.json> [--wmux-cli p] [--launcher p] [--max-concurrent 8] [--dry-run]\n'); process.exit(2); }
  if (!opts.dryRun && !opts.wmuxCli) { process.stderr.write('chain-router: --wmux-cli or $WMUX_CLI required unless --dry-run\n'); process.exit(2); }

  const orchDir = path.dirname(opts.stateFile);

  // Reconcile first so a link that already exited (e.g. the one that just handed off)
  // releases its slot BEFORE we re-check concurrency for the next link. chain-router
  // must be safe to run standalone — it cannot rely on process-nested-requests sharing
  // the loop to do the reconcile. A list failure must not wedge routing.
  let reconciled = null;
  if (!opts.dryRun && opts.wmuxCli) {
    try {
      const live = fetchLiveAgents(opts.wmuxCli);
      reconciled = withState(opts.stateFile, (state) => reconcile(state, live));
    } catch (e) {
      reconciled = { error: e.message };
      process.stderr.write(`chain-router: reconcile skipped (${e.message})\n`);
    }
  }

  const requestFiles = fs.readdirSync(orchDir).filter((f) => /^chain-request-.+\.json$/.test(f)).map((f) => path.join(orchDir, f));

  const spawned = [], relayed = [], denied = [], errored = [];
  let skipped = 0;
  for (const file of requestFiles) {
    let r;
    try { r = routeOne(file, opts); }
    catch (e) { r = { status: 'error', file, error: e.message }; }
    if (r.status === 'skipped') skipped++;
    else if (r.status === 'denied') denied.push(r);
    else if (r.status === 'relayed') relayed.push(r);
    else if (r.status === 'error') errored.push(r);
    else spawned.push(r);
  }
  process.stdout.write(JSON.stringify({ reconciled, spawned, relayed, denied, errored, skipped }, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = { makeChainId, seedChain, makeLinkId, planRoute, sanitizeNext, applySpawnNext, continuationPromptText };
