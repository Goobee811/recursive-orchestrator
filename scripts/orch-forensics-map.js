#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function sanitizeControl(value) {
  return String(value ?? '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f\u0080-\u009f]/g, '');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function stateFiles(root, state) {
  if (state) return [path.resolve(root || process.cwd(), state)];
  const base = path.resolve(root || process.cwd(), '.orch-run');
  const files = [];
  const rootState = path.join(base, 'state.json');
  if (fs.existsSync(rootState)) files.push(rootState);
  if (!fs.existsSync(base)) return files;
  for (const name of fs.readdirSync(base)) {
    const file = path.join(base, name, 'state.json');
    if (fs.existsSync(file)) files.push(file);
  }
  return files;
}

function forensicsPath(agent, orchDir) {
  if ((agent.engine || '').toLowerCase() !== 'codex') {
    return agent.resultFile ? path.resolve(orchDir, agent.resultFile) : null;
  }
  const exact = path.join(orchDir, `agent-${agent.id}-out.jsonl`);
  return exact;
}

function addAgent(map, key, entry) {
  if (!key) return;
  const rows = map.get(key) || [];
  rows.push(entry);
  map.set(key, rows);
}

function buildLookup(options = {}) {
  const root = options.root || process.cwd();
  const byAgent = new Map();
  const byPane = new Map();
  const states = [];
  for (const statePath of stateFiles(root, options.state)) {
    let state;
    try { state = readJson(statePath); } catch { continue; }
    const orchDir = path.dirname(statePath);
    const mtime = fs.statSync(statePath).mtimeMs;
    states.push(statePath);
    for (const wave of state.waves || []) {
      for (const agent of wave.agents || []) {
        const entry = {
          agentId: agent.id,
          paneId: agent.paneId,
          surfaceId: agent.surfaceId,
          engine: (agent.engine || 'claude').toLowerCase(),
          orchDir,
          statePath,
          mtime,
          forensicsPath: forensicsPath(agent, orchDir),
          claudeSessionId: agent.claudeSessionId || '',
        };
        addAgent(byAgent, entry.agentId, entry);
        if (entry.paneId) byPane.set(entry.paneId, entry);
      }
    }
  }
  return { byAgent, byPane, states };
}

function knownAgents(lookup) {
  return Array.from(lookup.byAgent.keys()).sort();
}

function resolveTarget(idOrPane, options = {}) {
  const lookup = buildLookup(options);
  const paneHit = lookup.byPane.get(idOrPane);
  if (paneHit) return { entry: paneHit, lookup };

  const rows = lookup.byAgent.get(idOrPane) || [];
  if (rows.length === 1) return { entry: rows[0], lookup };
  if (rows.length > 1) {
    const ordered = rows.slice().sort((a, b) => b.mtime - a.mtime);
    if (options.strict) {
      const err = new Error(
        `agentId '${idOrPane}' exists in ${rows.length} runs; specify --state:\n` +
        ordered.map((x) => `  ${x.statePath}`).join('\n')
      );
      err.code = 'AMBIGUOUS_TARGET';
      err.candidates = ordered;
      err.lookup = lookup;
      throw err;
    }
    return {
      entry: ordered[0],
      lookup,
      warning: `warning: agentId '${idOrPane}' found in ${rows.length} runs; selected newest ${ordered[0].statePath}`,
    };
  }

  const err = new Error(`Unknown target '${idOrPane}'`);
  err.code = 'UNKNOWN_TARGET';
  err.knownAgents = knownAgents(lookup);
  err.lookup = lookup;
  throw err;
}

module.exports = { buildLookup, resolveTarget, forensicsPath, sanitizeControl };
