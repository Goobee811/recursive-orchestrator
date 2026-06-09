#!/usr/bin/env node
'use strict';

const fs = require('fs');

const argv = process.argv.slice(2);
const logFile = process.env.FAKE_WMUX_LOG || '';
const counterFile = logFile ? `${logFile}.counter` : '';

function readCounter() {
  if (!counterFile || !fs.existsSync(counterFile)) return { pane: 0, agent: 0, split: 0 };
  return JSON.parse(fs.readFileSync(counterFile, 'utf8'));
}

function writeCounter(counter) {
  if (counterFile) fs.writeFileSync(counterFile, JSON.stringify(counter), 'utf8');
}

function record(extra) {
  if (!logFile) return;
  fs.appendFileSync(logFile, JSON.stringify({ argv, ...extra }) + '\n', 'utf8');
}

function nextId(kind) {
  const counter = readCounter();
  counter[kind] = (counter[kind] || 0) + 1;
  writeCounter(counter);
  return counter[kind];
}

function maybeFailSplit() {
  const n = nextId('split');
  const failAt = parseInt(process.env.FAKE_WMUX_FAIL_SPLIT_AT || '0', 10);
  if (failAt === n) {
    record({ command: 'split', direction: argv.includes('--down') ? 'horizontal' : 'vertical', failed: true, splitIndex: n });
    process.stderr.write(`fake split failed at ${n}`);
    process.exit(1);
  }
  return n;
}

if (argv[0] === 'focus-pane') {
  record({ command: 'focus-pane', paneId: argv[1] || '' });
  process.stdout.write(JSON.stringify({ ok: true }) + '\n');
  process.exit(0);
}

if (argv[0] === 'split') {
  const splitIndex = maybeFailSplit();
  const paneId = `pane-fake-${splitIndex}`;
  record({ command: 'split', direction: argv.includes('--down') ? 'horizontal' : 'vertical', paneId, splitIndex });
  process.stdout.write(JSON.stringify({ paneId }) + '\n');
  process.exit(0);
}

if (argv[0] === 'layout' && argv[1] === 'grid') {
  const countIndex = argv.indexOf('--count');
  const count = countIndex !== -1 ? parseInt(argv[countIndex + 1], 10) : 1;
  const newPaneIds = [];
  for (let i = 1; i < count; i++) newPaneIds.push(`pane-grid-${nextId('pane')}`);
  record({ command: 'layout-grid', count, newPaneIds });
  process.stdout.write(JSON.stringify({ newPaneIds }) + '\n');
  process.exit(0);
}

if (argv[0] === 'agent' && argv[1] === 'spawn') {
  const pane = argv[argv.indexOf('--pane') + 1] || '';
  const agentId = `wmux-agent-${nextId('agent')}`;
  const surfaceId = `surface-${agentId}`;
  record({ command: 'agent-spawn', pane, agentId, surfaceId });
  process.stdout.write(JSON.stringify({ agentId, surfaceId }) + '\n');
  process.exit(0);
}

if (argv[0] === 'agent' && argv[1] === 'list') {
  record({ command: 'agent-list' });
  process.stdout.write(JSON.stringify({ agents: [] }) + '\n');
  process.exit(0);
}

record({ command: 'unknown' });
process.stdout.write(JSON.stringify({ ok: true }) + '\n');
