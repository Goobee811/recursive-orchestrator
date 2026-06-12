#!/usr/bin/env node
// orch-status-tail.js — bounded "tail" of one agent's forensics for orch-status.js.
//
// Doctrine: NEVER read a whole out.jsonl / transcript (they reach tens of MB). We
// byte-slice the last window, drop the partial lines at BOTH ends (the first line is
// mid-event because we began mid-file; the last is an event still being written), then
// render only complete lines. We deliberately do NOT call the codex renderer's end():
// end() flushes its raw buffer, which on a partial slice would dump a half-written JSON
// fragment. The renderer's default write does not sanitize, so we hand it a sanitizing
// write instead. Claude transcripts are tailed here too (not via watch-agent --once,
// which readFileSync's the entire multi-MB file).

'use strict';

const fs = require('fs');
const path = require('path');
const { createCodexRenderer } = require('./launch-agent-ext');
const { sanitizeControl } = require('./orch-forensics-map');
const { findTranscript, renderClaudeLine } = require('./watch-agent');

const SLICE = 64 * 1024;       // initial tail window
const SLICE_CAP = 256 * 1024;  // adaptive ceiling: a single event past this is "too big"
const OVERSIZE_WARN = 8 * 1024; // a dropped leading partial this large is worth flagging

// A forensics/result path resolved from untrusted state must stay inside the wave's
// orchDir; an `id`/`resultFile` carrying `..` or an absolute path could otherwise read
// arbitrary files. Returns the resolved absolute path or null when it escapes.
function safeWithin(orchDir, rel) {
  if (!rel) return null;
  const base = path.resolve(orchDir);
  const p = path.resolve(base, rel);
  return (p === base || p.startsWith(base + path.sep)) ? p : null;
}

// Read the last `bytes` of `file`; `start > 0` means we began mid-file.
function readAt(file, bytes, size) {
  const start = Math.max(0, size - bytes);
  const len = size - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  return { text: buf.toString('utf8'), start };
}

// Drop a partial first line (only when mid-file) and any trailing partial (a line not
// terminated by a newline is still being written). Reports leading bytes dropped.
function trimPartial(text, startedMidFile) {
  let droppedLeading = 0;
  if (startedMidFile) {
    const nl = text.indexOf('\n');
    if (nl >= 0) { droppedLeading = Buffer.byteLength(text.slice(0, nl + 1), 'utf8'); text = text.slice(nl + 1); }
    else { droppedLeading = Buffer.byteLength(text, 'utf8'); text = ''; }
  }
  const lastNl = text.lastIndexOf('\n');
  text = lastNl >= 0 ? text.slice(0, lastNl + 1) : '';
  return { body: text, droppedLeading };
}

// Adaptive slice: grow 64KB → 128KB → 256KB until at least one complete line appears
// (or we hit the file head / cap). `oversized` means a single event exceeds the cap.
function sliceLines(file, want) {
  const size = fs.statSync(file).size;
  if (size === 0) return { empty: true, lines: [] };
  let bytes = SLICE;
  for (;;) {
    const { text, start } = readAt(file, bytes, size);
    const { body, droppedLeading } = trimPartial(text, start > 0);
    const lines = body.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length > 0 || bytes >= SLICE_CAP || start === 0) {
      return { lines: lines.slice(-want), droppedLeading, sliceKB: Math.round(bytes / 1024), oversized: lines.length === 0 };
    }
    bytes = Math.min(bytes * 2, SLICE_CAP);
  }
}

function tailCodex(file, opts) {
  const emit = (s) => process.stdout.write(sanitizeControl(s));
  if (!file || !fs.existsSync(file)) { emit('(không có out.jsonl cho agent này)\n'); return; }
  const r = sliceLines(file, opts.n || 40);
  if (r.empty) { emit('(out.jsonl rỗng)\n'); return; }
  if (r.oversized) { emit(`(sự kiện cuối > ${Math.round(SLICE_CAP / 1024)}KB — dùng watch-agent.js để theo dõi trực tiếp)\n`); return; }
  if (r.droppedLeading >= OVERSIZE_WARN) emit(`⚠ bỏ qua sự kiện quá lớn ở đầu lát (~${Math.round(r.droppedLeading / 1024)}KB; lát ${r.sliceKB}KB cuối)\n`);
  const renderer = createCodexRenderer({ noColor: opts.noColor, write: emit });
  for (const line of r.lines) renderer.write(line + '\n');
  // F6: intentionally no renderer.end() — it would flush a raw partial buffer.
}

function tailClaude(entry, opts, resultPath) {
  const emit = (s) => process.stdout.write(sanitizeControl(s));
  // claudeSessionId comes from untrusted state.json; validate the spawn-time shape
  // before it reaches findTranscript so a `..`/separator can't escape the projects dir.
  const sid = entry.claudeSessionId;
  const transcript = (sid && /^[0-9a-fA-F-]{8,}$/.test(sid)) ? findTranscript(sid) : null;
  if (transcript) {
    const r = sliceLines(transcript, opts.n || 40);
    if (r.empty) { emit('(transcript rỗng)\n'); return; }
    if (r.oversized) { emit('(dòng transcript cuối quá lớn — dùng watch-agent.js)\n'); return; }
    for (const line of r.lines) renderClaudeLine(line, emit);
    return;
  }
  // F8: every legacy claude agent lacks claudeSessionId → fall back to a bounded result tail.
  if (resultPath && fs.existsSync(resultPath)) {
    emit('(không có claudeSessionId — chỉ hiển thị phần cuối result file)\n');
    const r = sliceLines(resultPath, opts.n || 40);
    for (const line of (r.lines || [])) emit(line + '\n');
  } else {
    emit('(agent claude thiếu claudeSessionId và không tìm thấy result file)\n');
  }
}

module.exports = { tailCodex, tailClaude, safeWithin, sliceLines, trimPartial };
