#!/usr/bin/env node
// context-meter.js — tells a worker whether to keep going or hand off, per the
// user's 180k rule (<180k: do another unit; >=180k: hand off to the next worker).
//
// PRIMARY signal = work-units. The orchestrator budgets N units per worker; the
// worker reports unitsDone. Raw token counts CANNOT be primary: auto-compact
// rewrites the transcript and makes input token totals non-monotonic.
//
// Token count is only a SAFETY EJECT: if any single assistant turn's context
// window (input + cache_creation + cache_read — NOT input_tokens alone, which is
// just the uncached delta and never approaches 180k) exceeds the threshold, hand
// off regardless of units.
//
// FAIL-STATE is explicit "unknown": if the transcript can't be found, the token
// path goes dark but the worker still follows its unit budget verbatim — it never
// runs past budget (no fail-open) and never churns handoffs (no fail-closed).
//
// Usage:
//   node context-meter.js --session <sid> --units-done <n> --budget-units <m>
//                         [--transcript <path>] [--threshold 180000]
//
// Output (stdout JSON):
//   { unitsDone, budgetUnits, maxContextTokens, tokenSafety, decision, reason }
//   tokenSafety ∈ ok | eject | unknown
//   decision    ∈ continue | handoff | unknown

const fs = require('fs');
const os = require('os');
const path = require('path');

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const sessionId = getFlag('--session', process.env.CLAUDE_CODE_SESSION_ID || '');
const unitsDone = Math.max(0, parseInt(getFlag('--units-done', '0'), 10) || 0);
// No budget given → primary can never trigger; rely on the token eject alone.
const budgetUnits = parseInt(getFlag('--budget-units', ''), 10);
// Guard the falsy-zero trap: `parseInt('0') || 180000` would clobber an explicit
// 0 back to the default. Treat any non-positive/NaN threshold as "use default".
const thresholdRaw = parseInt(getFlag('--threshold', '180000'), 10);
const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 180000;
const transcriptArg = getFlag('--transcript', '');

// --- locate this worker's transcript --------------------------------------
// A session id is a UUID, unique across every project dir, so scan rather than
// reconstruct the project slug (which mangles the cwd in ways easy to get wrong).
function findTranscript() {
  if (transcriptArg && fs.existsSync(transcriptArg)) return transcriptArg;
  if (!sessionId) return null;
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsRoot)) return null;
  for (const proj of fs.readdirSync(projectsRoot)) {
    const candidate = path.join(projectsRoot, proj, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// --- max context-window size across assistant turns ------------------------
function maxContextTokens(transcriptPath) {
  let max = 0;
  let saw = false;
  const lines = fs.readFileSync(transcriptPath, 'utf8').replace(/^\uFEFF/, '').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const u = (entry.message && entry.message.usage) || entry.usage;
    if (!u || typeof u.input_tokens !== 'number') continue;
    saw = true;
    const ctx = (u.input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    if (ctx > max) max = ctx;
  }
  return saw ? max : null; // null → no usable usage entries
}

// --- decide ----------------------------------------------------------------
const transcriptPath = findTranscript();
let tokenSafety = 'unknown';
let ctxMax = null;
let tokenDarkReason = 'transcript not found';
if (transcriptPath) {
  try {
    ctxMax = maxContextTokens(transcriptPath);
    if (ctxMax !== null) {
      tokenSafety = ctxMax > threshold ? 'eject' : 'ok';
    } else {
      tokenDarkReason = 'transcript has no usable usage entries';
    }
  } catch {
    tokenSafety = 'unknown';
    tokenDarkReason = 'transcript unreadable';
  }
}

const hasBudget = Number.isFinite(budgetUnits) && budgetUnits > 0;

let decision, reason;
if (hasBudget && unitsDone >= budgetUnits) {
  decision = 'handoff';
  reason = `unit budget reached (${unitsDone}/${budgetUnits})`;
} else if (tokenSafety === 'eject') {
  decision = 'handoff';
  reason = `token safety eject: context ${ctxMax} > ${threshold}`;
} else if (tokenSafety === 'unknown') {
  // Transcript dark: do NOT fail-open (run forever) or fail-closed (churn).
  // Worker follows its unit budget verbatim and stops at budgetUnits.
  decision = 'unknown';
  reason = `${tokenDarkReason}; follow unit budget verbatim`;
} else {
  decision = 'continue';
  reason = hasBudget
    ? `within budget (${unitsDone}/${budgetUnits}) and context ${ctxMax} <= ${threshold}`
    : `context ${ctxMax} <= ${threshold} (no unit budget given)`;
}

process.stdout.write(JSON.stringify({
  unitsDone,
  budgetUnits: hasBudget ? budgetUnits : null,
  maxContextTokens: ctxMax,
  tokenSafety,
  decision,
  reason,
}) + '\n');
