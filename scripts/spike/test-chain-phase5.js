#!/usr/bin/env node
// test-chain-phase5.js — exercises the 180k continuation chain + reverse-relay:
// chain-request.js (worker writes handoff/relay intent) and chain-router.js
// (orchestrator spawns the next link or relays to the Leader). All CLI runs are
// --dry-run (no real panes); routing decisions are also tested through the pure
// planRoute()/applySpawnNext() so the logic is verified without a daemon.
//
// Run: node scripts/spike/test-chain-phase5.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const REQUEST = path.join(SCRIPTS, 'chain-request.js');
const ROUTER = path.join(SCRIPTS, 'chain-router.js');
const { seedChain, makeChainId, planRoute, applySpawnNext, sanitizeNext } = require(path.join(SCRIPTS, 'chain-router'));
const { loadState } = require(path.join(SCRIPTS, 'nested-state'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function runFail(args) { // run a CLI expected to exit nonzero; return exit code
  try { execFileSync('node', args, { encoding: 'utf8' }); return 0; }
  catch (e) { return e.status; }
}

function agent(id, status, extra) { return Object.assign({ id, label: id, status }, extra || {}); }
function baseState(agents) { return { id: 'orch', task: 't', status: 'running', cwd: '/tmp', waves: [{ index: 0, status: 'running', agents }] }; }
function mkOrch(name, state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `chain-${name}-`));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  return dir;
}

// ── 1. seedChain + makeChainId ──────────────────────────────────────────────
console.log('\n[1] seed + chain identity');
{
  const s = baseState([agent('w1', 'running', { depth: 1, resultFile: '/tmp/agent-w1-result.md' })]);
  const cid = seedChain(s, { agentId: 'w1', leaderAgentId: 'leader-x' });
  const a = s.waves[0].agents[0];
  check('seed stamps chainId/linkSeq/leader', a.chainId === cid && a.linkSeq === 1 && a.nextLink === null && a.leaderAgentId === 'leader-x', JSON.stringify(a));
  check('chainId is a valid slug', /^chain-[A-Za-z0-9._-]+$/.test(cid), cid);
  // two chains in one state never collide.
  const s2 = baseState([agent('x', 'running', { chainId: 'chain-x' }), agent('y', 'running')]);
  check('makeChainId avoids collision', makeChainId(s2, 'x') !== 'chain-x');
}

// ── 2. planRoute: reverse-relay vs spawn-next vs deny ───────────────────────
console.log('\n[2] planRoute decisions');
{
  const s = baseState([agent('w1', 'running', { depth: 2, chainId: 'chain-w1', linkSeq: 3, leaderAgentId: 'L', resultFile: '/tmp/r.md' })]);
  const relay = planRoute(s, { status: 'pending', fromAgentId: 'w1', done: true });
  check('done → reverse-relay w/ leader + lastResult', relay.action === 'reverse-relay' && relay.leaderAgentId === 'L' && relay.lastResultFile === '/tmp/r.md', JSON.stringify(relay));
  check('relay carries fromLinkSeq', relay.fromLinkSeq === 3);

  const next = planRoute(s, { status: 'pending', fromAgentId: 'w1', done: false });
  check('handoff → spawn-next, seq+1', next.action === 'spawn-next' && next.nextSeq === 4, JSON.stringify(next));
  check('continuation keeps depth (no +1)', next.depth === 2, `depth=${next.depth}`);

  // not a chain link → deny.
  const s2 = baseState([agent('plain', 'running', { depth: 1 })]);
  check('non-chain from → deny', planRoute(s2, { status: 'pending', fromAgentId: 'plain', done: false }).action === 'deny');
  // invalid id → deny.
  check('traversal from → deny', planRoute(s, { status: 'pending', fromAgentId: '../evil', done: false }).action === 'deny');
  // non-pending → skip.
  check('processed request → skip', planRoute(s, { status: 'processed', fromAgentId: 'w1', done: false }).action === 'skip');

  // concurrency cap: 8 active → handoff denied.
  const eight = [];
  for (let i = 0; i < 8; i++) eight.push(agent(`a${i}`, 'running', { depth: 1, chainId: i === 0 ? 'chain-a0' : undefined, linkSeq: i === 0 ? 1 : undefined }));
  const s8 = baseState(eight);
  check('at concurrency cap → deny', planRoute(s8, { status: 'pending', fromAgentId: 'a0', done: false }, { maxConcurrent: 8 }).action === 'deny');
}

// ── 3. applySpawnNext mutates state correctly ───────────────────────────────
console.log('\n[3] applySpawnNext');
{
  const s = baseState([agent('w1', 'running', { depth: 2, chainId: 'chain-w1', linkSeq: 1, leaderAgentId: 'L', resultFile: '/tmp/r1.md' })]);
  const plan = planRoute(s, { status: 'pending', fromAgentId: 'w1', done: false });
  const spec = sanitizeNext({ label: 'continue', remaining: 'finish the rest', prevResultFile: 'agent-w1-result.md' }, '/tmp', null);
  const link = applySpawnNext(s, plan, spec, '/tmp');
  check('new link registered as nested wave', s.waves.length === 2 && s.waves[1].nested === true);
  check('link2 id + seq + chainId', link.linkSeq === 2 && link.chainId === 'chain-w1' && /chain-w1-L2/.test(link.id), JSON.stringify({ id: link.id, seq: link.linkSeq }));
  check('link2 keeps depth 2 (not 3)', link.depth === 2, `depth=${link.depth}`);
  check('link2 carries leader + prevResult', link.leaderAgentId === 'L' && link.prevResultFile === 'agent-w1-result.md');
  check('from.nextLink wired to 2', s.waves[0].agents[0].nextLink === 2);
  check('link2 starts pending w/ result file', link.status === 'pending' && /agent-chain-w1-L2-result\.md$/.test(link.resultFile));
}

// ── 4. chain-request.js writer (worker side) ────────────────────────────────
console.log('\n[4] chain-request writer');
{
  const dir = mkOrch('req', baseState([agent('w1', 'running', { depth: 1, chainId: 'chain-w1', linkSeq: 1, leaderAgentId: 'L', resultFile: path.join('x', 'agent-w1-result.md') })]));
  const stateFile = path.join(dir, 'state.json');

  const out = JSON.parse(execFileSync('node', [REQUEST, '--state', stateFile, '--from', 'w1', '--done', 'false', '--label', 'cont', '--remaining', 'do the rest'], { encoding: 'utf8' }));
  check('handoff request written', out.action === 'handoff-requested' && out.chainId === 'chain-w1', JSON.stringify(out));
  const req = JSON.parse(fs.readFileSync(path.join(dir, 'chain-request-w1.json'), 'utf8'));
  check('request pending + next spec + leader from state', req.status === 'pending' && req.done === false && req.next.label === 'cont' && req.leaderAgentId === 'L', JSON.stringify(req));

  // clobber-guard: a pending request is not overwritten by a second call.
  const dup = JSON.parse(execFileSync('node', [REQUEST, '--state', stateFile, '--from', 'w1', '--done', 'false', '--label', 'other', '--remaining', 'z'], { encoding: 'utf8' }));
  check('pending request not clobbered', dup.action === 'already-requested', JSON.stringify(dup));

  // relay (done=true) needs no next spec.
  fs.rmSync(path.join(dir, 'chain-request-w1.json'));
  const relay = JSON.parse(execFileSync('node', [REQUEST, '--state', stateFile, '--from', 'w1', '--done', 'true'], { encoding: 'utf8' }));
  check('relay request written', relay.action === 'relay-requested');
  check('relay request done=true, no next', JSON.parse(fs.readFileSync(path.join(dir, 'chain-request-w1.json'), 'utf8')).done === true);
  fs.rmSync(path.join(dir, 'chain-request-w1.json')); // clear before the validation cases below

  // negative: non-chain agent rejected.
  fs.writeFileSync(stateFile, JSON.stringify(baseState([agent('plain', 'running')])));
  check('non-chain from → exit 2', runFail([REQUEST, '--state', stateFile, '--from', 'plain', '--done', 'false', '--label', 'x', '--remaining', 'y']) === 2);
  // negative: traversal id rejected.
  check('traversal from → exit 2', runFail([REQUEST, '--state', stateFile, '--from', '../evil', '--done', 'true']) === 2);
  // negative: handoff without label/remaining rejected.
  fs.writeFileSync(stateFile, JSON.stringify(baseState([agent('w1', 'running', { chainId: 'chain-w1', linkSeq: 1 })])));
  check('handoff w/o --remaining → exit 2', runFail([REQUEST, '--state', stateFile, '--from', 'w1', '--done', 'false', '--label', 'x']) === 2);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 5. router end-to-end: handoff → spawn next link (dry-run) ────────────────
console.log('\n[5] router spawn-next (dry-run)');
{
  const dir = mkOrch('route', baseState([agent('w1', 'running', { depth: 2, chainId: 'chain-w1', linkSeq: 1, leaderAgentId: 'leader-1', resultFile: path.join('x', 'agent-w1-result.md') })]));
  const stateFile = path.join(dir, 'state.json');
  // worker writes handoff intent
  execFileSync('node', [REQUEST, '--state', stateFile, '--from', 'w1', '--done', 'false', '--label', 'link2', '--remaining', 'finish parser', '--files', 'src/p.js'], { encoding: 'utf8' });
  // orchestrator routes
  const out = JSON.parse(execFileSync('node', [ROUTER, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  check('router spawned 1 next link (dry-run)', out.spawned.length === 1 && out.spawned[0].status === 'dry-run', JSON.stringify(out));

  const st = loadState(stateFile);
  const link2 = st.waves[1].agents[0];
  check('link2 appended + linkSeq 2', st.waves.length === 2 && link2.linkSeq === 2);
  check('link2 keeps depth 2 (continuation, no deepen)', link2.depth === 2, `depth=${link2.depth}`);
  check('from.nextLink set to 2', st.waves[0].agents[0].nextLink === 2);
  check('link2 prompt written', fs.existsSync(path.join(dir, `agent-${link2.id}-prompt.md`)));
  const prompt = fs.readFileSync(path.join(dir, `agent-${link2.id}-prompt.md`), 'utf8');
  check('prompt points at remaining + prev result', /finish parser/.test(prompt) && /agent-w1-result\.md/.test(prompt));
  check('request marked processed', JSON.parse(fs.readFileSync(path.join(dir, 'chain-request-w1.json'), 'utf8')).status === 'processed');
  check('chain-response written', JSON.parse(fs.readFileSync(path.join(dir, 'chain-response-w1.json'), 'utf8')).status === 'dry-run');

  // idempotency: re-run skips the processed request.
  const again = JSON.parse(execFileSync('node', [ROUTER, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  check('re-run skips processed request', again.skipped === 1 && again.spawned.length === 0, JSON.stringify(again));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 6. router end-to-end: reverse-relay (done) ──────────────────────────────
console.log('\n[6] router reverse-relay');
{
  const dir = mkOrch('relay', baseState([agent('w3', 'running', { depth: 2, chainId: 'chain-w1', linkSeq: 3, nextLink: null, leaderAgentId: 'leader-1', resultFile: path.join('x', 'agent-w3-result.md') })]));
  const stateFile = path.join(dir, 'state.json');
  execFileSync('node', [REQUEST, '--state', stateFile, '--from', 'w3', '--done', 'true'], { encoding: 'utf8' });
  const out = JSON.parse(execFileSync('node', [ROUTER, '--state', stateFile, '--dry-run'], { encoding: 'utf8' }));
  check('router relayed the chain', out.relayed.length === 1 && out.relayed[0].leaderAgentId === 'leader-1', JSON.stringify(out));

  const marker = path.join(dir, 'relay-chain-w1.json');
  check('relay marker written', fs.existsSync(marker));
  const m = JSON.parse(fs.readFileSync(marker, 'utf8'));
  check('marker → leader + last link + last result', m.leaderAgentId === 'leader-1' && m.lastLinkSeq === 3 && /agent-w3-result\.md/.test(m.lastResultFile), JSON.stringify(m));
  check('terminal link nextLink stays null', loadState(stateFile).waves[0].agents[0].nextLink === null);
  check('no new wave spawned on relay', loadState(stateFile).waves.length === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 7. router concurrency deny (authoritative) ──────────────────────────────
console.log('\n[7] router concurrency deny');
{
  const eight = [];
  for (let i = 0; i < 8; i++) eight.push(agent(`a${i}`, 'running', { depth: 1 }));
  eight[0] = agent('a0', 'running', { depth: 1, chainId: 'chain-a0', linkSeq: 1, leaderAgentId: 'L', resultFile: '/tmp/r.md' });
  const dir = mkOrch('cap', baseState(eight));
  const stateFile = path.join(dir, 'state.json');
  execFileSync('node', [REQUEST, '--state', stateFile, '--from', 'a0', '--done', 'false', '--label', 'x', '--remaining', 'y'], { encoding: 'utf8' });
  const out = JSON.parse(execFileSync('node', [ROUTER, '--state', stateFile, '--dry-run', '--max-concurrent', '8'], { encoding: 'utf8' }));
  check('over-cap handoff denied by router', out.denied.length === 1 && /maxConcurrent/.test(out.denied[0].reason), JSON.stringify(out.denied));
  check('no link spawned on deny', loadState(stateFile).waves.length === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 8. router: `layout grid` failure marks the link failed, not stuck pending (H-1) ─
console.log('\n[8] grid failure → link failed, slot freed (H-1)');
{
  const dir = mkOrch('h1', baseState([agent('w1', 'running', { depth: 2, chainId: 'chain-w1', linkSeq: 1, leaderAgentId: 'L', resultFile: '/tmp/r.md' })]));
  const stateFile = path.join(dir, 'state.json');
  const fakeCli = path.join(dir, 'fake-wmux.js');
  fs.writeFileSync(fakeCli, `const a=process.argv.slice(2);
if(a[0]==='agent'&&a[1]==='list'){process.stdout.write(JSON.stringify({agents:[]}));process.exit(0);}
if(a[0]==='layout'&&a[1]==='grid'){process.stderr.write('grid boom');process.exit(1);}
process.stdout.write('{}');process.exit(0);`);
  execFileSync('node', [REQUEST, '--state', stateFile, '--from', 'w1', '--done', 'false', '--label', 'l2', '--remaining', 'rest'], { encoding: 'utf8' });
  const out = JSON.parse(execFileSync('node', [ROUTER, '--state', stateFile, '--wmux-cli', fakeCli], { encoding: 'utf8' }));
  check('router did not throw to errored', (out.errored || []).length === 0, JSON.stringify(out.errored));
  const st = loadState(stateFile);
  const link2 = st.waves[1].agents[0];
  check('link2 marked failed (not stuck pending)', link2.status === 'failed', `status=${link2.status}`);
  check('failed link holds no slot', require(path.join(SCRIPTS, 'nested-state')).countActive(st) === 1, 'only w1 active');
  check('chain-request consumed', JSON.parse(fs.readFileSync(path.join(dir, 'chain-request-w1.json'), 'utf8')).status === 'processed');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n──────────\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
