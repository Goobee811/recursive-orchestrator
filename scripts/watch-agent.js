#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCodexRenderer } = require('./launch-agent-ext');
const { resolveTarget, sanitizeControl } = require('./orch-forensics-map');

function parseArgs(argv) {
  const opts = { fromStart: true, once: false, noColor: false, interval: 500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') opts.state = argv[++i];
    else if (a === '--no-color') opts.noColor = true;
    else if (a === '--from-start') opts.fromStart = true;
    else if (a === '--once') opts.once = true;
    else if (a === '--interval') opts.interval = Math.max(50, parseInt(argv[++i], 10) || 500);
    else if (!opts.target) opts.target = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function findTranscript(sessionId) {
  if (!sessionId) return null;
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsRoot)) return null;
  for (const proj of fs.readdirSync(projectsRoot)) {
    const candidate = path.join(projectsRoot, proj, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function textOf(value) {
  if (typeof value === 'string') return value;
  if (!value) return '';
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ');
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (value.name) return value.name;
  return '';
}

function renderClaudeLine(line, write) {
  if (!line.trim()) return;
  let entry;
  try { entry = JSON.parse(line); } catch { write(`[raw] ${line}\n`); return; }
  const type = entry.type || entry.role || (entry.message && entry.message.role) || 'event';
  const msg = entry.message || entry;
  const content = textOf(msg.content || entry.content || msg.text || entry.text);
  if (type.includes('tool_use')) write(`[tool] ${textOf(msg.name || entry.name || content)}\n`);
  else if (type.includes('tool_result')) write(`[result] ${content || 'ok'}\n`);
  else if (type === 'user') write(`[user] ${content}\n`);
  else if (type === 'assistant') write(`[assistant] ${content}\n`);
  else if (content) write(`[${type}] ${content}\n`);
}

function readExisting(file, onChunk) {
  if (!fs.existsSync(file)) return 0;
  const content = fs.readFileSync(file, 'utf8');
  if (content) onChunk(content);
  return Buffer.byteLength(content, 'utf8');
}

function tailFile(file, opts, onChunk, onEnd) {
  let lastSize = opts.fromStart ? readExisting(file, onChunk) : (fs.existsSync(file) ? fs.statSync(file).size : 0);
  if (opts.once) { onEnd(); return; }
  if (!fs.existsSync(file)) process.stderr.write(`waiting for ${file}...\n`);
  const timer = setInterval(() => {
    try {
      if (!fs.existsSync(file)) return;
      const size = fs.statSync(file).size;
      if (size < lastSize) {
        process.stdout.write(sanitizeControl('--- file truncated, replaying ---\n'));
        lastSize = 0;
      }
      if (size <= lastSize) return;
      const start = lastSize;
      lastSize = size;
      const stream = fs.createReadStream(file, { start, end: size - 1 });
      stream.on('data', onChunk);
      stream.on('error', (e) => {
        lastSize = start;
        process.stderr.write(`warning: watch-agent stream read failed: ${e.message}\n`);
      });
    } catch (e) {
      process.stderr.write(`warning: watch-agent tail read failed: ${e.message}\n`);
    }
  }, opts.interval);
  process.on('SIGINT', () => {
    clearInterval(timer);
    onEnd();
    process.exit(0);
  });
}

function watchCodex(entry, opts) {
  const renderer = createCodexRenderer({
    noColor: opts.noColor,
    write: (s) => process.stdout.write(sanitizeControl(s)),
  });
  tailFile(entry.forensicsPath, opts, (chunk) => renderer.write(chunk), () => renderer.end());
}

function watchClaude(entry, opts) {
  if (!entry.claudeSessionId) {
    throw new Error(`agent '${entry.agentId}' has no claudeSessionId; spawn must pass claude --session-id and record it in state.json`);
  }
  const transcript = findTranscript(entry.claudeSessionId);
  if (!transcript) throw new Error(`Claude transcript not found for session ${entry.claudeSessionId}`);
  let buffer = '';
  const write = (s) => process.stdout.write(sanitizeControl(s));
  tailFile(transcript, opts, (chunk) => {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) renderClaudeLine(line, write);
  }, () => {
    if (buffer) renderClaudeLine(buffer, write);
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target) throw new Error('Usage: node scripts/watch-agent.js <agentId|paneId> [--state <path>] [--no-color] [--from-start] [--once] [--interval <ms>]');
  const resolved = resolveTarget(opts.target, { state: opts.state });
  if (resolved.warning) process.stderr.write(resolved.warning + '\n');
  if (resolved.entry.engine === 'codex') watchCodex(resolved.entry, opts);
  else watchClaude(resolved.entry, opts);
}

if (require.main === module) {
  try { main(); } catch (e) {
    const known = e.knownAgents && e.knownAgents.length ? `\nKnown agents:\n  ${e.knownAgents.join('\n  ')}` : '';
    console.error(`${e.message}${known}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, findTranscript, renderClaudeLine };
