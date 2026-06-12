#!/usr/bin/env node
// test-orch-status.js — exercises orch-status.js (READ-ONLY wave overview + bounded
// tail) against crafted .orch-run fixtures (no mocks): tier inference, status
// heuristics, schema variance, read-path scope-checking (F14), byte-slice tail trim
// (F5/F6), claude fallback (F8), discover/cross-repo resolve (F1/F11). All real-data
// checks (discover finding govoff, cross-repo gantt-sync) are soft — skipped if the
// external repo was cleaned — so the suite stays green standalone.
//
// Run: node scripts/spike/test-orch-status.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { tierOf } = require('../orch-status-read');
const { trimPartial, safeWithin } = require('../orch-status-tail');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const CLI = path.join(ROOT, 'scripts', 'orch-status.js'); // absolute so cwd can drive resolution
function run(args, cwd) { return spawnSync(process.execPath, [CLI, ...args], { cwd: cwd || ROOT, encoding: 'utf8' }); }
function st(agents) { return { version: 1, waves: [{ index: 0, status: 'running', agents }] }; }
function writeWave(repo, wave, state) {
  const dir = path.join(repo, '.orch-run', wave);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  return dir;
}
function lineFor(out, id) { return out.split(/\r?\n/).find((l) => l.includes(id + ' |')) || ''; }

// ── 1. tier inference (pure) ────────────────────────────────────────────────
console.log('\n[1] tierOf');
check('real leader kept (no ~)', tierOf({ tier: 'leader', engine: 'codex' }) === 'leader');
check('real worker kept', tierOf({ tier: 'worker', engine: 'claude' }) === 'worker');
check('codex → ~worker', tierOf({ engine: 'codex' }) === '~worker');
check('claude → ~leader', tierOf({ engine: 'claude' }) === '~leader');
check('opencode → ~worker', tierOf({ engine: 'opencode' }) === '~worker');
check('chain link (claude) → ~worker (continuation)', tierOf({ engine: 'claude', chainId: 'c' }) === '~worker');

// ── 2. read-path scope-check (F14) ──────────────────────────────────────────
console.log('\n[2] safeWithin (F14)');
{
  const base = path.join(os.tmpdir(), 'orchdir-x');
  check('inside path allowed', safeWithin(base, 'agent-a-result.md') === path.join(base, 'agent-a-result.md'));
  check('parent traversal blocked', safeWithin(base, path.join('..', '..', 'evil.md')) === null);
  check('absolute outside blocked', safeWithin(base, path.join(os.tmpdir(), 'other', 'evil.md')) === null);
  check('absolute inside allowed', safeWithin(base, path.join(base, 'sub', 'r.md')) === path.join(base, 'sub', 'r.md'));
}

// ── 3. byte-slice trim, both ends (F5/F6) ───────────────────────────────────
console.log('\n[3] trimPartial');
check('mid-file drops leading + trailing partial', trimPartial('tailX\nev1\nev2\npartial', true).body === 'ev1\nev2\n');
check('from file head keeps complete lines', trimPartial('ev1\nev2\n', false).body === 'ev1\nev2\n');
check('counts leading bytes dropped', trimPartial('tailX\nev1\n', true).droppedLeading === Buffer.byteLength('tailX\n'));
check('single mid-file partial → no complete line', trimPartial('only-partial-no-newline', true).body === '');

// ── 4. summary: tier, heuristics, schema variance, unreadable, root, intent ──
console.log('\n[4] summary on crafted .orch-run');
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-status-sum-'));
  // root-level state.json (empty) must be scanned
  fs.mkdirSync(path.join(repo, '.orch-run'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.orch-run', 'state.json'), JSON.stringify({ version: 1, waves: [] }));

  const mixDir = writeWave(repo, 'mix', st([
    { id: 'a-leader', engine: 'claude', tier: 'leader', status: 'completed', depth: 1 },
    { id: 'a-codex', engine: 'codex', status: 'completed', depth: 1 },
    { id: 'a-claude', engine: 'claude', status: 'completed', depth: 1 },
    { id: 'a-open', engine: 'opencode', status: 'completed', depth: 1 },
    { id: 'a-chain', engine: 'claude', chainId: 'chain-z', status: 'completed', depth: 2 },
    { id: 'bad..id', engine: 'codex', status: 'running' }, // invalid id → unsafe, no file reads
  ]));
  fs.writeFileSync(path.join(mixDir, 'nested-request-a-leader.json'), JSON.stringify({ status: 'pending', parentAgentId: 'a-leader', subTasks: [] }));
  // relay/response markers must NOT count as pending intent (only *-request-* do)
  fs.writeFileSync(path.join(mixDir, 'relay-chain-z.json'), JSON.stringify({ status: 'relayed' }));
  fs.writeFileSync(path.join(mixDir, 'nested-response-a-leader.json'), JSON.stringify({ status: 'spawned' }));

  const heurDir = writeWave(repo, 'heur', st([
    { id: 'h-done', engine: 'codex', status: 'running', depth: 1 },
    { id: 'h-stall', engine: 'codex', status: 'running', depth: 1 },
    { id: 'h-noout', engine: 'codex', status: 'running', depth: 1 },
    { id: 'h-crash', engine: 'claude', status: 'failed', crashReason: 'heartbeat-stale', depth: 1 },
    { id: 'h-unsafe', engine: 'codex', status: 'completed', resultFile: path.join('..', '..', 'evil.md'), depth: 1 },
  ]));
  fs.writeFileSync(path.join(heurDir, 'agent-h-done-result.json'), JSON.stringify({ status: 'done' })); // running + result → done-unharvested
  const stallOut = path.join(heurDir, 'agent-h-stall-out.jsonl');
  fs.writeFileSync(stallOut, '{"type":"thread.started"}\n');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(stallOut, old, old); // out.jsonl mtime > 5min → stalled?

  // corrupt state → one "unreadable" line, no crash
  const brokenDir = path.join(repo, '.orch-run', 'broken');
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'state.json'), '{ this is not json');

  const r = run([repo, '--no-color']);
  check('summary exits 0', r.status === 0, r.stderr);
  const o = r.stdout;
  check('root-level state scanned → (root) (no agents)', /▍ \(root\)/.test(o) && o.includes('(no agents)'), o.slice(0, 200));
  check('real leader shown without ~', / a-leader \| .* \| claude \| leader \|/.test(lineFor(o, 'a-leader')), lineFor(o, 'a-leader'));
  check('codex inferred ~worker', lineFor(o, 'a-codex').includes('| ~worker |'), lineFor(o, 'a-codex'));
  check('claude inferred ~leader', lineFor(o, 'a-claude').includes('| ~leader |'), lineFor(o, 'a-claude'));
  check('opencode inferred ~worker', lineFor(o, 'a-open').includes('| ~worker |'), lineFor(o, 'a-open'));
  check('chain link inferred ~worker', lineFor(o, 'a-chain').includes('| ~worker |'), lineFor(o, 'a-chain'));
  check('invalid agent id flagged unsafe', lineFor(o, 'bad..id').includes('unsafe path skipped'), lineFor(o, 'bad..id'));
  check('intent pending counted (relay/response excluded)', o.includes('[intent chờ: 1]'), o);
  check('done-unharvested (running + result)', lineFor(o, 'h-done').includes('done-unharvested'), lineFor(o, 'h-done'));
  check('stalled? (old out mtime, no result)', lineFor(o, 'h-stall').includes('stalled?'), lineFor(o, 'h-stall'));
  check('no-output (running, no out.jsonl)', lineFor(o, 'h-noout').includes('no-output'), lineFor(o, 'h-noout'));
  check('crashReason surfaced', lineFor(o, 'h-crash').includes('crash:heartbeat-stale'), lineFor(o, 'h-crash'));
  check('resultFile traversal → unsafe path skipped', lineFor(o, 'h-unsafe').includes('unsafe path skipped'), lineFor(o, 'h-unsafe'));
  check('corrupt state → unreadable, not crash', o.includes('state unreadable'), o);

  // --json mode
  const j = run([repo, '--json']);
  let parsed = null; try { parsed = JSON.parse(j.stdout); } catch { /* leave null */ }
  check('--json parses + carries runs', parsed && Array.isArray(parsed.runs) && parsed.runs.some((x) => x.name === 'mix'), j.stdout.slice(0, 120));
  const mixRun = parsed && parsed.runs.find((x) => x.name === 'mix');
  check('--json tier fields present', mixRun && mixRun.agents.find((a) => a.id === 'a-leader').tier === 'leader' && mixRun.agents.find((a) => a.id === 'a-codex').tier === '~worker');

  fs.rmSync(repo, { recursive: true, force: true });
}

// ── 5. exit codes: empty root → 0, unknown target → 2 ───────────────────────
console.log('\n[5] exit codes');
{
  const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-status-empty-'));
  fs.mkdirSync(path.join(emptyRepo, '.orch-run'), { recursive: true });
  fs.writeFileSync(path.join(emptyRepo, '.orch-run', 'state.json'), JSON.stringify({ version: 1, waves: [] }));
  const e = run([], emptyRepo);
  check('empty root → exit 0 + (no agents)', e.status === 0 && e.stdout.includes('(no agents)'), `${e.status} ${e.stdout}`);
  const u = run(['zzz-nonexistent-orchwave-xyz'], emptyRepo);
  check('unknown bare target → exit 2', u.status === 2 && /không resolve được/.test(u.stderr), `${u.status} ${u.stderr}`);
  fs.rmSync(emptyRepo, { recursive: true, force: true });
}

// ── 6. tail codex: render, trailing-partial drop, control sanitize (F6) ──────
console.log('\n[6] tail codex (byte-slice)');
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-status-tail-'));
  const dir = writeWave(repo, 'render', { version: 1, waves: [{ agents: [{ id: 'watch-w1', engine: 'codex', resultFile: 'agent-watch-w1-result.json' }] }] });
  const outFile = path.join(dir, 'agent-watch-w1-out.jsonl');
  fs.copyFileSync(path.join(FIX, 'watch-sample-out.jsonl'), outFile);
  // append a control-char event + a trailing partial line (no newline)
  fs.appendFileSync(outFile, '{"type":"item.started","item":{"type":"command_execution","command":"echo \\u001b[31mRED\\u001b[0m clean"}}\n');
  fs.appendFileSync(outFile, '{"type":"item.started","item":{"type":"command_execution","command":"PARTIAL_BEING_WRITTEN');
  const statePath = path.join(dir, 'state.json');
  const t = run([statePath, '--tail', 'watch-w1', '--no-color']);
  check('tail exits 0', t.status === 0, t.stderr);
  check('renders command + result events', t.stdout.includes('$ ') && t.stdout.includes('▣ result '), t.stdout.slice(0, 200));
  check('trailing partial dropped (not dumped raw)', !t.stdout.includes('PARTIAL_BEING_WRITTEN'), t.stdout);
  check('control chars stripped (no ESC)', !t.stdout.includes('\x1b'), JSON.stringify(t.stdout.slice(-120)));

  // oversized single event > 256KB cap → bounded message, never a raw dump
  const bigDir = writeWave(repo, 'big', { version: 1, waves: [{ agents: [{ id: 'big-w1', engine: 'codex' }] }] });
  const bigOut = path.join(bigDir, 'agent-big-w1-out.jsonl');
  fs.writeFileSync(bigOut, '{"type":"thread.started"}\n' + 'x'.repeat(300 * 1024) + '\n');
  const b = run([path.join(bigDir, 'state.json'), '--tail', 'big-w1', '--no-color']);
  check('oversized event → bounded message, exit 0', b.status === 0 && /sự kiện cuối/.test(b.stdout) && b.stdout.length < 4000, `${b.status} len=${b.stdout.length}`);
  fs.rmSync(repo, { recursive: true, force: true });
}

// ── 7. tail claude fallback when no claudeSessionId (F8) ─────────────────────
console.log('\n[7] tail claude fallback (F8)');
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-status-cl-'));
  const dir = writeWave(repo, 'cl', st([
    { id: 'lead-x', engine: 'claude', status: 'failed', resultFile: 'agent-lead-x-result.md' },
    { id: 'lead-y', engine: 'claude', status: 'failed' },
  ]));
  fs.writeFileSync(path.join(dir, 'agent-lead-x-result.md'), '# Summary\nRESULT_BODY_LINE done.\n');
  const statePath = path.join(dir, 'state.json');
  const x = run([statePath, '--tail', 'lead-x', '--no-color']);
  check('no sid + result → fallback prints result', x.status === 0 && x.stdout.includes('không có claudeSessionId') && x.stdout.includes('RESULT_BODY_LINE'), x.stdout);
  const y = run([statePath, '--tail', 'lead-y', '--no-color']);
  check('no sid + no result → clear message', y.status === 0 && /thiếu claudeSessionId và không tìm thấy result/.test(y.stdout), y.stdout);
  fs.rmSync(repo, { recursive: true, force: true });
}

// ── 8. real-data: discover + cross-repo wave resolve (F1/F11) — soft ─────────
console.log('\n[8] discover + cross-repo (soft, real data)');
{
  const d = run(['--discover']);
  check('discover exits 0', d.status === 0, d.stderr);
  check('discover lists this repo', d.stdout.includes('recursive-orchestrator'), d.stdout.slice(0, 200));
  const govoff = path.join(os.homedir(), 'govoff', '.orch-run', 'gantt-sync', 'state.json');
  if (fs.existsSync(govoff)) {
    check('discover finds govoff', d.stdout.includes('govoff'), d.stdout);
    const g = run(['gantt-sync']);
    check('cross-repo bare wave resolves to govoff (F1)', g.status === 0 && /resolved → .*govoff.*gantt-sync/.test(g.stdout), g.stdout.split(/\r?\n/)[0]);
    check('cross-repo wave shows its agents', g.stdout.includes('orch-root-c3') || g.stdout.includes('apply-sync'), g.stdout.slice(0, 300));
  } else {
    console.log('  SKIP govoff/gantt-sync not present (cleaned) — covered by Phase 3 E2E');
  }
}

console.log(`\n──────────\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
