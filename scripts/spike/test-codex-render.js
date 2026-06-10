#!/usr/bin/env node
// test-codex-render.js — verifies the Codex pane renderer is chunk-boundary
// invariant while preserving the raw echo escape hatch.
//
// Run: node scripts/spike/test-codex-render.js

'use strict';

const fs = require('fs');
const path = require('path');
const { createCodexRenderer } = require('../launch-agent-ext');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = [
  '.orch-run/chfix/agent-orch-root-c1-out.jsonl',
  '.orch-run/agfix/agent-orch-root-c1-out.jsonl',
];

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

function feed(raw, chunkSize, opts) {
  let output = '';
  const renderer = createCodexRenderer(Object.assign({}, opts, {
    write: (s) => { output += s; },
  }));
  for (let i = 0; i < raw.length; i += chunkSize) {
    renderer.write(Buffer.from(raw.slice(i, i + chunkSize), 'utf8'));
  }
  renderer.end();
  return output;
}

function findMidLineChunkSize(raw) {
  const firstNl = raw.indexOf('\n');
  if (firstNl < 4) return 7;
  return Math.max(2, firstNl + 3);
}

console.log('\n[codex renderer]');
for (const rel of FIXTURES) {
  const file = path.join(ROOT, rel);
  const raw = fs.readFileSync(file, 'utf8');
  const chunkSizes = [7, 64, 1000, findMidLineChunkSize(raw)];
  const outputs = [];

  for (const size of chunkSizes) {
    let threw = false;
    let rendered = '';
    try {
      rendered = feed(raw, size);
    } catch (e) {
      threw = true;
      rendered = e.stack || e.message;
    }
    check(`${rel} chunk ${size} does not throw`, !threw, rendered);
    outputs.push(rendered);
  }

  const baseline = outputs[0];
  check(`${rel} chunk-boundary invariant`, outputs.every((out) => out === baseline));
  check(`${rel} renders commands`, baseline.includes('$ '), baseline.slice(0, 200));
  check(`${rel} renders result`, baseline.includes('▣ result '), baseline.slice(-300));

  const rawEcho = feed(raw, 64, { rawEcho: true });
  check(`${rel} raw echo preserves bytes`, rawEcho === raw);
}

console.log(`\nRESULT: ${pass} PASS ${fail} FAIL`);
if (fail) process.exit(1);
