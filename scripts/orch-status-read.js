#!/usr/bin/env node
// orch-status-read.js — turns an (untrusted) state.json path into a summary "run":
// the assignment rows orch-status.js prints. Every schema field is optional (25 waves
// carry 7 record variants), ids/result paths are validated + scope-checked before any
// forensics file is stat'd, and a corrupt state degrades to one "unreadable" run.

'use strict';

const fs = require('fs');
const path = require('path');
const { isValidAgentId } = require('./nested-state');
const { safeWithin } = require('./orch-status-tail');

const STALL_MS = 5 * 60 * 1000;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
function trunc(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function kb(n) { return n < 1024 ? `${n}B` : `${Math.round(n / 1024)}KB`; }
function clock(ms) { if (!ms) return '--:--:--'; const d = new Date(ms); return isNaN(d.getTime()) ? '--:--:--' : d.toISOString().slice(11, 19); }
function isoClock(s) { if (!s) return '--:--:--'; const d = new Date(s); return isNaN(d.getTime()) ? '--:--:--' : d.toISOString().slice(11, 19); }

// A repo's state.json files: the root-level one (orch-forensics-map supports it) plus
// each wave dir's. Mirrors that module's non-exported stateFiles().
function orchStateFiles(repoRoot) {
  const base = path.join(repoRoot, '.orch-run');
  const out = [];
  if (!fs.existsSync(base)) return out;
  const root = path.join(base, 'state.json');
  if (fs.existsSync(root)) out.push(root);
  let names = [];
  try { names = fs.readdirSync(base); } catch { return out; }
  for (const n of names) {
    const f = path.join(base, n, 'state.json');
    try { if (fs.statSync(path.join(base, n)).isDirectory() && fs.existsSync(f)) out.push(f); } catch { /* skip */ }
  }
  return out;
}
function maxMtime(files) { let m = 0; for (const f of files) { try { m = Math.max(m, fs.statSync(f).mtimeMs); } catch { /* skip */ } } return m; }

// tier from state when present; otherwise inferred (marked ~): a chain link is a worker
// continuation regardless of engine; else claude→leader, codex|opencode→worker.
function tierOf(a) {
  if (a.tier === 'leader' || a.tier === 'worker') return a.tier;
  if (a.chainId) return '~worker';
  return (a.engine || 'claude').toLowerCase() === 'claude' ? '~leader' : '~worker';
}

// "orchestrator is about to assign more": pending nested/chain intent files in orchDir.
function countPending(orchDir) {
  let n = 0, names = [];
  try { names = fs.readdirSync(orchDir); } catch { return 0; }
  for (const f of names) {
    if (!/^(nested-request|chain-request)-.+\.json$/.test(f)) continue;
    try { if (readJson(path.join(orchDir, f)).status === 'pending') n++; } catch { /* ignore */ }
  }
  return n;
}

function rowOf(a, orchDir, now) {
  const id = a.id;
  const engine = (a.engine || 'claude').toLowerCase();
  const safeId = isValidAgentId(id);
  let outBytes = null, outMtime = null, hasResult = false, resultStatus = null, unsafe = !safeId;
  if (safeId && engine === 'codex') {
    try { const s = fs.statSync(path.join(path.resolve(orchDir), `agent-${id}-out.jsonl`)); outBytes = s.size; outMtime = s.mtimeMs; } catch { /* none */ }
  }
  for (const rel of [a.resultFile, safeId ? `agent-${id}-result.json` : null, safeId ? `agent-${id}-result.md` : null]) {
    if (!rel) continue;
    const p = safeWithin(orchDir, rel);
    if (!p) { if (rel === a.resultFile) unsafe = true; continue; }
    try { if (fs.existsSync(p)) { hasResult = true; if (p.endsWith('.json') && !resultStatus) { try { resultStatus = readJson(p).status || '?'; } catch { /* not json */ } } } } catch { /* skip */ }
  }
  const status = a.status || '-';
  const running = status === 'running' || status === 'pending';
  const flags = [];
  if (hasResult && running) flags.push('done-unharvested');
  else if (running && !hasResult && outMtime && now - outMtime > STALL_MS) flags.push('⚠ stalled?');
  else if (running && !hasResult && outBytes == null) flags.push('⚠ no-output');
  if (a.crashReason) flags.push(`crash:${trunc(a.crashReason, 40)}`);
  if (unsafe) flags.push('⚠ unsafe path skipped');
  return { id, label: a.label || null, engine, tier: tierOf(a), status, flags, depth: a.depth,
    startedAt: a.startedAt || null, finishedAt: a.finishedAt || null, outBytes, outMtime,
    resultStatus, sid: (a.claudeSessionId || '').slice(0, 8) };
}

function readRun(statePath, now) {
  const orchDir = path.dirname(statePath);
  const base = path.basename(orchDir);
  const run = { statePath, name: base === '.orch-run' ? '(root)' : base, orchDir, ok: true, agents: [], intentPending: 0, mtime: 0 };
  try { run.mtime = fs.statSync(statePath).mtimeMs; } catch { /* none */ }
  let state;
  try { state = readJson(statePath); } catch (e) { run.ok = false; run.error = e.message; return run; }
  run.intentPending = countPending(orchDir);
  for (const wave of state.waves || []) {
    for (const a of (wave.agents || [])) {
      try { run.agents.push(rowOf(a || {}, orchDir, now)); }
      catch (e) { run.agents.push({ id: (a && a.id) || '?', error: e.message, flags: [] }); }
    }
  }
  return run;
}

module.exports = { readJson, trunc, kb, clock, isoClock, orchStateFiles, maxMtime, tierOf, countPending, rowOf, readRun };
