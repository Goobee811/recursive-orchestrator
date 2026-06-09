#!/usr/bin/env node
// scan-secrets.js — scan a spec / result / -o / JSONL file for leaked credentials
// BEFORE the orchestrator or a Leader reads it into a handoff. Workers run at full
// bypass and may echo an env var, a token, or a connection string into their result;
// that text must not flow downstream into an aggregated handoff (which gets committed
// and shared). A match quarantines the file from the read path and warns loudly.
//
// Patterns are the SAME set context-handoff already vets handoffs with, so this layer
// and the handoff tool agree on what a leak is. We load them from that skill when it is
// installed; otherwise we fall back to an in-repo copy so the scan still runs anywhere.
//
// Usage:
//   node scan-secrets.js <file...>                 # scan files; exit 1 if any leak
//   node scan-secrets.js --files a.md,b.json       # same, csv form
// Output (stdout JSON): { clean: bool, files: [{ file, findings:[{line,label}] }] }
// Exit: 0 = clean, 1 = at least one finding, 2 = bad usage / unreadable input.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// In-repo fallback — kept in lockstep with context-handoff/scripts/utils.js. Used only
// when that skill is absent, so the scan never silently no-ops on a fresh machine.
const FALLBACK_PATTERNS = [
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i, label: 'API key' },
  { pattern: /(?:password|passwd|secret)\s*[:=]\s*\S+/i, label: 'Password/Secret' },
  { pattern: /(?:token)\s*[:=]\s*['"][^'"]+['"]/i, label: 'Token value' },
  { pattern: /(?:mongodb|postgres|mysql):\/\/\S+/i, label: 'Database connection string' },
  { pattern: /AKIA[0-9A-Z]{16}/i, label: 'AWS Access Key' },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, label: 'SSH/Private key' },
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./i, label: 'JWT token' },
  { pattern: /ghp_[A-Za-z0-9]{36,}/i, label: 'GitHub Personal Access Token' },
  { pattern: /gho_[A-Za-z0-9]{36,}/i, label: 'GitHub OAuth Token' },
  { pattern: /xox[bp]-[A-Za-z0-9-]{10,}/i, label: 'Slack Token' },
  { pattern: /AIza[A-Za-z0-9_-]{35}/i, label: 'Google API Key' },
  { pattern: /sk_live_[A-Za-z0-9]{20,}/i, label: 'Stripe Secret Key' },
  { pattern: /sk-(?!ant-)[A-Za-z0-9]{40,}/i, label: 'OpenAI API Key' },
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/i, label: 'Anthropic API Key' },
  { pattern: /npm_[A-Za-z0-9]{36,}/i, label: 'npm Access Token' },
];

function loadPatterns() {
  try {
    const utilsPath = path.join(os.homedir(), '.claude', 'skills', 'context-handoff', 'scripts', 'utils.js');
    const utils = require(utilsPath);
    if (Array.isArray(utils.SENSITIVE_PATTERNS) && utils.SENSITIVE_PATTERNS.length) {
      return utils.SENSITIVE_PATTERNS;
    }
  } catch {
    /* skill not installed here — fall through to the bundled copy */
  }
  return FALLBACK_PATTERNS;
}

const SENSITIVE_PATTERNS = loadPatterns();

// Scan text line-by-line (cheap, gives line numbers, bounds any single regex to one
// line so a huge result can't ReDoS). Returns [{ line, label }]; never includes the
// matched secret itself — only where + what kind, so the report is safe to print/log.
function scanText(text) {
  const findings = [];
  const lines = String(text == null ? '' : text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { pattern, label } of SENSITIVE_PATTERNS) {
      if (pattern.test(lines[i])) findings.push({ line: i + 1, label });
    }
  }
  return findings;
}

function scanFile(file) {
  try {
    return { file, findings: scanText(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { file, error: e.message };
  }
}

function scanFiles(files) {
  return files.map(scanFile);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  let files = [];
  const fi = argv.indexOf('--files');
  if (fi !== -1 && fi + 1 < argv.length) {
    files = argv[fi + 1].split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    files = argv.filter((a) => !a.startsWith('--'));
  }
  if (files.length === 0) {
    process.stderr.write('Usage: node scan-secrets.js <file...>  |  --files a,b\n');
    process.exit(2);
  }

  const results = scanFiles(files);
  const unreadable = results.some((r) => r.error);
  const anyFinding = results.some((r) => r.findings && r.findings.length);
  process.stdout.write(JSON.stringify({ clean: !anyFinding && !unreadable, files: results }, null, 2) + '\n');
  if (unreadable) process.exit(2); // fail-safe: cannot prove a file is clean → block
  process.exit(anyFinding ? 1 : 0);
}

if (require.main === module) main();

module.exports = { scanText, scanFile, scanFiles, SENSITIVE_PATTERNS };
