#!/usr/bin/env node
// Dummy spike agent — writes a sentinel file (proves --cmd auto-ran) then stays
// alive (so `wmux agent list` reports status "running"). No Claude, no API cost.
// Usage: node dummy-agent.js <sentinel-path> [label]
const fs = require('fs');
const sentinel = process.argv[2] || 'spike-sentinel.txt';
const label = process.argv[3] || 'dummy';
fs.writeFileSync(sentinel, `SPIKE_ALIVE ${label} ${new Date().toISOString()} pid=${process.pid}\n`);
console.log(`[spike] dummy agent "${label}" alive — sentinel=${sentinel}`);
setInterval(() => {}, 10000); // keep pane process running until killed
