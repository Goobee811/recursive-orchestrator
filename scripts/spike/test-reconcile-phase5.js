#!/usr/bin/env node
// test-reconcile-phase5.js — exercises the lifecycle reconcile (the H3 fix): a wmux
// agent that exits leaves no SubagentStop hook, so state.json keeps it 'running'
// forever unless we poll `wmux agent list`. These tests feed real-format agent-list
// payloads (the exact shape verified live: agentId/surfaceId/status/exitCode) into
// the pure reconcile() and the CLI via --agents-json — no daemon, no mocks.
//
// Run: node scripts/spike/test-reconcile-phase5.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const RECONCILE = path.join(SCRIPTS, 'reconcile-agents.js');
const { reconcile, classifyExit } = require(path.join(SCRIPTS, 'reconcile-agents'));
const { loadState, countActive } = require(path.join(SCRIPTS, 'nested-state'));
const { evaluateGuard } = require(path.join(SCRIPTS, 'nested-guard'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

// A live `wmux agent list` entry (real shape).
function live(agentId, surfaceId, status, exitCode) {
  const e = { agentId, surfaceId, paneId: 'pane-x', workspaceId: 'ws-x', label: agentId, cmd: 'node x', status, spawnTime: 1 };
  if (exitCode !== undefined) e.exitCode = exitCode;
  return e;
}
function agent(id, status, extra) { return Object.assign({ id, label: id, status }, extra || {}); }
function baseState(agents, nested) {
  return { id: 'orch', task: 't', status: 'running', cwd: '/tmp', waves: [{ index: 0, status: 'running', nested: !!nested, agents }] };
}

// ── 1. exit-code classification ─────────────────────────────────────────────
console.log('\n[1] exit-code classification');
{
  check('exit 0 → completed', classifyExit(0).status === 'completed');
  check('exit 1 → failed', classifyExit(1).status === 'failed');
  check('kill code -1073741510 → failed', classifyExit(-1073741510).status === 'failed');
  check('missing exitCode → failed + null', classifyExit(undefined).status === 'failed' && classifyExit(undefined).exitCode === null);
}

// ── 2. running child whose pane exited → terminal + stamped ─────────────────
console.log('\n[2] running → terminal on exit');
{
  const s = baseState([agent('w1-c1', 'running', { wmuxAgentId: 'agent-aaa', surfaceId: 'surf-aaa' })], true);
  const r = reconcile(s, [live('agent-aaa', 'surf-aaa', 'exited', 0)], { now: '2026-01-01T00:00:00Z' });
  const a = s.waves[0].agents[0];
  check('exited(0) → completed', a.status === 'completed' && a.exitCode === 0, JSON.stringify(a));
  check('finishedAt stamped', a.finishedAt === '2026-01-01T00:00:00Z');
  check('transition reported', r.transitions.length === 1 && r.transitions[0].status === 'completed');

  const s2 = baseState([agent('w1-c1', 'running', { wmuxAgentId: 'agent-bbb', surfaceId: 'surf-bbb' })], true);
  reconcile(s2, [live('agent-bbb', 'surf-bbb', 'exited', 1)]);
  check('exited(1) → failed', s2.waves[0].agents[0].status === 'failed');
}

// ── 3. mapping precedence: wmuxAgentId first, surfaceId fallback ─────────────
console.log('\n[3] mapping precedence');
{
  // wmuxAgentId matches even when surfaceId would not.
  const s = baseState([agent('c', 'running', { wmuxAgentId: 'agent-id1', surfaceId: 'surf-stale' })], true);
  reconcile(s, [live('agent-id1', 'surf-different', 'exited', 0)]);
  check('matched by wmuxAgentId', s.waves[0].agents[0].status === 'completed');

  // legacy child without wmuxAgentId → matched by surfaceId.
  const s2 = baseState([agent('c', 'running', { surfaceId: 'surf-legacy' })], true);
  reconcile(s2, [live('agent-zzz', 'surf-legacy', 'exited', 0)]);
  check('matched by surfaceId fallback', s2.waves[0].agents[0].status === 'completed');
}

// ── 4. leave-alone cases ────────────────────────────────────────────────────
console.log('\n[4] no spurious transitions');
{
  // child still running in the list → untouched.
  const s = baseState([agent('c', 'running', { wmuxAgentId: 'agent-run', surfaceId: 'surf-run' })], true);
  const r = reconcile(s, [live('agent-run', 'surf-run', 'running')]);
  check('still-running child untouched', s.waves[0].agents[0].status === 'running' && r.transitions.length === 0);

  // child not in the list yet (spawn just registered) → untouched.
  const s2 = baseState([agent('c', 'running', { wmuxAgentId: 'agent-absent', surfaceId: 'surf-absent' })], true);
  reconcile(s2, []);
  check('absent-from-list child untouched', s2.waves[0].agents[0].status === 'running');

  // already-terminal agent never re-touched (no finishedAt overwrite).
  const s3 = baseState([agent('c', 'completed', { wmuxAgentId: 'agent-done', surfaceId: 'surf-done', finishedAt: 'orig' })], true);
  reconcile(s3, [live('agent-done', 'surf-done', 'exited', 0)]);
  check('terminal agent not re-stamped', s3.waves[0].agents[0].finishedAt === 'orig');
}

// ── 5. user's own panes never touched ───────────────────────────────────────
console.log('\n[5] foreign agents untouched');
{
  // state has ONE child; the list also carries the user's two unrelated panes.
  const s = baseState([agent('w1-c1', 'running', { wmuxAgentId: 'agent-mine', surfaceId: 'surf-mine' })], true);
  const before = JSON.stringify(s);
  reconcile(s, [
    live('agent-f1cf03ab', 'surf-user1', 'running'),
    live('agent-109b3cfb', 'surf-user2', 'exited', 0), // user's pane exited — must NOT enter our state
    live('agent-mine', 'surf-mine', 'running'),
  ]);
  check('foreign exited pane not added to state', s.waves[0].agents.length === 1);
  check('our running child stays running (its record is running)', s.waves[0].agents[0].status === 'running', before);
}

// ── 6. wave closes only when all agents terminal ────────────────────────────
console.log('\n[6] wave completion');
{
  const s = baseState([
    agent('a', 'running', { wmuxAgentId: 'agent-a', surfaceId: 'surf-a' }),
    agent('b', 'running', { wmuxAgentId: 'agent-b', surfaceId: 'surf-b' }),
  ], true);
  // only one exits → wave stays running.
  let r = reconcile(s, [live('agent-a', 'surf-a', 'exited', 0), live('agent-b', 'surf-b', 'running')]);
  check('one exit → wave still running', s.waves[0].status === 'running' && r.wavesClosed.length === 0);
  // second exits → wave closes.
  r = reconcile(s, [live('agent-a', 'surf-a', 'exited', 0), live('agent-b', 'surf-b', 'exited', 1)]);
  check('all terminal → wave completed', s.waves[0].status === 'completed' && r.wavesClosed[0] === 0);
}

// ── 7. slot freed → guard lets a previously-blocked spawn through ────────────
console.log('\n[7] reconcile frees a concurrency slot (integration with guard)');
{
  // 8 active → at the cap; one more would be denied.
  const eight = [];
  for (let i = 0; i < 8; i++) eight.push(agent(`a${i}`, 'running', { depth: 1, wmuxAgentId: `agent-${i}`, surfaceId: `surf-${i}` }));
  const s = baseState(eight);
  check('at cap → spawn denied pre-reconcile', evaluateGuard(s, { parentAgentId: 'a0', count: 1 }).decision === 'deny');
  // a3 exited → reconcile frees its slot.
  reconcile(s, [live('agent-3', 'surf-3', 'exited', 0)]);
  check('active count dropped 8→7', countActive(s) === 7, `active=${countActive(s)}`);
  check('post-reconcile → same spawn now allowed', evaluateGuard(s, { parentAgentId: 'a0', count: 1 }).decision === 'allow');
}

// ── 8. CLI end-to-end via --agents-json (writes state.json on disk) ──────────
console.log('\n[8] CLI --agents-json round-trip');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cli-'));
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify(baseState([
    agent('w1-c1', 'running', { wmuxAgentId: 'agent-aaa', surfaceId: 'surf-aaa' }),
  ], true)));
  const listFile = path.join(dir, 'list.json');
  fs.writeFileSync(listFile, JSON.stringify({ agents: [live('agent-aaa', 'surf-aaa', 'exited', 0)] }));

  const out = JSON.parse(execFileSync('node', [RECONCILE, '--state', stateFile, '--agents-json', listFile], { encoding: 'utf8' }));
  check('CLI reports 1 transition', out.transitions.length === 1 && out.transitions[0].id === 'w1-c1', JSON.stringify(out));
  const persisted = loadState(stateFile);
  check('state.json persisted completed', persisted.waves[0].agents[0].status === 'completed');
  check('CLI closed the wave', persisted.waves[0].status === 'completed');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 9. process-nested: `layout grid` failure frees the slot, no stuck 'pending' ──
console.log('\n[9] grid failure → children failed, slot freed (H-1)');
{
  const PROCESS = path.join(SCRIPTS, 'process-nested-requests.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-h1-'));
  // fake wmux CLI: `agent list` returns empty, `layout grid` exits nonzero.
  const fakeCli = path.join(dir, 'fake-wmux.js');
  fs.writeFileSync(fakeCli, `const a=process.argv.slice(2);
if(a[0]==='agent'&&a[1]==='list'){process.stdout.write(JSON.stringify({agents:[]}));process.exit(0);}
if(a[0]==='layout'&&a[1]==='grid'){process.stderr.write('grid boom');process.exit(1);}
process.stdout.write('{}');process.exit(0);`);
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify(baseState([agent('w1', 'running', { depth: 1 })])));
  // a valid pending nested request
  fs.writeFileSync(path.join(dir, 'nested-request-w1.json'), JSON.stringify({
    parentAgentId: 'w1', status: 'pending', cwd: dir,
    subTasks: [{ label: 'c1', subtask: 'do x', files: [], excludeFiles: [], engine: 'claude' }],
  }));
  const out = JSON.parse(execFileSync('node', [PROCESS, '--state', stateFile, '--wmux-cli', fakeCli], { encoding: 'utf8' }));
  check('processOne did not throw to errored', (out.errored || []).length === 0, JSON.stringify(out.errored));
  const st = loadState(stateFile);
  const child = st.waves[1].agents[0];
  check('child marked failed (not stuck pending)', child.status === 'failed', `status=${child.status}`);
  check('failed child holds no slot', countActive(st) === 1, `active=${countActive(st)}`); // only w1 active
  check('request consumed (processed, not stuck processing)', JSON.parse(fs.readFileSync(path.join(dir, 'nested-request-w1.json'), 'utf8')).status === 'processed');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n──────────\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
