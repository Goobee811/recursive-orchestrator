#!/usr/bin/env node
// test-nested-phase4.js — exercises the Phase 4 nested-recursion delta against real
// state.json fixtures (no mocks): the guard's depth/concurrent ceilings, the
// worker request writer, and the orchestrator processor in --dry-run (so no real
// panes are created). The e2e wmux spawn is a separate manual run.
//
// Run: node scripts/spike/test-nested-phase4.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const GUARD = path.join(SCRIPTS, 'nested-guard.js');
const REQUEST = path.join(SCRIPTS, 'nested-request.js');
const PROCESS = path.join(SCRIPTS, 'process-nested-requests.js');
const FAKE_WMUX = path.join(__dirname, 'fake-wmux-cli.js');
const { evaluateGuard } = require(path.join(SCRIPTS, 'nested-guard'));
const { loadState } = require(path.join(SCRIPTS, 'nested-state'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function mkOrch(name, state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nested-test-${name}-`));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  return dir;
}
function agent(id, status, extra) { return Object.assign({ id, label: id, status }, extra || {}); }
function baseState(agents) { return { id: 'orch-test', task: 't', status: 'running', cwd: '/tmp', waves: [{ index: 0, status: 'running', agents }] }; }

// ── 1. Guard: depth ceiling ─────────────────────────────────────────────────
console.log('\n[1] guard depth/concurrent ceilings');
{
  // parent is a top-level wave agent (no depth field, no parent) → depth 1.
  const s = baseState([agent('agent-a', 'running')]);
  const v = evaluateGuard(s, { parentAgentId: 'agent-a', count: 2 });
  check('depth 2 (parent depth 1) allowed', v.decision === 'allow' && v.childDepth === 2, JSON.stringify(v));

  // parent explicitly at depth 5 → child depth 6 > maxDepth 5 → deny.
  const s5 = baseState([agent('deep', 'running', { depth: 5 })]);
  const v5 = evaluateGuard(s5, { parentAgentId: 'deep', count: 1 });
  check('depth 6 denied', v5.decision === 'deny' && /depth/.test(v5.reason), JSON.stringify(v5));

  // depth 5 itself is allowed (boundary): parent depth 4 → child 5.
  const s4 = baseState([agent('d4', 'running', { depth: 4 })]);
  const v4 = evaluateGuard(s4, { parentAgentId: 'd4', count: 1 });
  check('depth 5 allowed (boundary)', v4.decision === 'allow' && v4.childDepth === 5, JSON.stringify(v4));

  // orchestrator as parent (null) → child depth 1.
  const v0 = evaluateGuard(s, { parentAgentId: null, count: 1 });
  check('orchestrator parent → child depth 1', v0.decision === 'allow' && v0.childDepth === 1, JSON.stringify(v0));
}

// ── 2. Guard: concurrent ceiling ────────────────────────────────────────────
console.log('\n[2] concurrent ceiling (max 8)');
{
  const eight = [];
  for (let i = 0; i < 8; i++) eight.push(agent(`a${i}`, 'running', { depth: 1 }));
  const s = baseState(eight);
  const v = evaluateGuard(s, { parentAgentId: 'a0', count: 1 });
  check('8 active + 1 → denied', v.decision === 'deny' && /maxConcurrent/.test(v.reason), JSON.stringify(v));

  // 6 active, request 2 → exactly 8 → allowed (boundary).
  const six = [];
  for (let i = 0; i < 6; i++) six.push(agent(`b${i}`, 'running', { depth: 1 }));
  const s6 = baseState(six);
  const v6 = evaluateGuard(s6, { parentAgentId: 'b0', count: 2 });
  check('6 active + 2 = 8 → allowed (boundary)', v6.decision === 'allow', JSON.stringify(v6));

  // completed/failed agents don't hold a slot.
  const mixed = baseState([agent('x', 'completed', { depth: 1 }), agent('y', 'failed', { depth: 1 }), agent('z', 'running', { depth: 1 })]);
  const vm = evaluateGuard(mixed, { parentAgentId: 'z', count: 1 });
  check('completed/failed not counted active', vm.activeCount === 1, `activeCount=${vm.activeCount}`);
}

// ── 3. Guard CLI fail-closed on missing state ───────────────────────────────
console.log('\n[3] guard CLI fail-closed');
{
  let code = 0, out = '';
  try { out = execFileSync('node', [GUARD, '--state', path.join(os.tmpdir(), 'does-not-exist-xyz.json'), '--parent', 'p'], { encoding: 'utf8' }); }
  catch (e) { code = e.status; out = (e.stdout || '').toString(); }
  const v = JSON.parse(out);
  check('missing state → exit 3 + deny', code === 3 && v.decision === 'deny', `code=${code} ${out.trim()}`);
}

// ── 4. request → process (dry-run) end-to-end ───────────────────────────────
console.log('\n[4] request → process (dry-run) registers tree');
{
  const dir = mkOrch('e2e', baseState([agent('w1', 'running')]));
  const stateFile = path.join(dir, 'state.json');
  const tasksFile = path.join(dir, 'tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify([
    { label: 'child one', subtask: 'do x' },
    { label: 'child two', subtask: 'do y', engine: 'codex', files: ['src/y.js'], excludeFiles: ['src/x.js'] },
  ]));

  // worker writes intent
  const reqOut = JSON.parse(execFileSync('node', [REQUEST, '--state', stateFile, '--parent', 'w1', '--tasks', tasksFile, '--cwd', '/tmp/work'], { encoding: 'utf8' }));
  check('request allowed + written', reqOut.action === 'requested' && reqOut.count === 2, JSON.stringify(reqOut));
  const reqFile = path.join(dir, 'nested-request-w1.json');
  check('request file pending', fs.existsSync(reqFile) && JSON.parse(fs.readFileSync(reqFile, 'utf8')).status === 'pending');

  // orchestrator processes (dry-run, no real panes)
  const procOut = JSON.parse(execFileSync('node', [PROCESS, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  check('processed 1 request', procOut.processed.length === 1 && procOut.processed[0].status === 'dry-run', JSON.stringify(procOut.processed));

  const st = loadState(stateFile);
  check('nested wave appended', st.waves.length === 2 && st.waves[1].nested === true);
  const kids = st.waves[1].agents;
  check('2 children registered', kids.length === 2 && kids[0].id === 'w1-c1' && kids[1].id === 'w1-c2', JSON.stringify(kids.map((k) => k.id)));
  check('children carry parent + depth', kids.every((k) => k.parentAgentId === 'w1' && k.depth === 2), JSON.stringify(kids.map((k) => [k.parentAgentId, k.depth])));
  check('codex engine preserved', kids[1].engine === 'codex' && kids[1].files[0] === 'src/y.js');
  check('children carry tier (claude→leader, codex→worker)', kids[0].tier === 'leader' && kids[1].tier === 'worker', JSON.stringify(kids.map((k) => [k.engine, k.tier])));
  check('prompt files written', fs.existsSync(path.join(dir, 'agent-w1-c1-prompt.md')) && fs.existsSync(path.join(dir, 'agent-w1-c2-prompt.md')));

  const resp = JSON.parse(fs.readFileSync(path.join(dir, 'nested-response-w1.json'), 'utf8'));
  check('response dry-run + 2 children', resp.status === 'dry-run' && resp.children.length === 2, JSON.stringify(resp.status));
  check('request marked processed', JSON.parse(fs.readFileSync(reqFile, 'utf8')).status === 'processed');

  // idempotency: re-run skips the already-processed request
  const again = JSON.parse(execFileSync('node', [PROCESS, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  check('re-run skips processed', again.skipped === 1 && again.processed.length === 0, JSON.stringify(again));

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 4b. Batch id allocation skips existing and same-batch ids ───────────────
console.log('\n[4b] request → process (dry-run) dedupes child ids within batch');
{
  const dir = mkOrch('batch-dedupe', baseState([
    agent('orch-root', 'running', { depth: 1 }),
    agent('orch-root-c1', 'completed', { depth: 2 }),
    agent('orch-root-c2', 'completed', { depth: 2 }),
    agent('orch-root-c3', 'completed', { depth: 2 }),
  ]));
  const stateFile = path.join(dir, 'state.json');
  const tasksFile = path.join(dir, 'tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify([
    { label: 'child four', subtask: 'do 4' },
    { label: 'child five', subtask: 'do 5' },
    { label: 'child six', subtask: 'do 6' },
  ]));

  execFileSync('node', [REQUEST, '--state', stateFile, '--parent', 'orch-root', '--tasks', tasksFile, '--cwd', '/tmp/work'], { encoding: 'utf8' });
  const procOut = JSON.parse(execFileSync('node', [PROCESS, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  check('processed batch request', procOut.processed.length === 1 && procOut.processed[0].status === 'dry-run', JSON.stringify(procOut.processed));

  const kids = loadState(stateFile).waves[1].agents;
  const ids = kids.map((k) => k.id);
  check('3 child ids are distinct c4/c5/c6', ids.join(',') === 'orch-root-c4,orch-root-c5,orch-root-c6' && new Set(ids).size === 3, JSON.stringify(ids));

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 5. process denies an over-limit request (authoritative re-check) ────────
console.log('\n[5] processor authoritative deny');
{
  const dir = mkOrch('deny', baseState([agent('deep', 'running', { depth: 5 })]));
  const stateFile = path.join(dir, 'state.json');
  // hand-write a request that bypassed the worker guard (depth 6)
  fs.writeFileSync(path.join(dir, 'nested-request-deep.json'), JSON.stringify({
    parentAgentId: 'deep', parentDepth: 5, childDepth: 6, cwd: '/tmp', status: 'pending',
    subTasks: [{ label: 'too deep', subtask: 'nope', files: [], excludeFiles: [], engine: 'claude' }],
  }));
  const out = JSON.parse(execFileSync('node', [PROCESS, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  check('over-depth request denied by processor', out.denied.length === 1 && /depth/.test(out.denied[0].reason), JSON.stringify(out.denied));
  const st = loadState(stateFile);
  check('no children registered on deny', st.waves.length === 1, `waves=${st.waves.length}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 5b. split layout without a source must not silently fall back to grid ───
console.log('\n[5b] split layout requires source pane');
{
  const dir = mkOrch('split-no-source', baseState([agent('w1', 'running', { depth: 1 })]));
  const stateFile = path.join(dir, 'state.json');
  const logFile = path.join(dir, 'wmux.log');
  fs.writeFileSync(path.join(dir, 'nested-request-w1.json'), JSON.stringify({
    parentAgentId: 'w1', status: 'pending', cwd: '/tmp/work',
    subTasks: [
      { label: 'child one', subtask: 'do x', files: [], excludeFiles: [], engine: 'claude' },
      { label: 'child two', subtask: 'do y', files: [], excludeFiles: [], engine: 'codex' },
    ],
  }));

  const out = JSON.parse(execFileSync('node', [PROCESS, '--state', stateFile, '--wmux-cli', FAKE_WMUX, '--layout', 'split'], {
    encoding: 'utf8',
    env: { ...process.env, FAKE_WMUX_LOG: logFile },
  }));
  const children = out.processed[0] && out.processed[0].children ? out.processed[0].children : [];
  const error = 'no source pane for split layout; pass --root-pane or use --layout grid';
  check('split without source marks children failed', children.length === 2 && children.every((c) => c.error === error), JSON.stringify(children));
  const kids = loadState(stateFile).waves[1].agents;
  check('split without source updates state failed', kids.every((k) => k.status === 'failed' && k.exitCode === -1), JSON.stringify(kids.map((k) => [k.id, k.status, k.exitCode])));
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  check('split without source does not call allocateGrid', !/layout-grid/.test(log), log.trim());

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 6. Hardening (review fixes C1/C2/H1/H2) ─────────────────────────────────
console.log('\n[6] hardening: invalid limits, traversal, engine, empty');
{
  const s = baseState([agent('a', 'running')]);
  // C1: NaN limits must fail-closed, not fall through to allow.
  check('C1 maxDepth=NaN → deny', evaluateGuard(s, { parentAgentId: 'a', maxDepth: NaN }).decision === 'deny');
  check('C1 maxConcurrent=NaN → deny', evaluateGuard(s, { parentAgentId: 'a', maxConcurrent: NaN }).decision === 'deny');
  check('C1 maxDepth=0 → deny', evaluateGuard(s, { parentAgentId: 'a', maxDepth: 0 }).decision === 'deny');

  // C1 via CLI: a non-numeric flag must not silently disable the ceiling.
  const dir = mkOrch('hard', s);
  const stateFile = path.join(dir, 'state.json');
  let code = 0;
  try { execFileSync('node', [GUARD, '--state', stateFile, '--parent', 'a', '--max-depth', 'five'], { encoding: 'utf8' }); }
  catch (e) { code = e.status; }
  check('C1 CLI --max-depth five → exit 3 (deny)', code === 3, `code=${code}`);

  // C2: traversal in --parent rejected by the worker writer.
  let rcode = 0;
  const tasksFile = path.join(dir, 't.json');
  fs.writeFileSync(tasksFile, JSON.stringify([{ label: 'x', subtask: 'y' }]));
  try { execFileSync('node', [REQUEST, '--state', stateFile, '--parent', '../../evil', '--tasks', tasksFile], { encoding: 'utf8' }); }
  catch (e) { rcode = e.status; }
  check('C2 --parent traversal → exit 2', rcode === 2, `code=${rcode}`);

  // C2: traversal in a hand-written request file rejected by the processor;
  // no file escapes orchDir, no wave registered.
  fs.writeFileSync(path.join(dir, 'nested-request-evil.json'), JSON.stringify({
    parentAgentId: '../../evil', status: 'pending', subTasks: [{ label: 'x', subtask: 'y' }],
  }));
  const before = fs.existsSync(path.join(dir, '..', 'evil.json')) || fs.existsSync(path.join(dir, '..', 'evil'));
  const pout = JSON.parse(execFileSync('node', [PROCESS, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  const after = fs.existsSync(path.join(dir, '..', 'evil.json')) || fs.existsSync(path.join(dir, '..', 'evil'));
  check('C2 processor denies traversal parentId', pout.denied.some((d) => /invalid parentAgentId/.test(d.reason)), JSON.stringify(pout.denied));
  check('C2 no file escaped orchDir', before === after && after === false);
  check('C2 no wave registered on traversal', loadState(stateFile).waves.length === 1);

  // H2: empty subTasks denied, no empty wave.
  fs.writeFileSync(path.join(dir, 'nested-request-a.json'), JSON.stringify({
    parentAgentId: 'a', status: 'pending', subTasks: [],
  }));
  const h2 = JSON.parse(execFileSync('node', [PROCESS, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  check('H2 empty subTasks denied', h2.denied.some((d) => /empty/.test(d.reason)), JSON.stringify(h2.denied));
  check('H2 no empty wave created', loadState(stateFile).waves.length === 1);

  // H1: a shell-metachar engine from the request file is normalized to claude.
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(baseState([agent('h', 'running')]), null, 2));
  fs.writeFileSync(path.join(dir, 'nested-request-h.json'), JSON.stringify({
    parentAgentId: 'h', status: 'pending', subTasks: [{ label: 'k', subtask: 'm', engine: 'codex; rm -rf /' }],
  }));
  execFileSync('node', [PROCESS, '--state', stateFile, '--dry-run'], { encoding: 'utf8' });
  const injected = loadState(stateFile).waves[1].agents[0].engine;
  check('H1 malicious engine normalized to claude', injected === 'claude', `engine=${injected}`);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n──────────\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
