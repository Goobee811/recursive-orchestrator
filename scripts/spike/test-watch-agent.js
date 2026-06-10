#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildLookup, resolveTarget, forensicsPath, sanitizeControl } = require('../orch-forensics-map');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures');
let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function run(args, cwd = ROOT) {
  return spawnSync(process.execPath, ['scripts/watch-agent.js', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function copyFixtureRun(dir, stateName = 'state.json') {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'watch-sample-state.json'), path.join(dir, stateName));
  fs.copyFileSync(path.join(FIX, 'watch-sample-out.jsonl'), path.join(dir, 'agent-watch-w1-out.jsonl'));
}

console.log('\n[watch agent]');

const sampleState = path.join(FIX, 'watch-sample-state.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-agent-'));
const lookup = buildLookup({ state: sampleState, root: ROOT });
check('resolve byAgent fixture', lookup.byAgent.get('watch-w1')[0].agentId === 'watch-w1');
check('resolve byPane fixture', resolveTarget('pane-watch-w1', { state: sampleState, root: ROOT }).entry.agentId === 'watch-w1');

const renderRun = path.join(tmp, '.orch-run', 'render');
copyFixtureRun(renderRun);
const renderState = path.join(renderRun, 'state.json');
const once = run(['watch-w1', '--state', renderState, '--once', '--no-color']);
check('--once exits 0', once.status === 0, once.stderr);
check('--once renders command', once.stdout.includes('$ '), once.stdout.slice(0, 200));
check('--once renders result', once.stdout.includes('▣ result '), once.stdout.slice(-300));

const bad = run(['missing-agent', '--state', sampleState, '--once']);
check('unknown target exits non-zero', bad.status !== 0);
check('unknown target lists known agents', bad.stderr.includes('watch-w1'), bad.stderr);

const runA = path.join(tmp, '.orch-run', 'old');
const runB = path.join(tmp, '.orch-run', 'new');
copyFixtureRun(runA);
copyFixtureRun(runB);
const oldTime = new Date(Date.now() - 20000);
const newTime = new Date(Date.now() - 1000);
fs.utimesSync(path.join(runA, 'state.json'), oldTime, oldTime);
fs.utimesSync(path.join(runB, 'state.json'), newTime, newTime);

const chosen = resolveTarget('watch-w1', { root: tmp });
check('disambiguation chooses newest', chosen.entry.statePath.includes(`${path.sep}new${path.sep}`), chosen.entry.statePath);
check('disambiguation warning returned', chosen.warning && chosen.warning.includes('selected newest'));
let strictFailed = false;
try { resolveTarget('watch-w1', { root: tmp, strict: true }); } catch (e) {
  strictFailed = e.code === 'AMBIGUOUS_TARGET' && e.message.includes('old') && e.message.includes('new');
}
check('strict disambiguation errors with candidates', strictFailed);

const fallbackDir = path.join(tmp, 'fallback');
fs.mkdirSync(fallbackDir, { recursive: true });
fs.writeFileSync(path.join(fallbackDir, 'agent-other-out.jsonl'), '');
fs.writeFileSync(path.join(fallbackDir, 'agent-target-extra-out.jsonl'), 'wrong');
const missingForensics = forensicsPath({ engine: 'codex', id: 'target' }, fallbackDir);
check(
  'missing codex forensics keeps exact target path despite prefix collision',
  path.basename(missingForensics) === 'agent-target-out.jsonl' && !fs.existsSync(missingForensics),
  missingForensics
);

const dirty = `safe\x1b]52;c;SGVsbG8=\x07 text\x1b[2A\nnext\tline\x01`;
const clean = sanitizeControl(dirty);
check('sanitize strips ESC', !clean.includes('\x1b'), JSON.stringify(clean));
check('sanitize keeps newline and tab', clean.includes('\nnext\tline'), JSON.stringify(clean));
check('sanitize strips C1 controls', sanitizeControl(`a\u0085b`) === 'ab');

const truncScript = [
  "const fs=require('fs');",
  `const file=${JSON.stringify(path.join(runB, 'agent-watch-w1-out.jsonl'))};`,
  `const child=require('child_process').spawn(process.execPath,['scripts/watch-agent.js','watch-w1','--state',${JSON.stringify(path.join(runB, 'state.json'))},'--interval','50','--no-color'],{cwd:${JSON.stringify(ROOT)},encoding:'utf8'});`,
  "let out=''; child.stdout.on('data',d=>out+=d);",
  "setTimeout(()=>fs.truncateSync(file,0),120);",
  "setTimeout(()=>fs.appendFileSync(file,fs.readFileSync('scripts/spike/fixtures/watch-sample-out.jsonl')),180);",
  "setTimeout(()=>{child.kill('SIGINT'); setTimeout(()=>{console.log(out);},60)},320);",
].join('');
const trunc = spawnSync(process.execPath, ['-e', truncScript], { cwd: ROOT, encoding: 'utf8', timeout: 2000 });
check('truncate-reset emits marker', trunc.stdout.includes('--- file truncated, replaying ---'), trunc.stdout || trunc.stderr);

console.log(`\nRESULT: ${pass} PASS ${fail} FAIL`);
if (fail) process.exit(1);
