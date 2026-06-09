#!/usr/bin/env node
// pane-spawn.js — the one place that turns "I need a worker in a pane" into a real
// wmux pane + running agent. Shared by process-nested-requests.js (fan-out: many
// children at once) and chain-router.js (continuation: one next-link at a time), so
// both press the spawn button identically — the FALLBACK design centralizes spawning
// in the orchestrator, and this centralizes HOW it spawns.
//
// Both helpers run in the orchestrator's own session, so `layout grid` auto-anchors
// to the orchestrator surface ($WMUX_SURFACE_ID) — the exact path spawn-agents.sh
// proved works. We never pass --anchor-surface (Phase 1 spike: anchoring to a
// worker surface reshapes the workspace flat and swallows the orchestrator pane).

'use strict';

const { execFileSync } = require('child_process');

// wmux --cmd runs in a shell pane; forward-slash Windows paths sidestep backslash
// escaping and are accepted by node + bash + PowerShell alike.
const fwd = (p) => String(p).replace(/\\/g, '/');

// Ask wmux for a balanced grid big enough for `workerCount` new panes PLUS the
// orchestrator's own cell, and return the new pane ids (row-major, length workerCount).
// The +1 keeps the orchestrator pane as top-left and hands back exactly the worker
// cells — same arithmetic spawn-agents.sh uses.
function allocateGrid(wmuxCli, workerCount) {
  const out = execFileSync('node', [
    wmuxCli, 'layout', 'grid', '--count', String(workerCount + 1), '--type', 'terminal',
  ], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  return Array.isArray(parsed.newPaneIds) ? parsed.newPaneIds : [];
}

// Launch one agent into an existing pane. `engine` travels inside the --cmd string
// because `wmux agent spawn` cannot pass env vars to the pane process (so the engine
// can't ride WMUX_AGENT_CMD here). Returns wmux's { agentId, surfaceId } — agentId is
// what reconcile-agents.js later matches against `wmux agent list`.
function spawnIntoPane(wmuxCli, paneId, { launcher, promptFile, engine, label, cwd }) {
  const engineArg = engine && engine !== 'claude' ? ` --engine ${engine}` : '';
  const cmd = `node "${fwd(launcher)}" "${fwd(promptFile)}"${engineArg}`;
  const out = execFileSync('node', [
    wmuxCli, 'agent', 'spawn',
    '--pane', paneId,
    '--cmd', cmd,
    '--label', label,
    '--cwd', cwd,
  ], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  return { agentId: parsed.agentId, surfaceId: parsed.surfaceId };
}

module.exports = { allocateGrid, spawnIntoPane, fwd };
