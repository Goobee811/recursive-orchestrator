#!/usr/bin/env node
// harvest-results.js — result-based completion for workers that DON'T exit their pane.
//
// Why this exists (dogfood finding 2026-06-10): a wmux agent runs inside a `-NoExit`
// pane shell. A headless codex worker finishes, writes its result, and exits — but the
// pane shell stays alive, so `wmux agent list` reports the agent 'running' forever.
// reconcile-agents.js keys on the pane reading 'exited', which never happens here; and
// force-killing the pane yields exitCode -1073741510, which reconcile would misclassify
// as 'failed' even though the worker SUCCEEDED. So pane lifecycle is the wrong completion
// signal for these workers. The right signal is the RESULT the worker produced:
//
//   * codex worker → agent-<id>-result.json (the -o schema output). status:
//        "done"|"partial" → completed (work landed; a chain handles any remainder)
//        "blocked"        → failed
//   * claude/opencode  → agent-<id>-result.md exists and is non-empty → completed
//        (the worker was told to write its result file as its last act).
//
// This is the lightweight LIFECYCLE close (free the slot, close the wave, optionally
// `agent kill` to reap the idle pane). It is NOT the deep aggregate: leader-aggregate.ps1
// (Phase 5C) still verifies the codex diff before trusting a "done" for a real handoff
// (H7). Harvest only needs the worker's self-reported terminal state to release its slot.
//
// Usage:
//   node harvest-results.js --state <state.json> [--wmux-cli <p>] [--kill]
// Output (stdout JSON): { harvested:[{id,status,from}], killed:[...], wavesClosed:[idx] }

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { withState, listAgents } = require('./nested-state');

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(name);

function resolveResultPath(orchDir, resultFile) {
  if (!resultFile) return '';
  return path.isAbsolute(resultFile) ? resultFile : path.join(orchDir, resultFile);
}

// Inspect one running agent's result artifact. Returns { status, from } when the worker
// has reported a terminal state, or null when it is still working (no/!ready result).
function classifyByResult(agent, orchDir) {
  const engine = (agent.engine || 'claude').toLowerCase();
  if (engine === 'codex') {
    // codex -o output is agent-<id>-result.json (sibling of the prompt). Prefer the
    // path the launcher derives; fall back to agent.resultFile if it points there.
    const jsonByConvention = path.join(orchDir, `agent-${agent.id}-result.json`);
    const resultFile = resolveResultPath(orchDir, agent.resultFile);
    const file = fs.existsSync(jsonByConvention) ? jsonByConvention
      : (resultFile && resultFile.endsWith('.json') ? resultFile : jsonByConvention);
    if (!fs.existsSync(file)) return null;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } // mid-write → wait
    const st = String(parsed.status || '').toLowerCase();
    if (st === 'done' || st === 'partial') return { status: 'completed', from: file };
    if (st === 'blocked') return { status: 'failed', from: file };
    return null; // unknown status → don't guess; let it keep running / be inspected
  }
  // claude / opencode: the worker writes its result file as its final act.
  const md = resolveResultPath(orchDir, agent.resultFile) || path.join(orchDir, `agent-${agent.id}-result.md`);
  if (fs.existsSync(md)) {
    try { if (fs.readFileSync(md, 'utf8').trim().length > 0) return { status: 'completed', from: md }; }
    catch { /* unreadable → wait */ }
  }
  return null;
}

// Reap a finished worker's pane. `agent kill` ends the process + flips the agent to
// 'exited', but the -NoExit pane SHELL (and its now-idle UI cell) survives it; `close-pane`
// removes the cell so the layout tree collapses back. Both are best-effort — a worker we
// already harvested off its result must not be re-opened by a failed reap.
function reapPane(wmuxCli, { wmuxAgentId, paneId }) {
  let ok = false;
  if (wmuxAgentId) { try { execFileSync('node', [wmuxCli, 'agent', 'kill', wmuxAgentId], { encoding: 'utf8' }); ok = true; } catch { /* already gone */ } }
  if (paneId) { try { execFileSync('node', [wmuxCli, 'close-pane', paneId], { encoding: 'utf8' }); ok = true; } catch { /* already closed */ } }
  return ok;
}

function main() {
  const stateFile = getFlag('--state', '');
  const wmuxCli = getFlag('--wmux-cli', process.env.WMUX_CLI || '');
  const doKill = hasFlag('--kill');
  if (!stateFile) {
    process.stderr.write('Usage: node harvest-results.js --state <state.json> [--wmux-cli p] [--kill]\n');
    process.exit(2);
  }
  const orchDir = path.dirname(stateFile);

  // Decide terminal transitions first (pure read), then apply under one lock.
  const harvested = [];
  const toKill = [];
  withState(stateFile, (state) => {
    const stamp = new Date().toISOString();
    for (const { agent } of listAgents(state)) {
      if (agent.status !== 'running') continue;
      const verdict = classifyByResult(agent, orchDir);
      if (!verdict) continue;
      agent.status = verdict.status;
      agent.exitCode = verdict.status === 'completed' ? 0 : -1;
      agent.finishedAt = stamp;
      harvested.push({ id: agent.id, status: verdict.status, from: path.basename(verdict.from) });
      if (agent.wmuxAgentId || agent.paneId) toKill.push({ wmuxAgentId: agent.wmuxAgentId || null, paneId: agent.paneId || null });
    }
    // Close any wave whose agents are now all terminal.
    for (let wi = 0; wi < (state.waves || []).length; wi++) {
      const w = state.waves[wi];
      if (w.status === 'completed') continue;
      const ags = w.agents || [];
      if (ags.length && ags.every((a) => a.status === 'completed' || a.status === 'failed')) w.status = 'completed';
    }
  });

  // Reap idle panes outside the lock (network/CLI call). Only the agents we just closed.
  const killed = [];
  if (doKill && wmuxCli) {
    for (const t of toKill) { if (reapPane(wmuxCli, t)) killed.push(t.wmuxAgentId || t.paneId); }
  }

  const wavesClosed = []; // (re-derive for report) — cheap reload
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    (s.waves || []).forEach((w, i) => { if (w.status === 'completed') wavesClosed.push(i); });
  } catch { /* ignore */ }

  process.stdout.write(JSON.stringify({ harvested, killed, wavesClosed }, null, 2) + '\n');
}

main();
