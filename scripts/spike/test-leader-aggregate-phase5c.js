#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(__dirname, 'leader-aggregate-fixtures');
const script = path.join(root, 'scripts', 'leader-aggregate.ps1');

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeRepo(name) {
  const dir = path.join(fixtureRoot, name);
  resetDir(dir);
  run('git', ['init'], dir);
  run('git', ['config', 'user.email', 'test@example.com'], dir);
  run('git', ['config', 'user.name', 'Test User'], dir);
  fs.writeFileSync(path.join(dir, 'target.txt'), 'base\n');
  run('git', ['add', 'target.txt'], dir);
  run('git', ['commit', '-m', 'init'], dir);
  fs.mkdirSync(path.join(dir, 'reports'));
  return dir;
}

function writeState(repo, codexFilesChanged = ['target.txt']) {
  const state = {
    waves: [{
      agents: [
        { id: 'w2', chainId: 'chain-demo', linkSeq: 2, nextLink: null, engine: 'codex', resultFile: 'unused.md' },
        { id: 'w1', chainId: 'chain-demo', linkSeq: 1, nextLink: 2, engine: 'claude', resultFile: 'agent-w1-result.md' },
        { id: 'other', chainId: 'chain-other', linkSeq: 1, nextLink: null, engine: 'claude', resultFile: 'agent-other-result.md' },
      ],
    }],
  };
  fs.writeFileSync(path.join(repo, 'state.json'), JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(repo, 'agent-w1-result.md'), '# Worker handoff\n\nClaude link complete.\n');
  fs.writeFileSync(path.join(repo, 'agent-w2-result.json'), JSON.stringify({
    status: 'done',
    filesChanged: codexFilesChanged,
    decisions: ['Verified target edit'],
    remaining: [],
    blockers: [],
  }, null, 2));
  fs.writeFileSync(path.join(repo, 'agent-w2-out.jsonl'), '{"event":"done"}\n');
}

function invoke(repo) {
  const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(ps, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-State', path.join(repo, 'state.json'),
    '-ChainId', 'chain-demo',
    '-OutDir', path.join(repo, 'reports'),
  ], { cwd: root, encoding: 'utf8' });
  const text = (result.stdout || '').trim();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {
    throw new Error(`stdout was not JSON:\n${text}\nstderr:\n${result.stderr}`);
  }
  return { result, parsed };
}

function testOrdersByLinkSeqAndVerifiesDiff() {
  const repo = makeRepo('ok');
  writeState(repo);
  fs.writeFileSync(path.join(repo, 'target.txt'), 'base\nchanged\n');
  const { result, parsed } = invoke(repo);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(parsed.links.map((l) => l.linkSeq), [1, 2]);
  assert.strictEqual(parsed.links[1].engine, 'codex');
  assert.strictEqual(parsed.links[1].verified, true);
  assert.strictEqual(parsed.validated, true);
  assert.ok(fs.existsSync(parsed.handoffFile));
}

function testBlocksWhenCodexDiffMissing() {
  const repo = makeRepo('blocked');
  writeState(repo);
  const { parsed } = invoke(repo);
  assert.strictEqual(parsed.links[1].status, 'BLOCKED');
  assert.strictEqual(parsed.links[1].verified, false);
  assert.ok(parsed.blocked.some((b) => b.includes('no git diff/status evidence')));
}

function testRefusesUnfinishedChain() {
  const repo = makeRepo('unfinished');
  writeState(repo);
  const statePath = path.join(repo, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.waves[0].agents[0].nextLink = 3;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(repo, 'target.txt'), 'base\nchanged\n');
  const { result, parsed } = invoke(repo);
  assert.notStrictEqual(result.status, 0);
  assert.strictEqual(parsed.validated, false);
  assert.ok(parsed.blocked[0].includes('chain chua ket thuc'));
}

resetDir(fixtureRoot);
testOrdersByLinkSeqAndVerifiesDiff();
testBlocksWhenCodexDiffMissing();
testRefusesUnfinishedChain();
fs.rmSync(fixtureRoot, { recursive: true, force: true });
console.log('leader-aggregate phase5c tests PASS');
