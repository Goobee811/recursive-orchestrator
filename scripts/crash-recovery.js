#!/usr/bin/env node
// crash-recovery.js — protect a worker's progress when it has no headroom to hand off
// cleanly, and detect a worker that died without ever handing off at all.
//
// Two gaps this closes:
//   1. The 180k budget can be hit MID-unit, leaving too little context to write a clean
//      handoff. So a worker drops a progress marker after EVERY completed unit (and right
//      before it asks to hand off). The latest finished unit is therefore always on disk,
//      and a successor resumes from it instead of redoing everything.
//   2. A wmux-spawned worker gets no stop hook (the reason reconcile-agents.js exists).
//      If its pane process is killed outright, `wmux agent list` may still show it for a
//      while, or drop it with no exit record. The heartbeat check flags any 'running'
//      agent whose marker (or startedAt) has gone stale past the heartbeat window as a
//      crash, frees its slot (status 'failed', which keeps wave-close + countActive
//      semantics intact), and records where to resume from.
//
// Usage (worker, after each unit / before handoff):
//   node crash-recovery.js mark --state <s> --agent <id> [--units <n>] [--note <t>] [--result <f>]
// Usage (orchestrator monitor pass):
//   node crash-recovery.js detect --state <s> [--heartbeat-ms 600000] [--mark]
// Output (detect, stdout JSON): { stale: [{id,ageMs,unitsDone,resultFile}], marked: [...] }

'use strict';

const fs = require('fs');
const path = require('path');
const { loadState, withState, listAgents, isValidAgentId } = require('./nested-state');
const { fetchLiveAgents } = require('./reconcile-agents');

// Default heartbeat window: 10 minutes. A live worker writes a marker after each unit,
// so 10m of total silence on a 'running' agent is the crash signal. Not a user-fixed
// threshold (the 180k budget is) — override with --heartbeat-ms when a workload's units
// legitimately run longer.
const DEFAULT_HEARTBEAT_MS = 600000;

const markerFile = (orchDir, agentId) => path.join(orchDir, `progress-${agentId}.json`);

function writeMarker(orchDir, agentId, { unitsDone = 0, note = '', resultFile = null, now } = {}) {
  if (!isValidAgentId(agentId)) throw new Error(`writeMarker: invalid agentId "${agentId}"`);
  const file = markerFile(orchDir, agentId);
  const payload = {
    agentId,
    unitsDone: Number.isInteger(unitsDone) ? unitsDone : 0,
    note: String(note || ''),
    resultFile: resultFile || null,
    updatedAt: now || new Date().toISOString(),
  };
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function readMarker(orchDir, agentId) {
  try {
    return JSON.parse(fs.readFileSync(markerFile(orchDir, agentId), 'utf8'));
  } catch {
    return null; // no marker yet, or unreadable — caller falls back to startedAt
  }
}

// Pure core: which 'running' agents have gone silent past the window. `markerByAgentId`
// maps id → marker (or undefined); the caller reads them so this stays testable without
// touching disk. An agent with neither a marker nor a startedAt is NOT flagged — we only
// crash-flag agents we can prove went stale, never ones we simply can't time.
//
// `liveKeys` (optional Set of wmuxAgentId/surfaceId from `wmux agent list`) is the strong
// guard against false-crashing a worker that is merely on a long unit: an agent STILL in
// the live list is alive by definition, no matter how old its marker — only one that has
// VANISHED from the list is a crash candidate (reconcile already handles ones reported
// 'exited'). Without liveKeys the check falls back to time alone, which is weaker and
// must not drive a destructive --mark on its own.
function findStaleRunning(state, markerByAgentId, { now, heartbeatMs = DEFAULT_HEARTBEAT_MS, liveKeys = null } = {}) {
  const nowMs = now ? Date.parse(now) : Date.now();
  const stale = [];
  for (const { agent } of listAgents(state)) {
    if (agent.status !== 'running') continue; // pending has no pane yet; terminal is done
    if (liveKeys) {
      const present = (agent.wmuxAgentId && liveKeys.has(agent.wmuxAgentId)) ||
                      (agent.surfaceId && liveKeys.has(agent.surfaceId));
      if (present) continue; // still in the live list → alive (long unit), never a crash
    }
    const marker = markerByAgentId ? markerByAgentId[agent.id] : null;
    const beat = (marker && marker.updatedAt) || agent.startedAt || null;
    const beatMs = beat ? Date.parse(beat) : NaN;
    if (!Number.isFinite(beatMs)) continue; // can't time it → don't guess
    const ageMs = nowMs - beatMs;
    if (ageMs > heartbeatMs) {
      stale.push({
        id: agent.id,
        ageMs,
        unitsDone: marker ? marker.unitsDone : null,
        resultFile: (marker && marker.resultFile) || agent.resultFile || null,
        note: marker ? marker.note : null,
      });
    }
  }
  return stale;
}

// Mutate state: flag the given ids as crashed. Uses 'failed' (not a new status) so the
// dashboard's wave-complete and countActive keep working; crashReason/crashedAt are
// additive forensic fields a successor reads to resume.
function markCrashed(state, ids, { now } = {}) {
  const stamp = now || new Date().toISOString();
  const want = new Set(ids);
  const marked = [];
  for (const { agent } of listAgents(state)) {
    if (want.has(agent.id) && agent.status === 'running') {
      agent.status = 'failed';
      agent.exitCode = agent.exitCode == null ? -1 : agent.exitCode;
      agent.crashReason = 'heartbeat-stale';
      agent.crashedAt = stamp;
      agent.finishedAt = stamp;
      marked.push(agent.id);
    }
  }
  return marked;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

function runMark() {
  const stateFile = getFlag('--state', '');
  const agentId = getFlag('--agent', '');
  if (!stateFile || !agentId) { process.stderr.write('Usage: node crash-recovery.js mark --state <s> --agent <id> [--units n --note t --result f]\n'); process.exit(2); }
  if (!isValidAgentId(agentId)) { process.stderr.write(`crash-recovery: invalid --agent "${agentId}"\n`); process.exit(2); }
  const orchDir = path.dirname(stateFile);
  const file = writeMarker(orchDir, agentId, {
    unitsDone: parseInt(getFlag('--units', '0'), 10) || 0,
    note: getFlag('--note', ''),
    resultFile: getFlag('--result', null),
  });
  process.stdout.write(JSON.stringify({ marker: file }) + '\n');
}

function runDetect() {
  const stateFile = getFlag('--state', '');
  if (!stateFile) { process.stderr.write('Usage: node crash-recovery.js detect --state <s> [--wmux-cli p] [--heartbeat-ms n] [--mark]\n'); process.exit(2); }
  const orchDir = path.dirname(stateFile);
  const heartbeatMs = parseInt(getFlag('--heartbeat-ms', String(DEFAULT_HEARTBEAT_MS)), 10) || DEFAULT_HEARTBEAT_MS;
  const wmuxCli = getFlag('--wmux-cli', process.env.WMUX_CLI || '');

  const state = loadState(stateFile);
  const markerByAgentId = {};
  for (const { agent } of listAgents(state)) {
    const m = readMarker(orchDir, agent.id);
    if (m) markerByAgentId[agent.id] = m;
  }

  // Cross-check the live list so a worker on a long unit (still listed) is never crashed.
  let liveKeys = null;
  if (wmuxCli) {
    try {
      const live = fetchLiveAgents(wmuxCli);
      liveKeys = new Set();
      for (const a of live) { if (a && a.agentId) liveKeys.add(a.agentId); if (a && a.surfaceId) liveKeys.add(a.surfaceId); }
    } catch (e) {
      process.stderr.write(`crash-recovery: live cross-check unavailable (${e.message})\n`);
    }
  }

  const stale = findStaleRunning(state, markerByAgentId, { heartbeatMs, liveKeys });

  // --mark flips a 'running' agent to failed (frees its slot). Do it ONLY with a live
  // cross-check present — marking on elapsed time alone could kill a slow-but-alive
  // worker. Without --wmux-cli, report the stale set but refuse to mutate.
  let marked = [];
  let markSkipped = null;
  if (hasFlag('--mark')) {
    if (!liveKeys) markSkipped = 'refusing to --mark without a live cross-check (pass --wmux-cli)';
    else if (stale.length) marked = withState(stateFile, (s) => markCrashed(s, stale.map((x) => x.id)));
  }
  const out = { stale, marked };
  if (markSkipped) out.markSkipped = markSkipped;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'mark') return runMark();
  if (cmd === 'detect') return runDetect();
  process.stderr.write('Usage: node crash-recovery.js <mark|detect> ...\n');
  process.exit(2);
}

if (require.main === module) main();

module.exports = { writeMarker, readMarker, findStaleRunning, markCrashed, DEFAULT_HEARTBEAT_MS };
