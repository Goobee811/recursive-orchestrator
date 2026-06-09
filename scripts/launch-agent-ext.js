#!/usr/bin/env node
// launch-agent-ext.js — fork of the plugin's launch-agent.js (DO NOT edit the
// upstream file in place). Adds a third engine, `codex`, beside claude/opencode.
//
// Engine is resolved in priority order:
//   1. CLI flag  --engine <name>   — used when spawned via `wmux agent spawn`,
//        which CANNOT pass env vars to the pane process, so the engine must
//        travel inside the --cmd string itself.
//   2. env WMUX_AGENT_CMD          — upstream plugin mechanism; kept compatible
//        for local runs / opencode selection.
//   3. default `claude`.
//
// claude/opencode branches are byte-for-byte the upstream behaviour (interactive
// TUI via execFileSync + '--' separator). Codex runs headless: structured output
// via --output-schema/-o plus a tee'd --json JSONL log for forensics (H7: codex
// only writes -o as the last message and may die before it does).
//
// Usage: node launch-agent-ext.js <prompt-file> [--engine claude|opencode|codex]

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- arg parse: first positional = prompt file, --engine <name> optional ---
const argv = process.argv.slice(2);
let promptFile = null;
let engineFlag = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--engine') {
    engineFlag = (argv[++i] || '').toLowerCase();
  } else if (!promptFile) {
    promptFile = argv[i];
  }
}

if (!promptFile) {
  console.error('Usage: node launch-agent-ext.js <prompt-file> [--engine claude|opencode|codex]');
  process.exit(1);
}
if (!fs.existsSync(promptFile)) {
  console.error(`Prompt file not found: ${promptFile}`);
  process.exit(1);
}

const prompt = fs.readFileSync(promptFile, 'utf8');
if (!prompt.trim()) {
  // An empty prompt would launch a worker with no instructions — a wasted
  // subscription spawn. Fail loud instead.
  console.error(`Prompt file is empty: ${promptFile}`);
  process.exit(1);
}
const engine = engineFlag || (process.env.WMUX_AGENT_CMD || 'claude').toLowerCase();

if (engine === 'codex') {
  runCodex(prompt, promptFile);
} else if (engine === 'opencode') {
  // opencode run streams formatted progress; the user can watch.
  try {
    execFileSync('opencode', ['run', '--', prompt], { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
} else {
  // --dangerously-skip-permissions: auto-approve all tools (interactive mode)
  // '--' stops Commander.js variadic flags from consuming the prompt
  // NOTE: do NOT use --bare — it skips keychain/OAuth and causes "Not logged in"
  try {
    execFileSync('claude', ['--dangerously-skip-permissions', '--', prompt], { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
}

// --- codex headless engine -------------------------------------------------
function runCodex(promptText, promptFilePath) {
  // Derive sibling output paths so the orchestrator finds them deterministically.
  // Plugin names prompts `agent-<id>-prompt.md`; map to `-result.json` / `-out.jsonl`.
  // Any other name falls back to `<base>-result.json` / `<base>-out.jsonl`.
  const dir = path.dirname(promptFilePath);
  const base = path.basename(promptFilePath)
    .replace(/-prompt\.md$/i, '')
    .replace(/\.[^.]+$/, '');
  const resultFile = path.join(dir, `${base}-result.json`);
  const jsonlFile = path.join(dir, `${base}-out.jsonl`);
  const schemaFile = path.join(__dirname, 'codex-result-schema.json');
  // Pane process cwd is set by `wmux agent spawn --cwd`, so process.cwd() is the
  // worker's working root. codex -C makes that explicit.
  const cwd = process.cwd();

  const args = [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox', // full bypass (user-chosen; safety layers in Phase 6)
    '--skip-git-repo-check',                       // worker cwd may be non-git
    '-C', cwd,
    '-o', resultFile,                              // last agent message (schema-shaped JSON)
  ];
  if (fs.existsSync(schemaFile)) {
    args.push('--output-schema', schemaFile);      // force final message to conform to schema
  }
  args.push('--json', '--', promptText);           // JSONL events on stdout; '--' guards the prompt

  // Tee stdout: persist every JSONL line to jsonlFile (forensics even if codex
  // exits non-zero before -o is written) AND echo to the pane so the user watches.
  // stdin='ignore' (not 'inherit'): codex reads stdin to append a <stdin> block
  // whenever stdin is not a TTY; an inherited-but-open pipe never hits EOF, so
  // codex would hang forever. The prompt already travels as the trailing arg.
  const out = fs.createWriteStream(jsonlFile);
  const child = spawn('codex', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  // Exit exactly once, and only after the jsonl stream fully flushes: spawn
  // ENOENT can fire both 'error' and 'close', and a bare process.exit() may drop
  // un-flushed writes — but the forensic log must be complete even if codex dies.
  let exited = false;
  const finish = (code) => {
    if (exited) return;
    exited = true;
    out.end(() => process.exit(code == null ? 1 : code));
  };
  child.stdout.on('data', (chunk) => {
    out.write(chunk);
    process.stdout.write(chunk);
  });
  child.on('error', (e) => {
    console.error(`Failed to launch codex: ${e.message}`);
    finish(127);
  });
  child.on('close', (code) => finish(code));
}
