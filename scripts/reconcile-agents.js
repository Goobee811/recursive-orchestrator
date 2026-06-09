#!/usr/bin/env node
// reconcile-agents.js — close the lifecycle gap for wmux-spawned agents.
//
// The plugin's SubagentStop hook (on-agent-stop.sh) ONLY fires for native Agent-tool
// subagents — NOT for agents started with `wmux agent spawn`, which are independent
// OS processes the hook never sees. So a nested child stays status='running' in
// state.json forever after its pane process exits: its wave never closes and its
// concurrency slot is never released (the whole tree wedges, denying further spawns).
// This module reconciles state.json against the live `wmux agent list`: any agent we
// track as still active whose wmux record reads 'exited' is moved to completed
// (exitCode 0) or failed (nonzero), stamped finishedAt, and freed.
//
// Mapping: when the orchestrator spawns a child it records the wmux-assigned agentId
// (wmuxAgentId) and surfaceId on the state agent. We match wmuxAgentId first (exact),
// then surfaceId (children spawned before wmuxAgentId was stored). We only ever read
// ids already present in state.json, so the user's own panes are never touched.
//
// Usage:
//   node reconcile-agents.js --state <state.json> [--wmux-cli <path>]
//        [--agents-json <file>]   # inject `wmux agent list` output instead of calling it (tests)
// Output (stdout JSON): { transitions: [{id,status,exitCode}], wavesClosed: [idx], live: N }

'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { loadState, withState, listAgents, ACTIVE_STATUSES } = require('./nested-state');

// A wmux exit is "clean" only at code 0; anything else (real error, or a kill such
// as 0xC000013A / -1073741510 from `agent kill`) is a failure — same rule the
// upstream SubagentStop hook applies (on-agent-stop.sh: exitCode 0 ? completed : failed).
function classifyExit(exitCode) {
  const code = typeof exitCode === 'number' ? exitCode : null;
  return { status: code === 0 ? 'completed' : 'failed', exitCode: code };
}

// Pure core: mutate `state` so every active agent whose live record is 'exited'
// becomes terminal, then close any wave whose agents are all terminal. Returns the
// applied transitions + closed wave indices. `liveAgents` is the array from
// `wmux agent list`'s { agents: [...] }.
function reconcile(state, liveAgents, { now } = {}) {
  const stamp = now || new Date().toISOString();
  const byId = new Map();
  const bySurface = new Map();
  for (const a of liveAgents || []) {
    if (a && a.agentId) byId.set(a.agentId, a);
    if (a && a.surfaceId) bySurface.set(a.surfaceId, a);
  }

  const transitions = [];
  for (const { agent } of listAgents(state)) {
    if (!ACTIVE_STATUSES.has(agent.status)) continue; // only running/pending hold a slot
    const live = (agent.wmuxAgentId && byId.get(agent.wmuxAgentId)) ||
                 (agent.surfaceId && bySurface.get(agent.surfaceId)) || null;
    if (!live || live.status !== 'exited') continue;  // unmapped or still alive → leave it
    const { status, exitCode } = classifyExit(live.exitCode);
    agent.status = status;
    agent.exitCode = exitCode;
    agent.finishedAt = stamp;
    transitions.push({ id: agent.id, status, exitCode });
  }

  // A wave is done once every agent in it is terminal. Mirrors json-tool's
  // `wave-complete` query (completed|failed) so the dashboard agrees.
  const wavesClosed = [];
  const waves = state.waves || [];
  for (let wi = 0; wi < waves.length; wi++) {
    const w = waves[wi];
    if (w.status === 'completed') continue;
    const agents = w.agents || [];
    if (agents.length && agents.every((a) => a.status === 'completed' || a.status === 'failed')) {
      w.status = 'completed';
      wavesClosed.push(wi);
    }
  }
  return { transitions, wavesClosed };
}

// Fetch + parse `wmux agent list`. Returns the agents array (never throws on an
// empty/odd payload — an unreadable list must not wedge the monitor loop).
function fetchLiveAgents(wmuxCli) {
  const out = execFileSync('node', [wmuxCli, 'agent', 'list'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  return Array.isArray(parsed.agents) ? parsed.agents : [];
}

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function main() {
  const stateFile = getFlag('--state', '');
  const agentsJson = getFlag('--agents-json', '');
  const wmuxCli = getFlag('--wmux-cli', process.env.WMUX_CLI || '');
  if (!stateFile) {
    process.stderr.write('Usage: node reconcile-agents.js --state <state.json> [--wmux-cli p] [--agents-json file]\n');
    process.exit(2);
  }

  let liveAgents;
  try {
    if (agentsJson) {
      const payload = JSON.parse(fs.readFileSync(agentsJson, 'utf8'));
      liveAgents = Array.isArray(payload) ? payload : (payload.agents || []);
    } else {
      if (!wmuxCli) {
        process.stderr.write('reconcile-agents: --wmux-cli or $WMUX_CLI required unless --agents-json given\n');
        process.exit(2);
      }
      liveAgents = fetchLiveAgents(wmuxCli);
    }
  } catch (e) {
    process.stderr.write(`reconcile-agents: cannot obtain agent list (${e.message})\n`);
    process.exit(1);
  }

  const result = withState(stateFile, (state) => reconcile(state, liveAgents));
  process.stdout.write(JSON.stringify({ ...result, live: liveAgents.length }, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = { reconcile, fetchLiveAgents, classifyExit };
