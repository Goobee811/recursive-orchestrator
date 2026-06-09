#!/usr/bin/env node
// dummy-launcher.js — a stand-in for launch-agent-ext.js used ONLY by the Phase 4
// e2e test. Same calling convention (`node dummy-launcher.js <prompt-file> [--engine x]`)
// so it exercises the real spawn pipeline (layout grid + agent spawn + --cmd auto-run)
// without launching claude/codex — zero subscription cost. Proves it received the
// prompt file by writing a sibling `.alive` sentinel, then stays running.
const fs = require('fs');
const promptFile = process.argv[2] || 'unknown-prompt';
let firstLine = '(prompt unreadable)';
try { firstLine = fs.readFileSync(promptFile, 'utf8').split('\n')[0]; } catch { /* ignore */ }
const sentinel = `${promptFile}.alive`;
fs.writeFileSync(sentinel, `NESTED_ALIVE ${new Date().toISOString()} pid=${process.pid} prompt="${firstLine}"\n`);
console.log(`[nested-dummy] alive — prompt=${promptFile} sentinel=${sentinel}`);
setInterval(() => {}, 10000); // keep the pane process running until killed
