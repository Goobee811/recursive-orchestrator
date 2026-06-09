#!/usr/bin/env node
// process-nested-requests.js — the orchestrator side of nested recursion. Run by
// the MAIN session (which owns the orchestrator surface) inside its monitor loop.
// One pass: pick up every pending nested-request-*.json a worker dropped, re-check
// the guard authoritatively, register the children in state.json as a new wave
// (carrying parentAgentId + depth so the tree is reconstructable), spawn each child
// into a fresh pane on the orchestrator's own surface (NOT the worker's — Phase 1
// verdict), and write back nested-response-<parent>.json.
//
// Why the orchestrator spawns and not the worker: `layout grid` auto-anchors to
// $WMUX_SURFACE_ID, and running here that is the orchestrator's surface — the exact
// path spawn-agents.sh proved works. A worker doing the same swallows the
// orchestrator surface into its pane (spike B2). Centralizing the button-press is
// the whole point of the FALLBACK design.
//
// Usage:
//   node process-nested-requests.js --state <state.json>
//        [--anchor <surfaceId>] [--launcher <path>] [--wmux-cli <path>]
//        [--max-depth 5] [--max-concurrent 8] [--dry-run]
// Output (stdout JSON): { processed: [...], denied: [...], skipped: N }

'use strict';

const fs = require('fs');
const path = require('path');
const { loadState, withState, findAgent, makeChildId, addNestedWave, ENGINES, isValidAgentId } = require('./nested-state');
const { evaluateGuard } = require('./nested-guard');
const { reconcile, fetchLiveAgents } = require('./reconcile-agents');
const { allocateGrid, spawnIntoPane, fwd } = require('./pane-spawn');
const { fence } = require('./data-fence');

const normalizeEngine = (e) => {
  const v = String(e || 'claude').toLowerCase();
  return ENGINES.has(v) ? v : 'claude'; // unknown engine from the request file → safe default
};

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

function setRequestStatus(requestFile, status) {
  const req = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  req.status = status;
  const tmp = `${requestFile}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(req, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, requestFile);
}

function writeResponse(orchDir, parentId, payload) {
  const file = path.join(orchDir, `nested-response-${parentId}.json`);
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ ...payload, respondedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function childPromptText(child, ctx) {
  const list = (arr, empty) => (arr && arr.length ? arr.map((f) => `- ${f}`).join('\n') : empty);
  const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
  return `# Mission: ${oneLine(child.label)}

## Nested Orchestration Context
You are ${child.id}, a nested worker at depth ${child.depth} (orchestrator=0, max ${ctx.maxDepth}).
Spawned on behalf of parent ${child.parentAgentId} by the orchestrator (FALLBACK relay).
Working directory: ${ctx.cwd}

## Your Zone of Work
Allowed files (you MAY modify these):
${list(child.files, '- (scope yourself within the mission)')}

Excluded files (you MUST NOT modify these):
${list(child.excludeFiles, '- (none specified)')}

## Your Mission
${fence(child.subtask, 'mission spec relayed for your parent')}

## If you must fan out further
You cannot create panes yourself. Write an intent file and the orchestrator spawns for you:
  node "${fwd(ctx.scriptsDir)}/nested-request.js" --state "${fwd(ctx.stateFile)}" --parent ${child.id} --tasks <your-tasks.json> --cwd "${ctx.cwd}"
The guard enforces depth <= ${ctx.maxDepth} and total live agents <= ${ctx.maxConcurrent}.
If it denies you, do the sub-tasks sequentially yourself. Then watch nested-response-${child.id}.json.

## When You Finish
Write your result file to: ${child.resultFile}
### Summary
[2-3 sentences]
### Files Modified
- \`path\` — [what changed]
### Tests
[results or "Out of scope"]
### Risks
[anything the parent / reviewer should know]
`;
}

function processOne(requestFile, opts) {
  const orchDir = path.dirname(opts.stateFile);
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  if (request.status !== 'pending') return { status: 'skipped', file: requestFile };

  const parentId = request.parentAgentId;
  const subTasks = Array.isArray(request.subTasks) ? request.subTasks : [];

  // The request file is a second trust boundary (it can be edited outside the
  // worker path), so re-validate here rather than trusting nested-request.js.
  if (!isValidAgentId(parentId)) {
    // Don't write a response file here — parentId is exactly the untrusted value,
    // and it would become the response filename (the traversal we're blocking).
    setRequestStatus(requestFile, 'denied');
    return { status: 'denied', parentAgentId: parentId, reason: 'invalid parentAgentId' };
  }
  if (subTasks.length === 0) {
    setRequestStatus(requestFile, 'denied');
    writeResponse(orchDir, parentId, { status: 'denied', parentAgentId: parentId, reason: 'empty subTasks' });
    return { status: 'denied', parentAgentId: parentId, reason: 'empty subTasks' };
  }

  // Authoritative guard re-check — the worker's check was only advisory.
  const verdict = evaluateGuard(loadState(opts.stateFile), {
    parentAgentId: parentId, count: subTasks.length,
    maxDepth: opts.maxDepth, maxConcurrent: opts.maxConcurrent,
  });
  if (verdict.decision !== 'allow') {
    setRequestStatus(requestFile, 'denied');
    writeResponse(orchDir, parentId, { status: 'denied', parentAgentId: parentId, reason: verdict.reason });
    return { status: 'denied', parentAgentId: parentId, reason: verdict.reason };
  }

  setRequestStatus(requestFile, 'processing'); // idempotency guard against a re-run mid-flight

  // 1. Register children as a new wave (under lock, atomic).
  const ctx = {
    cwd: request.cwd || opts.cwd,
    maxDepth: opts.maxDepth, maxConcurrent: opts.maxConcurrent,
    scriptsDir: __dirname, stateFile: opts.stateFile, launcher: opts.launcher,
  };
  const { children, waveIndex } = withState(opts.stateFile, (state) => {
    const kids = subTasks.map((t, i) => {
      const id = makeChildId(state, parentId, i + 1);
      return {
        id, label: t.label, subtask: t.subtask, files: t.files || [], excludeFiles: t.excludeFiles || [],
        engine: normalizeEngine(t.engine), parentAgentId: parentId, depth: verdict.childDepth,
        paneId: null, surfaceId: null, wmuxAgentId: null, status: 'pending', exitCode: null, toolUses: 0,
        resultFile: path.join(orchDir, `agent-${id}-result.md`), startedAt: null, finishedAt: null,
      };
    });
    const idx = addNestedWave(state, kids);
    return { children: kids, waveIndex: idx };
  });

  // 2. Write each child's prompt file.
  for (const child of children) {
    child.promptFile = path.join(orchDir, `agent-${child.id}-prompt.md`);
    fs.writeFileSync(child.promptFile, childPromptText(child, ctx), 'utf8');
  }

  // 3. Spawn (unless dry-run). Request a grid with one extra cell for the
  //    orchestrator pane; the new panes come back in newPaneIds, row-major.
  const spawned = [];
  if (!opts.dryRun) {
    // If `layout grid` throws, every child must still flow to step 4 and be marked
    // failed (freeing its slot). Letting the throw escape would skip step 4 and wedge
    // the children at 'pending' forever — they have no live record yet, so reconcile
    // could never close them. Treat a grid failure as "no panes allocated".
    let newPaneIds = [];
    try { newPaneIds = allocateGrid(opts.wmuxCli, children.length); }
    catch (e) { process.stderr.write(`process-nested-requests: layout grid failed (${e.message})\n`); }
    children.forEach((child, i) => {
      const paneId = newPaneIds[i];
      if (!paneId) { spawned.push({ id: child.id, error: 'no pane allocated' }); return; }
      try {
        const { agentId, surfaceId } = spawnIntoPane(opts.wmuxCli, paneId, {
          launcher: ctx.launcher, promptFile: child.promptFile, engine: child.engine, label: child.label, cwd: ctx.cwd,
          safeWrapper: opts.safeWrapper, stateFile: opts.stateFile, agentId: child.id,
        });
        spawned.push({ id: child.id, paneId, agentId, surfaceId, label: child.label, engine: child.engine, resultFile: child.resultFile });
      } catch (e) {
        spawned.push({ id: child.id, paneId, error: e.message });
      }
    });
    // 4. Reflect spawn outcome into state (one lock pass).
    withState(opts.stateFile, (state) => {
      const now = new Date().toISOString();
      for (const s of spawned) {
        const found = findAgent(state, s.id);
        if (!found) continue;
        if (s.error) { found.agent.status = 'failed'; found.agent.exitCode = -1; }
        else { found.agent.paneId = s.paneId; found.agent.surfaceId = s.surfaceId; found.agent.wmuxAgentId = s.agentId; found.agent.status = 'running'; found.agent.startedAt = now; }
      }
    });
  } else {
    children.forEach((child) => spawned.push({ id: child.id, paneId: '(dry-run)', label: child.label, engine: child.engine, resultFile: child.resultFile }));
  }

  setRequestStatus(requestFile, 'processed');
  const responseFile = writeResponse(orchDir, parentId, {
    status: opts.dryRun ? 'dry-run' : 'spawned', parentAgentId: parentId, waveIndex, children: spawned,
  });
  return { status: opts.dryRun ? 'dry-run' : 'spawned', parentAgentId: parentId, waveIndex, children: spawned, responseFile };
}

function main() {
  const opts = {
    stateFile: getFlag('--state', ''),
    anchor: getFlag('--anchor', process.env.WMUX_SURFACE_ID || ''),
    launcher: getFlag('--launcher', path.join(__dirname, 'launch-agent-ext.js')),
    wmuxCli: getFlag('--wmux-cli', process.env.WMUX_CLI || ''),
    safeWrapper: getFlag('--safe-wrapper', process.env.WMUX_SAFE_WRAPPER || ''),
    maxDepth: parseInt(getFlag('--max-depth', '5'), 10),
    maxConcurrent: parseInt(getFlag('--max-concurrent', '8'), 10),
    cwd: getFlag('--cwd', process.cwd()),
    dryRun: hasFlag('--dry-run'),
  };
  if (!opts.stateFile) {
    process.stderr.write('Usage: node process-nested-requests.js --state <state.json> [--launcher p] [--wmux-cli p] [--max-depth 5] [--max-concurrent 8] [--dry-run]\n');
    process.exit(2);
  }
  if (!opts.dryRun && !opts.wmuxCli) {
    process.stderr.write('process-nested-requests: --wmux-cli or $WMUX_CLI required unless --dry-run\n');
    process.exit(2);
  }

  const orchDir = path.dirname(opts.stateFile);

  // Reconcile first: close out any child whose pane process already exited so its
  // concurrency slot is freed BEFORE the guard re-checks the pending requests below
  // (otherwise a dead-but-still-'running' child could deny a fresh, valid spawn).
  // wmux-spawned agents get no SubagentStop hook, so this poll is the only path
  // that ever moves them off 'running'. A list failure must not wedge the loop.
  let reconciled = null;
  if (!opts.dryRun && opts.wmuxCli) {
    try {
      const live = fetchLiveAgents(opts.wmuxCli);
      reconciled = withState(opts.stateFile, (state) => reconcile(state, live));
    } catch (e) {
      reconciled = { error: e.message };
      process.stderr.write(`process-nested-requests: reconcile skipped (${e.message})\n`);
    }
  }

  const requestFiles = fs.readdirSync(orchDir)
    .filter((f) => /^nested-request-.+\.json$/.test(f))
    .map((f) => path.join(orchDir, f));

  const processed = [], denied = [], errored = [];
  let skipped = 0;
  for (const file of requestFiles) {
    let r;
    try { r = processOne(file, opts); }
    catch (e) { r = { status: 'error', file, error: e.message }; }
    if (r.status === 'skipped') skipped++;
    else if (r.status === 'denied') denied.push(r);
    else if (r.status === 'error') errored.push(r);
    else processed.push(r);
  }
  process.stdout.write(JSON.stringify({ reconciled, processed, denied, errored, skipped }, null, 2) + '\n');
}

main();
