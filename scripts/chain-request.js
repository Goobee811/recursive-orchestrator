#!/usr/bin/env node
// chain-request.js — run by a WORKER that has hit its context budget (context-meter
// said "handoff") but the thread of work is not finished, OR has finished the whole
// thread. Either way the worker cannot spawn its own successor (Phase 1 FALLBACK), so
// it records intent to a file and the orchestrator (chain-router.js) acts on it.
//
// Two shapes:
//   --done false  → hand off: spawn the NEXT link to continue from this link's result.
//   --done true   → thread finished: reverse-relay the chain back to its Leader.
//
// The worker does NOT pass chainId/linkSeq/leaderAgentId — those already live on its
// own agent record in state.json (the orchestrator stamped them when it seeded/extended
// the chain). The router looks them up from --from, so they can't drift.
//
// Usage:
//   node chain-request.js --state <state.json> --from <agentId> --done <true|false>
//        [--label <t>] [--remaining <text>] [--engine claude|opencode|codex]
//        [--prev-result <file>] [--files a,b] [--exclude-files c,d] [--cwd <dir>]
// Exit: 0 = request written, 2 = bad usage / not a chain link.

'use strict';

const fs = require('fs');
const path = require('path');
const { loadState, findAgent, ENGINES, isValidAgentId } = require('./nested-state');

const MAX_LABEL = 200;
const MAX_REMAINING = 8000;

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const csv = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

function fail(msg, code = 2) {
  process.stderr.write(`chain-request: ${msg}\n`);
  process.exit(code);
}

function main() {
  const stateFile = getFlag('--state', '');
  const fromAgentId = getFlag('--from', '');
  const doneRaw = getFlag('--done', '');
  if (!stateFile || !fromAgentId || (doneRaw !== 'true' && doneRaw !== 'false')) {
    fail('Usage: node chain-request.js --state <s> --from <agentId> --done <true|false> [--label t --remaining txt --engine e --prev-result f --files a,b --cwd d]');
  }
  if (!isValidAgentId(fromAgentId)) fail(`invalid --from "${fromAgentId}" (must match [A-Za-z0-9._-], no "..")`);
  const done = doneRaw === 'true';

  let state;
  try { state = loadState(stateFile); } catch (e) { fail(`cannot read state (${e.message})`); }

  // The from-agent must exist AND be a chain link (carry a chainId), else there is
  // nothing to continue/relay — refuse rather than invent a chain.
  const found = findAgent(state, fromAgentId);
  if (!found) fail(`--from "${fromAgentId}" is not in state.json`);
  const from = found.agent;
  if (!from.chainId) fail(`--from "${fromAgentId}" is not a chain link (no chainId); seed the chain first`);

  const orchDir = path.dirname(stateFile);
  const requestFile = path.join(orchDir, `chain-request-${fromAgentId}.json`);

  // Don't clobber a request still being served (one outstanding handoff per worker).
  if (fs.existsSync(requestFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
      if (existing.status === 'pending' || existing.status === 'processing') {
        process.stdout.write(JSON.stringify({ action: 'already-requested', requestFile, status: existing.status }) + '\n');
        return;
      }
    } catch { /* corrupt/stale prior request — overwrite */ }
  }

  const request = {
    chainId: from.chainId,
    fromAgentId,
    fromLinkSeq: Number.isInteger(from.linkSeq) ? from.linkSeq : 1,
    leaderAgentId: from.leaderAgentId || null,
    depth: Number.isInteger(from.depth) ? from.depth : 1, // continuation keeps the link's depth
    cwd: getFlag('--cwd', from.cwd || process.cwd()),
    done,
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };

  if (!done) {
    // Validate the next-link spec only when actually handing off.
    const label = String(getFlag('--label', '')).trim();
    const remaining = String(getFlag('--remaining', '')).trim();
    const engine = String(getFlag('--engine', from.engine || 'claude')).toLowerCase();
    const prevResult = String(getFlag('--prev-result', from.resultFile || '')).trim();
    if (!label) fail('--label is required when --done false');
    if (!remaining) fail('--remaining is required when --done false');
    if (label.length > MAX_LABEL) fail(`--label exceeds ${MAX_LABEL} chars`);
    if (remaining.length > MAX_REMAINING) fail(`--remaining exceeds ${MAX_REMAINING} chars`);
    if (!ENGINES.has(engine)) fail(`--engine "${engine}" not in ${[...ENGINES].join('|')}`);
    if (/[\r\n]/.test(prevResult)) fail('--prev-result must not contain a newline');
    request.next = { label, remaining, engine, files: csv(getFlag('--files', '')), excludeFiles: csv(getFlag('--exclude-files', '')), prevResultFile: prevResult };
  }

  const tmp = `${requestFile}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(request, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, requestFile);
  process.stdout.write(JSON.stringify({ action: done ? 'relay-requested' : 'handoff-requested', requestFile, chainId: from.chainId, fromLinkSeq: request.fromLinkSeq }) + '\n');
}

main();
