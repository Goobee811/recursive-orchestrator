#!/usr/bin/env node
// nested-state.js — shared state.json helpers for the nested-recursion delta.
// Required by nested-guard.js (read-only) and process-nested-requests.js (read+write).
//
// The upstream plugin owns state.json (flat waves[].agents[]) and mutates it via
// json-tool.js under a `state.lock` file. We do NOT edit json-tool.js (fork rule);
// this module reads/writes the same file under the SAME lock filename so the two
// writers never interleave. Nested children are added as a new wave so the
// dashboard, wave-complete logic, and `agent list` queries keep working unchanged;
// the parent->child tree lives in each agent's { parentAgentId, depth } fields.
//
// Depth convention: the orchestrator is depth 0 (it is the main session, never an
// entry in agents[]). An agent spawned directly by the orchestrator is depth 1;
// a nested child of a depth-d agent is depth d+1. maxDepth=5 allows the chain
// orch(0) -> 1 -> 2 -> 3 -> 4 -> 5; a request for depth 6 is denied.

'use strict';

const fs = require('fs');
const path = require('path');

const ACTIVE_STATUSES = new Set(['running', 'pending']);
const ENGINES = new Set(['claude', 'opencode', 'codex']);

// Agent ids become path segments (prompt/result/request filenames) and travel
// into the --cmd string, so they must be a tight slug — no '/', '\', '..', spaces,
// or shell metacharacters. Both the worker (nested-request) and the orchestrator
// (process-nested-requests) validate against this before using an id in a path.
function isValidAgentId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id) && !id.includes('..');
}

function loadState(stateFile) {
  const raw = fs.readFileSync(stateFile, 'utf8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

// Acquire an exclusive lock by atomically creating state.lock. Polls on EEXIST,
// and reclaims a lock older than staleMs (a crashed writer must not wedge us
// forever — C4 crash-recovery is fleshed out in Phase 6, this is the minimum).
function acquireLock(dir, { timeoutMs = 2000, staleMs = 10000 } = {}) {
  const lockfile = path.join(dir, 'state.lock');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockfile, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return lockfile;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Infinity;
      try { age = Date.now() - fs.statSync(lockfile).mtimeMs; } catch { /* vanished — retry */ }
      if (age > staleMs) { try { fs.unlinkSync(lockfile); } catch { /* race: someone else took it */ } continue; }
      if (Date.now() > deadline) throw new Error(`timeout acquiring lock ${lockfile}`);
      sleepSync(50);
    }
  }
}

function releaseLock(lockfile) {
  try { fs.unlinkSync(lockfile); } catch { /* already gone */ }
}

// Busy-wait without spawning a child (this runs in short orchestrator bursts).
function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

// Read-modify-write under lock + atomic rename (tmp on same dir → rename is atomic).
// mutator(state) may return a value; that value is returned to the caller.
function withState(stateFile, mutator) {
  const dir = path.dirname(stateFile);
  const lock = acquireLock(dir);
  try {
    const state = loadState(stateFile);
    const ret = mutator(state);
    const tmp = path.join(dir, `state.json.tmp.${process.pid}`);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, stateFile);
    return ret;
  } finally {
    releaseLock(lock);
  }
}

// Flatten every agent across every wave: [{ waveIndex, agent }].
function listAgents(state) {
  const out = [];
  const waves = state.waves || [];
  for (let wi = 0; wi < waves.length; wi++) {
    for (const agent of waves[wi].agents || []) out.push({ waveIndex: wi, agent });
  }
  return out;
}

function findAgent(state, id) {
  for (const entry of listAgents(state)) {
    if (entry.agent.id === id) return entry;
  }
  return null;
}

// Agents currently holding a concurrency slot: running or pending (registered but
// not yet exited). completed/failed/exited have released their slot.
function countActive(state) {
  return listAgents(state).filter(({ agent }) => ACTIVE_STATUSES.has(agent.status)).length;
}

// Depth of an agent (see header convention). Unknown id / orchestrator → 0.
// Falls back to walking parentAgentId for legacy agents lacking a `depth` field,
// with cycle protection so a corrupt parent chain can't loop forever.
function agentDepth(state, id, _seen) {
  if (!id) return 0;
  const found = findAgent(state, id);
  if (!found) return 0; // orchestrator or unknown parent → treat as depth 0
  const a = found.agent;
  if (Number.isInteger(a.depth)) return a.depth;
  const seen = _seen || new Set();
  if (seen.has(id)) return 0; // cycle — bail
  seen.add(id);
  if (a.parentAgentId) return agentDepth(state, a.parentAgentId, seen) + 1;
  return 1; // top-level wave agent spawned directly by the orchestrator
}

// Build a child agent id that is unique within the current state.
function makeChildId(state, parentId, ordinal) {
  const taken = new Set(listAgents(state).map(({ agent }) => agent.id));
  let id = `${parentId}-c${ordinal}`;
  let n = ordinal;
  while (taken.has(id)) id = `${parentId}-c${++n}`;
  return id;
}

// Append a new wave holding the nested children; returns its wave index.
function addNestedWave(state, children) {
  if (!Array.isArray(state.waves)) state.waves = [];
  const index = state.waves.length;
  state.waves.push({
    index,
    status: 'running',
    blockedBy: [],
    nested: true,
    agents: children,
  });
  return index;
}

module.exports = {
  ACTIVE_STATUSES,
  ENGINES,
  isValidAgentId,
  loadState,
  withState,
  listAgents,
  findAgent,
  countActive,
  agentDepth,
  makeChildId,
  addNestedWave,
};
