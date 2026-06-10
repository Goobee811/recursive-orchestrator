#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const PROCESS = path.join(SCRIPTS, 'process-nested-requests.js');
const ROUTER = path.join(SCRIPTS, 'chain-router.js');
const SPAWN_BY_SPLIT = path.join(SCRIPTS, 'spawn-by-split.js');
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
function writePrompt(dir, agentId) {
  fs.writeFileSync(path.join(dir, `agent-${agentId}-prompt.md`), `prompt for ${agentId}\n`, 'utf8');
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
function closeAfterSpawn(entries, surfaceId, paneId) {
  const spawnIndex = entries.findIndex((e) => e.command === 'agent-spawn' && e.pane === paneId && !e.failed);
  const closeIndex = entries.findIndex((e) => e.command === 'close-surface' && e.surfaceId === surfaceId);
  return spawnIndex !== -1 && closeIndex > spawnIndex;
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
  const closes = entries.filter((e) => e.command === 'close-surface').map((e) => e.surfaceId);
  check('3 children spawned', out.processed[0].children.filter((c) => !c.error).length === 3, JSON.stringify(out));
  check('split vertical then horizontal/horizontal', splits.map((e) => e.direction).join(',') === 'vertical,horizontal,horizontal', JSON.stringify(splits));
  check('sources follow parent then previous child panes', focuses.join(',') === 'pane-parent,pane-fake-1,pane-fake-2', JSON.stringify(focuses));
  check('split --pane follows parent then previous child panes', splits.map((e) => e.pane).join(',') === 'pane-parent,pane-fake-1,pane-fake-2', JSON.stringify(splits));
  check('nested closes default split surfaces after successful spawns', closes.join(',') === 'surf-fake-1,surf-fake-2,surf-fake-3', JSON.stringify(closes));
  check('nested close-surface happens after matching agent spawn',
    ['1', '2', '3'].every((n) => closeAfterSpawn(entries, `surf-fake-${n}`, `pane-fake-${n}`)), JSON.stringify(entries));
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
  const closes = entries.filter((e) => e.command === 'close-surface').map((e) => e.surfaceId);
  check('chain spawned next link', out.spawned.length === 1 && !out.spawned[0].nextLink.error, JSON.stringify(out));
  check('chain split vertical from from pane', split && split.direction === 'vertical' && focus && focus.paneId === 'pane-from', JSON.stringify(entries));
  check('chain split forwards --pane from from pane', split && split.pane === 'pane-from', JSON.stringify(entries));
  check('chain closes default split surface after spawn', closes.join(',') === 'surf-fake-1', JSON.stringify(closes));
  check('chain close-surface happens after agent spawn', closeAfterSpawn(entries, 'surf-fake-1', 'pane-fake-1'), JSON.stringify(entries));
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

console.log('\n[5] spawn failure does not close default split surface');
{
  const dir = mkOrch('spawn-fail', baseState([agent('parent', 'running', { depth: 1, paneId: 'pane-parent' })]));
  const log = path.join(dir, 'wmux.log');
  const stateFile = path.join(dir, 'state.json');
  writeNestedRequest(dir, 'parent', 2);
  const out = runNode(PROCESS, ['--state', stateFile, '--wmux-cli', FAKE], log, { FAKE_WMUX_FAIL_AGENT_SPAWN_AT: '2' });
  const entries = readLog(log);
  const closes = entries.filter((e) => e.command === 'close-surface').map((e) => e.surfaceId);
  const children = out.processed[0].children;
  check('child 2 records spawn error', !!children[1].error && !children[0].error, JSON.stringify(children));
  check('failed spawn default surface remains open', closes.join(',') === 'surf-fake-1', JSON.stringify(closes));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[6] close-surface failure does not fail spawn');
{
  const dir = mkOrch('close-fail', baseState([agent('parent', 'running', { depth: 1, paneId: 'pane-parent' })]));
  const log = path.join(dir, 'wmux.log');
  const stateFile = path.join(dir, 'state.json');
  writeNestedRequest(dir, 'parent', 1);
  const out = runNode(PROCESS, ['--state', stateFile, '--wmux-cli', FAKE], log, { FAKE_WMUX_FAIL_CLOSE_SURFACE_AT: '1' });
  const entries = readLog(log);
  const close = entries.find((e) => e.command === 'close-surface');
  check('spawn succeeds when close-surface fails', out.processed[0].children.length === 1 && !out.processed[0].children[0].error, JSON.stringify(out));
  check('close-surface failure is logged by fake cli', close && close.surfaceId === 'surf-fake-1' && close.failed === true, JSON.stringify(entries));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[7] spawn-by-split closes default split surface after spawn');
{
  const dir = mkOrch('spawn-by-split', baseState([agent('child', 'pending', { depth: 2, engine: 'claude' })]));
  const log = path.join(dir, 'wmux.log');
  const stateFile = path.join(dir, 'state.json');
  writePrompt(dir, 'child');
  const out = runNode(SPAWN_BY_SPLIT, ['--state', stateFile, '--agent', 'child', '--wmux-cli', FAKE, '--source-pane', 'pane-parent'], log);
  const entries = readLog(log);
  const closes = entries.filter((e) => e.command === 'close-surface').map((e) => e.surfaceId);
  check('spawn-by-split spawned child', out.agent === 'child' && out.paneId === 'pane-fake-1' && out.surfaceId === 'surface-wmux-agent-1', JSON.stringify(out));
  check('spawn-by-split closes default split surface', closes.join(',') === 'surf-fake-1', JSON.stringify(closes));
  check('spawn-by-split close-surface happens after agent spawn', closeAfterSpawn(entries, 'surf-fake-1', 'pane-fake-1'), JSON.stringify(entries));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[8] explicit grid layout bypasses split');
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
