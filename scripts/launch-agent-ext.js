#!/usr/bin/env node
// Fork of the plugin launcher. Adds Codex beside claude/opencode.
// Engine order: --engine flag, WMUX_AGENT_CMD, then claude.
// Codex keeps raw JSONL for forensics but renders compact pane output.
// Usage: node launch-agent-ext.js <prompt-file> [--engine claude|opencode|codex] [--model id] [--effort low|medium|high|xhigh|max]

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const USAGE = 'Usage: node launch-agent-ext.js <prompt-file> [--engine claude|opencode|codex] [--model id] [--effort low|medium|high|xhigh|max]';
const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8[1m]';
const DEFAULT_CLAUDE_EFFORT = 'max';

if (require.main === module) main();

function main() {
  const argv = process.argv.slice(2);
  let promptFile = null, engineFlag = null, modelFlag = null, effortFlag = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--engine') engineFlag = (argv[++i] || '').toLowerCase();
    else if (argv[i] === '--model') modelFlag = argv[++i] || '';
    else if (argv[i] === '--effort') effortFlag = argv[++i] || '';
    else if (!promptFile) promptFile = argv[i];
  }
  if (!promptFile) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!fs.existsSync(promptFile)) {
    console.error(`Prompt file not found: ${promptFile}`);
    console.error(USAGE);
    process.exit(1);
  }
  const prompt = fs.readFileSync(promptFile, 'utf8');
  if (!prompt.trim()) {
    console.error(`Prompt file is empty: ${promptFile}`);
    process.exit(1);
  }
  const engine = engineFlag || (process.env.WMUX_AGENT_CMD || 'claude').toLowerCase();

  if (engine === 'codex') {
    runCodex(prompt, promptFile);
  } else if (engine === 'opencode') {
    try {
      execFileSync('opencode', ['run', '--', prompt], { stdio: 'inherit' });
    } catch (e) { process.exit(e.status || 1); }
  } else {
    const model = modelFlag || DEFAULT_CLAUDE_MODEL;
    const effort = effortFlag || DEFAULT_CLAUDE_EFFORT;
    const args = ['--dangerously-skip-permissions', '--model', model, '--effort', effort, '--', prompt];
    try {
      execFileSync('claude', args, { stdio: 'inherit' });
    } catch (e) { process.exit(e.status || 1); }
  }
}

function createCodexRenderer(options = {}) {
  const write = options.write || ((s) => process.stdout.write(s));
  const rawEcho = options.rawEcho ?? (process.env.WORKER_RAW_ECHO === '1');
  const C = (code, s) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`);
  const noColor = !!options.noColor;
  const dim = s => C('2', s), cyan = s => C('36', s), green = s => C('32', s);
  const red = s => C('31', s), yellow = s => C('33', s), bold = s => C('1', s);
  const mag = s => C('35', s), lines = (...xs) => xs.filter(Boolean);
  const firstLine = s => String(s ?? '').split(/\r?\n/).find(Boolean) || '';
  const trunc = (s, n) => (s = String(s ?? '')).length > n ? s.slice(0, n - 1) + '…' : s;
  let buffer = '', raw = rawEcho;
  const cleanCommand = (command) => {
    let s = firstLine(command).trim();
    const m = s.match(/^"[^"]*powershell(?:\.exe)?"\s+-Command\s+([\s\S]*)$/i)
      || s.match(/^powershell(?:\.exe)?\s+-Command\s+([\s\S]*)$/i);
    if (m) s = m[1].trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
    return trunc(s, 110);
  };
  const renderResult = (text) => {
    const j = JSON.parse(text);
    if (!j || (!j.status && !j.decisions && !j.remaining)) return null;
    const head = lines(
      j.status && `status=${j.status}`,
      Array.isArray(j.filesChanged) && `files=${j.filesChanged.length}`,
      Array.isArray(j.decisions) && `decisions=${j.decisions.length}`,
      Array.isArray(j.remaining) && j.remaining.length && `remaining=${j.remaining.length}`,
    ).join(' ');
    return [
      mag('▣ result ') + bold(head),
      ...(j.decisions || []).map(x => dim('  decision · ') + trunc(x, 140)),
      ...(j.remaining || []).map(x => dim('  remaining · ') + trunc(x, 140)),
    ];
  };
  const renderEvent = (o) => {
    if (o.type === 'thread.started') return [dim(`── codex session ${trunc(o.thread_id, 24)} ──`)];
    if (o.type === 'turn.completed') {
      const u = o.usage || {};
      const tok = lines(u.input_tokens && `in ${u.input_tokens}`, u.cached_input_tokens && `cached ${u.cached_input_tokens}`,
        u.output_tokens && `out ${u.output_tokens}`, u.reasoning_output_tokens && `reasoning ${u.reasoning_output_tokens}`).join(' · ');
      return [dim(`── turn done${tok ? ' · ' + tok : ''} ──`)];
    }
    const it = o.item; if (!it || o.type === 'turn.started') return [];
    const kind = it.type || it.item_type;
    if (kind === 'command_execution') {
      if (o.type === 'item.started') return [cyan('$ ') + cleanCommand(it.command)];
      const code = it.exit_code;
      const tag = code === 0 ? green('✓') : red(`✗ exit ${code}`);
      const out1 = firstLine(it.aggregated_output);
      return [`  ${tag}${out1 ? dim(' · ' + trunc(out1, code === 0 ? 90 : 120)) : ''}`];
    }
    if (kind === 'file_change') {
      const ch = (it.changes || []).map(c => `${c.kind} ${trunc(c.path || '', 80)}`).join(', ');
      return [yellow('✎ ') + ch + (o.type === 'item.started' ? dim(' …') : green(' ✓'))];
    }
    if (kind === 'agent_message' && o.type === 'item.completed') {
      try {
        const result = renderResult(it.text || '');
        if (result) return result;
      } catch { /* prose message */ }
      return [mag('🗨 ') + trunc(String(it.text || '').replace(/\s+/g, ' '), 120)];
    }
    return [];
  };
  const renderLine = (line) => {
    if (!line) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      write(line + '\n');
      return;
    }
    for (const item of renderEvent(parsed)) write(item + '\n');
  };
  return {
    write(chunk) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (raw) return write(text);
      try {
        buffer += text;
        const complete = buffer.split(/\r?\n/);
        buffer = complete.pop() || '';
        for (const line of complete) renderLine(line);
      } catch {
        raw = true;
        if (buffer) write(buffer);
        buffer = '';
      }
    },
    end() {
      if (!buffer) return;
      write(buffer);
      buffer = '';
    },
  };
}

function runCodex(promptText, promptFilePath) {
  const dir = path.dirname(promptFilePath);
  const base = path.basename(promptFilePath)
    .replace(/-prompt\.md$/i, '')
    .replace(/\.[^.]+$/, '');
  const resultFile = path.join(dir, `${base}-result.json`);
  const jsonlFile = path.join(dir, `${base}-out.jsonl`);
  const schemaFile = path.join(__dirname, 'codex-result-schema.json');
  const cwd = process.cwd();

  const args = [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
    '-C', cwd,
    '-o', resultFile,
  ];
  if (fs.existsSync(schemaFile)) {
    args.push('--output-schema', schemaFile);
  }
  args.push('--json', '--', promptText);

  const out = fs.createWriteStream(jsonlFile);
  const child = spawn('codex', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  let exited = false;
  const renderer = createCodexRenderer();
  const finish = (code) => {
    if (exited) return;
    exited = true;
    renderer.end();
    out.end(() => process.exit(code == null ? 1 : code));
  };
  child.stdout.on('data', (chunk) => {
    out.write(chunk);
    renderer.write(chunk);
  });
  child.on('error', (e) => {
    console.error(`Failed to launch codex: ${e.message}`);
    finish(127);
  });
  child.on('close', (code) => finish(code));
}

module.exports = { createCodexRenderer };
