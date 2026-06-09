#!/usr/bin/env node
// nested-guard.js — the hard ceiling on nested recursion. Run BEFORE any nested
// spawn, by BOTH sides: the worker (advisory, to avoid writing a doomed request)
// and the orchestrator (authoritative, just before it actually spawns). The
// orchestrator's re-check is the one that counts — a worker prompt can be coaxed
// into asking for more, but this program decides, so the model cannot talk its
// way past depth/concurrency limits.
//
// Two independent limits (user-set, Q4): depth <= maxDepth (default 5) and total
// live agents <= maxConcurrent (default 8). Either breach denies the whole batch.
//
// FAIL-CLOSED: if the state file can't be read, deny. A safety gate that defaults
// to "go ahead" when blind is not a gate. The worker then does the work itself.
//
// Usage:
//   node nested-guard.js --state <state.json> [--parent <agentId>] [--count N]
//                        [--max-depth 5] [--max-concurrent 8]
// Output (stdout JSON): { decision, parentAgentId, parentDepth, childDepth,
//                         maxDepth, activeCount, spawnCount, maxConcurrent, reason }
// Exit: 0 = allow, 3 = deny.

'use strict';

const { loadState, countActive, agentDepth } = require('./nested-state');

// Pure decision function — shared by the CLI, nested-request.js, and the
// orchestrator processor so all three apply identical limits (DRY).
function evaluateGuard(state, { parentAgentId = null, count = 1, maxDepth = 5, maxConcurrent = 8 } = {}) {
  const spawnCount = Math.max(1, parseInt(count, 10) || 1);

  // A NaN/invalid limit (typo'd flag, bad env) must NOT silently disable the
  // ceiling: `x > NaN` is always false, so every check would fall through to
  // allow — the opposite of the fail-closed contract. Reject unusable limits.
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    return {
      decision: 'deny', parentAgentId, parentDepth: null, childDepth: null,
      maxDepth, activeCount: null, spawnCount, maxConcurrent,
      reason: `invalid limits (maxDepth=${maxDepth}, maxConcurrent=${maxConcurrent}); fail-closed deny`,
    };
  }

  const parentDepth = agentDepth(state, parentAgentId);
  const childDepth = parentDepth + 1;
  const activeCount = countActive(state);

  if (childDepth > maxDepth) {
    return deny(`child depth ${childDepth} exceeds maxDepth ${maxDepth}`);
  }
  if (activeCount + spawnCount > maxConcurrent) {
    return deny(`spawning ${spawnCount} would push live agents to ${activeCount + spawnCount}, over maxConcurrent ${maxConcurrent}`);
  }
  return result('allow', `depth ${childDepth} <= ${maxDepth} and ${activeCount}+${spawnCount} <= ${maxConcurrent}`);

  function result(decision, reason) {
    return { decision, parentAgentId, parentDepth, childDepth, maxDepth, activeCount, spawnCount, maxConcurrent, reason };
  }
  function deny(reason) { return result('deny', reason); }
}

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function main() {
  const stateFile = getFlag('--state', '');
  if (!stateFile) {
    process.stderr.write('Usage: node nested-guard.js --state <state.json> [--parent id] [--count N] [--max-depth 5] [--max-concurrent 8]\n');
    process.exit(2);
  }
  const opts = {
    parentAgentId: getFlag('--parent', null),
    count: getFlag('--count', '1'),
    maxDepth: parseInt(getFlag('--max-depth', '5'), 10),
    maxConcurrent: parseInt(getFlag('--max-concurrent', '8'), 10),
  };

  let verdict;
  try {
    verdict = evaluateGuard(loadState(stateFile), opts);
  } catch (e) {
    // Fail-closed: blind gate denies.
    verdict = {
      decision: 'deny', parentAgentId: opts.parentAgentId, parentDepth: null, childDepth: null,
      maxDepth: opts.maxDepth, activeCount: null, spawnCount: Math.max(1, parseInt(opts.count, 10) || 1),
      maxConcurrent: opts.maxConcurrent, reason: `state unreadable (${e.message}); fail-closed deny`,
    };
  }
  process.stdout.write(JSON.stringify(verdict) + '\n');
  process.exit(verdict.decision === 'allow' ? 0 : 3);
}

if (require.main === module) main();

module.exports = { evaluateGuard };
