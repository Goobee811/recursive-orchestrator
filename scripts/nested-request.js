#!/usr/bin/env node
// nested-request.js — run by a WORKER that has hit a sub-task it wants to fan out.
// The worker cannot spawn its own pane reliably (Phase 1 spike verdict: FALLBACK —
// `layout grid --anchor-surface` reshapes the workspace flat and swallows the
// orchestrator's surface). So the worker instead records its INTENT to a file; the
// orchestrator (single actor) picks it up and spawns on its behalf. The logical
// parent->child tree is preserved through state.json, only the button-press is
// centralized — no focus-steal, no layout-grid mixups.
//
// The worker runs the guard first so it doesn't bother writing a request that will
// be denied. The orchestrator re-checks anyway (nested-guard is authoritative there).
//
// Usage:
//   node nested-request.js --state <state.json> --parent <agentId> --tasks <tasks.json>
//                          [--cwd <dir>] [--max-depth 5] [--max-concurrent 8]
//   tasks.json = [ { "label": "...", "subtask": "...",
//                    "files"?: [..], "excludeFiles"?: [..], "engine"?: "claude|opencode|codex" } ]
// Exit: 0 = request written (orchestrator will spawn), 3 = denied/do-it-yourself, 2 = bad usage.

'use strict';

const fs = require('fs');
const path = require('path');
const { loadState, agentDepth, ENGINES, isValidAgentId } = require('./nested-state');
const { evaluateGuard } = require('./nested-guard');

const MAX_LABEL = 200;
const MAX_SUBTASK = 8000;

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

// Basic data-fence: reject shapes that would poison the child prompt or --cmd.
// Phase 6 hardens this (secret-scan, here-string RCE); here we keep it minimal.
function sanitizeTasks(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('tasks must be a non-empty JSON array');
  return raw.map((t, i) => {
    if (!t || typeof t !== 'object') throw new Error(`task[${i}] is not an object`);
    const label = String(t.label || '').trim();
    const subtask = String(t.subtask || '').trim();
    if (!label) throw new Error(`task[${i}].label is required`);
    if (!subtask) throw new Error(`task[${i}].subtask is required`);
    if (label.length > MAX_LABEL) throw new Error(`task[${i}].label exceeds ${MAX_LABEL} chars`);
    if (subtask.length > MAX_SUBTASK) throw new Error(`task[${i}].subtask exceeds ${MAX_SUBTASK} chars`);
    const files = toStringArray(t.files, `task[${i}].files`);
    const excludeFiles = toStringArray(t.excludeFiles, `task[${i}].excludeFiles`);
    const engine = String(t.engine || 'claude').toLowerCase();
    if (!ENGINES.has(engine)) throw new Error(`task[${i}].engine "${engine}" not in ${[...ENGINES].join('|')}`);
    return { label, subtask, files, excludeFiles, engine };
  });
}

function toStringArray(v, ctx) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(`${ctx} must be an array`);
  return v.map((s, j) => {
    const str = String(s);
    if (/[\r\n]/.test(str)) throw new Error(`${ctx}[${j}] contains a newline`);
    return str;
  });
}

function main() {
  const stateFile = getFlag('--state', '');
  const parentAgentId = getFlag('--parent', '');
  const tasksFile = getFlag('--tasks', '');
  if (!stateFile || !parentAgentId || !tasksFile) {
    process.stderr.write('Usage: node nested-request.js --state <state.json> --parent <agentId> --tasks <tasks.json> [--cwd dir] [--max-depth 5] [--max-concurrent 8]\n');
    process.exit(2);
  }
  // The parent id becomes the request filename; reject traversal/metachars.
  if (!isValidAgentId(parentAgentId)) {
    process.stderr.write(`nested-request: invalid --parent "${parentAgentId}" (must match [A-Za-z0-9._-], no "..")\n`);
    process.exit(2);
  }
  const maxDepth = parseInt(getFlag('--max-depth', '5'), 10);
  const maxConcurrent = parseInt(getFlag('--max-concurrent', '8'), 10);
  const cwd = getFlag('--cwd', process.cwd());

  let state, subTasks;
  try {
    state = loadState(stateFile);
    subTasks = sanitizeTasks(JSON.parse(fs.readFileSync(tasksFile, 'utf8')));
  } catch (e) {
    process.stderr.write(`nested-request: ${e.message}\n`);
    process.exit(2);
  }

  const verdict = evaluateGuard(state, { parentAgentId, count: subTasks.length, maxDepth, maxConcurrent });
  if (verdict.decision !== 'allow') {
    process.stdout.write(JSON.stringify({ ...verdict, action: 'do-it-yourself' }) + '\n');
    process.stderr.write(`nested-request DENIED: ${verdict.reason}. Do the ${subTasks.length} sub-task(s) sequentially yourself.\n`);
    process.exit(3);
  }

  const orchDir = path.dirname(stateFile);
  const requestFile = path.join(orchDir, `nested-request-${parentAgentId}.json`);

  // One outstanding batch per worker: don't clobber a request still being served.
  if (fs.existsSync(requestFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
      if (existing.status === 'pending' || existing.status === 'processing') {
        process.stdout.write(JSON.stringify({ decision: 'allow', action: 'already-requested', requestFile, status: existing.status }) + '\n');
        process.stderr.write(`nested-request: a ${existing.status} request already exists at ${requestFile}; wait for nested-response-${parentAgentId}.json.\n`);
        process.exit(0);
      }
    } catch { /* corrupt/stale prior request — overwrite below */ }
  }

  const request = {
    parentAgentId,
    parentDepth: agentDepth(state, parentAgentId),
    childDepth: verdict.childDepth,
    cwd,
    requestedAt: new Date().toISOString(),
    status: 'pending',
    subTasks,
  };
  const tmp = path.join(orchDir, `nested-request-${parentAgentId}.json.tmp.${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(request, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, requestFile);

  process.stdout.write(JSON.stringify({ decision: 'allow', action: 'requested', requestFile, childDepth: verdict.childDepth, count: subTasks.length }) + '\n');
  process.stderr.write(`nested-request: wrote ${requestFile} (${subTasks.length} child task(s)). Orchestrator will spawn; watch nested-response-${parentAgentId}.json.\n`);
}

main();
