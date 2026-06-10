#!/usr/bin/env node
// spawn-by-split.js — spawn one already-registered agent into a NEW pane created by a
// directional split, honoring the orchestration layout convention:
//
//   * a child worker (one level deeper than its spawner) → VERTICAL split  (`wmux split`,
//     direction 'right'): the child pane sits to the RIGHT of its parent. Depth grows
//     left→right.
//   * sibling workers running in parallel (same level)   → HORIZONTAL split (`wmux split
//     --down`, direction 'down'): siblings stack top→bottom under their shared parent.
//
// This is the directional alternative to pane-spawn.js's `allocateGrid` (balanced grid):
// it reuses the SAME spawnIntoPane (so the launch/--cmd/safe-wrapper path is identical),
// but allocates the pane with a split instead of a grid, so the visible tree mirrors the
// orchestration tree.
//
// `wmux split` acts on the FOCUSED pane (no --pane arg), so we focus --source-pane first
// to make the split deterministic. Single-actor orchestrator → no focus race in practice.
//
// Usage:
//   node spawn-by-split.js --state <state.json> --agent <id> --wmux-cli <path>
//        [--source-pane <paneId>]        # focus this pane before splitting (the parent)
//        [--split vertical|horizontal]   # vertical=child (default), horizontal=sibling
//        [--prompt <file>]               # default: <orchDir>/agent-<id>-prompt.md
//        [--launcher <path>] [--safe-wrapper <path>] [--cwd <dir>]
// Output (stdout JSON): { agent, paneId, surfaceId, wmuxAgentId, split }

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadState, withState, findAgent, isValidAgentId } = require('./nested-state');
const { allocateSplit, closeSurfaceQuiet, spawnIntoPane } = require('./pane-spawn');

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function main() {
  const stateFile = getFlag('--state', '');
  const agentId = getFlag('--agent', '');
  const wmuxCli = getFlag('--wmux-cli', process.env.WMUX_CLI || '');
  const sourcePane = getFlag('--source-pane', process.env.WMUX_PANE_ID || '');
  const splitMode = (getFlag('--split', 'vertical') || 'vertical').toLowerCase();
  const launcher = getFlag('--launcher', path.join(__dirname, 'launch-agent-ext.js'));
  const safeWrapper = getFlag('--safe-wrapper', process.env.WMUX_SAFE_WRAPPER || '');

  if (!stateFile || !agentId || !wmuxCli) {
    process.stderr.write('Usage: node spawn-by-split.js --state <s> --agent <id> --wmux-cli <p> [--source-pane id] [--split vertical|horizontal] [--prompt f] [--launcher p] [--safe-wrapper p] [--cwd d]\n');
    process.exit(2);
  }
  if (!isValidAgentId(agentId)) { process.stderr.write(`spawn-by-split: invalid --agent "${agentId}"\n`); process.exit(2); }

  const orchDir = path.dirname(stateFile);
  const state = loadState(stateFile);
  const found = findAgent(state, agentId);
  if (!found) { process.stderr.write(`spawn-by-split: agent "${agentId}" not in state\n`); process.exit(1); }
  const agent = found.agent;
  if (agent.status !== 'pending') { process.stderr.write(`spawn-by-split: agent "${agentId}" is ${agent.status}, expected pending\n`); process.exit(1); }

  const promptFile = getFlag('--prompt', path.join(orchDir, `agent-${agentId}-prompt.md`));
  if (!fs.existsSync(promptFile)) { process.stderr.write(`spawn-by-split: prompt file not found: ${promptFile}\n`); process.exit(1); }
  const cwd = getFlag('--cwd', agent.cwd || process.cwd());
  const engine = String(agent.engine || 'claude').toLowerCase();
  const label = agent.label || agentId;
  const claudeSessionId = engine === 'claude' ? crypto.randomUUID() : '';

  // 1. Allocate the pane with the directional split.
  const horizontal = splitMode === 'horizontal' || splitMode === 'sibling';
  const { paneId, defaultSurfaceId } = allocateSplit(wmuxCli, sourcePane, horizontal ? 'horizontal' : 'vertical');

  // 2. Spawn into it through the SAME path process-nested/chain-router use.
  let spawnRes;
  try {
    spawnRes = spawnIntoPane(wmuxCli, paneId, {
      launcher, promptFile, engine, label, cwd,
      safeWrapper, stateFile, agentId, sessionId: claudeSessionId,
    });
  } catch (e) {
    withState(stateFile, (s) => { const f = findAgent(s, agentId); if (f) { f.agent.status = 'failed'; f.agent.exitCode = -1; } });
    process.stderr.write(`spawn-by-split: spawn failed (${e.message})\n`);
    process.exit(1);
  }
  closeSurfaceQuiet(wmuxCli, defaultSurfaceId);

  // 3. Reflect the running worker into state (same fields reconcile keys on).
  const now = new Date().toISOString();
  withState(stateFile, (s) => {
    const f = findAgent(s, agentId);
    if (f) {
      f.agent.paneId = paneId;
      f.agent.surfaceId = spawnRes.surfaceId;
      f.agent.wmuxAgentId = spawnRes.agentId;
      if (claudeSessionId) f.agent.claudeSessionId = claudeSessionId;
      f.agent.status = 'running';
      f.agent.startedAt = now;
    }
  });

  process.stdout.write(JSON.stringify({
    agent: agentId, paneId, surfaceId: spawnRes.surfaceId, wmuxAgentId: spawnRes.agentId,
    split: horizontal ? 'horizontal' : 'vertical',
  }, null, 2) + '\n');
}

main();
