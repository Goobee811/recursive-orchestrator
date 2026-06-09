#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const PROCESS = path.join(SCRIPTS, 'process-nested-requests.js');
const ROUTER = path.join(SCRIPTS, 'chain-router.js');
const FAKE = path.join(__dirname, 'fake-wmux-cli.js');
const { loadState } = require(path.join(SCRIPTS, 'nested-state'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function agent(id, status, extra) { return Object.assign({ id, label: id, status }, extra || {}); }
function baseState(agents) { return { id: 'orch', task: 't', status: 'running', cwd: '/tmp', waves: [{ index: 0, status: 'running', agents }] }; }
function mkOrch(name, state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `split-${name}-`));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  return dir;
}
function writeNestedRequest(dir, parentId, count) {
  const subTasks = [];
  for (let i = 1; i <= count; i++) subTasks.push({ label: `child ${i}`, subtask: `work ${i}` });
  fs.writeFileSync(path.join(dir, `nested-request-${parentId}.json`), JSON.stringify({ parentAgentId: parentId, status: 'pending', cwd: '/tmp/work', subTasks }, null, 2));
}
function writeChainRequest(dir, fromId) {
  fs.writeFileSync(path.join(dir, `chain-request-${fromId}.json`), JSON.stringify({
    fromAgentId: fromId, status: 'pending', done: false, cwd: '/tmp/work',
    next: { label: 'continue', remaining: 'finish rest' },
  }, null, 2));
}
function runNode(script, args, logFile, extraEnv) {
  return JSON.parse(execFileSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WMUX_PANE_ID: '', FAKE_WMUX_LOG: logFile, ...(extraEnv || {}) },
  }));
}
function readLog(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

console.log('\n[1] nested wave split directions');
{
  const dir = mkOrch('nested', baseState([agent('parent', 'running', { depth: 1, paneId: 'pane-parent' })]));
  const log = path.join(dir, 'wmux.log');
  const stateFile = path.join(dir, 'state.json');
  writeNestedRequest(dir, 'parent', 3);
  const out = runNode(PROCESS, ['--state', stateFile, '--wmux-cli', FAKE], log);
  const entries = readLog(log);
  const splits = entries.filter((e) => e.command === 'split');
  const focuses = entries.filter((e) => e.command === 'focus-pane').map((e) => e.paneId);
  check('3 children spawned', out.processed[0].children.filter((c) => !c.error).length === 3, JSON.stringify(out));
  check('split vertical then horizontal/horizontal', splits.map((e) => e.direction).join(',') === 'vertical,horizontal,horizontal', JSON.stringify(splits));
  check('sources follow parent then previous child panes', focuses.join(',') === 'pane-parent,pane-fake-1,pane-fake-2', JSON.stringify(focuses));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[2] chain next-link split from from-link pane');
{
  const dir = mkOrch('chain', baseState([agent('w1', 'running', { depth: 2, paneId: 'pane-from', chainId: 'chain-w1', linkSeq: 1, leaderAgentId: 'leader' })]));
  const log = path.join(dir, 'wmux.log');
  const stateFile = path.join(dir, 'state.json');
  writeChainRequest(dir, 'w1');
  const out = runNode(ROUTER, ['--state', stateFile, '--wmux-cli', FAKE], log);
  const entries = readLog(log);
  const split = entries.find((e) => e.command === 'split');
  const focus = entries.find((e) => e.command === 'focus-pane');
  check('chain spawned next link', out.spawned.length === 1 && !out.spawned[0].nextLink.error, JSON.stringify(out));
  check('chain split vertical from from pane', split && split.direction === 'vertical' && focus && focus.paneId === 'pane-from', JSON.stringify(entries));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[3] missing source falls back to grid');
{
  const dir = mkOrch('grid-fallback', baseState([agent('parent', 'running', { depth: 1 })]));
  const log = path.join(dir, 'wmux.log');
  const stateFile = path.join(dir, 'state.json');
  writeNestedRequest(dir, 'parent', 2);
  const out = runNode(PROCESS, ['--state', stateFile, '--wmux-cli', FAKE], log);
  const entries = readLog(log);
  check('grid fallback spawned children', out.processed[0].children.filter((c) => !c.error).length === 2, JSON.stringify(out));
  check('grid fallback used layout grid, no split', entries.some((e) => e.command === 'layout-grid') && !entries.some((e) => e.command === 'split'), JSON.stringify(entries));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[4] split failure does not wedge later siblings');
{
  const dir = mkOrch('split-fail', baseState([agent('parent', 'running', { depth: 1, paneId: 'pane-parent' })]));
  const log = path.join(dir, 'wmux.log');
  const stateFile = path.join(dir, 'state.json');
  writeNestedRequest(dir, 'parent', 3);
  const out = runNode(PROCESS, ['--state', stateFile, '--wmux-cli', FAKE], log, { FAKE_WMUX_FAIL_SPLIT_AT: '2' });
  const children = out.processed[0].children;
  const st = loadState(stateFile);
  const kids = st.waves[1].agents;
  const focuses = readLog(log).filter((e) => e.command === 'focus-pane').map((e) => e.paneId);
  check('child 2 failed only', children[1].error === 'no pane allocated' && !children[0].error && !children[2].error, JSON.stringify(children));
  check('state marks failed/running/running', kids.map((k) => k.status).join(',') === 'running,failed,running', JSON.stringify(kids.map((k) => k.status)));
  check('child 3 anchors to last successful child pane', focuses.join(',') === 'pane-parent,pane-fake-1,pane-fake-1', JSON.stringify(focuses));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[5] explicit grid layout bypasses split');
{
  const dir = mkOrch('grid-layout', baseState([agent('parent', 'running', { depth: 1, paneId: 'pane-parent' })]));
  const log = path.join(dir, 'wmux.log');
  const stateFile = path.join(dir, 'state.json');
  writeNestedRequest(dir, 'parent', 2);
  runNode(PROCESS, ['--state', stateFile, '--wmux-cli', FAKE, '--layout', 'grid'], log);
  const entries = readLog(log);
  check('--layout grid uses grid', entries.some((e) => e.command === 'layout-grid'));
  check('--layout grid calls no split', !entries.some((e) => e.command === 'split'), JSON.stringify(entries));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n──────────\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
