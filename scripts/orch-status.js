#!/usr/bin/env node
// orch-status.js — one-command, READ-ONLY overview of every orchestration wave/agent
// for a root (any repo). Summary = the assignment table (who runs what, leader vs
// worker, freshness, pending intent); --tail renders the last bounded events of one
// agent (codex or claude); --discover sweeps every repo under $HOME with an .orch-run.
// It writes nothing. State files are untrusted — see orch-status-read.js for the
// validation/scope-checking the row layer applies.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTarget, sanitizeControl } = require('./orch-forensics-map');
const { tailCodex, tailClaude, safeWithin } = require('./orch-status-tail');
const { trunc, kb, clock, isoClock, orchStateFiles, maxMtime, readRun } = require('./orch-status-read');

const HOME = os.homedir();
const isOneDrive = (name) => name.startsWith('OneDrive'); // placeholder hydration can hang existsSync
const emit = (s) => process.stdout.write(sanitizeControl(s));

// Depth-1 sweep of $HOME for repos with an .orch-run (stat dirs only — cheap, <5s),
// skipping OneDrive, sorted by their newest state.json (the dir mtime never moves).
function discoverRepos(cwd) {
  const repos = [];
  let kids = [];
  try { kids = fs.readdirSync(HOME); } catch { /* none */ }
  for (const name of kids) {
    if (isOneDrive(name)) continue;
    const dir = path.join(HOME, name);
    try {
      if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, '.orch-run'))) repos.push(dir);
    } catch (e) { process.stderr.write(`discover: skip ${name} (${e.code || e.message})\n`); }
  }
  if (cwd && !cwd.startsWith(HOME + path.sep) && fs.existsSync(path.join(cwd, '.orch-run')) && !repos.includes(cwd)) repos.push(cwd);
  return repos.map((r) => ({ r, m: maxMtime(orchStateFiles(r)) })).sort((a, b) => b.m - a.m).map((x) => x.r);
}

function mkErr(message, code) { const e = new Error(message); e.code = code || 'RESOLVE'; return e; }

// Resolve a target (optional) to state.json paths + a repo root (for --tail). Order:
// absolute path → bare wave under cwd → bare repo under $HOME → cross-repo wave (F1:
// e.g. `gantt-sync` lives in govoff while we stand in this repo) → else throw.
function resolveTargetPaths(arg, cwd) {
  if (!arg) return { statePaths: orchStateFiles(cwd), root: cwd, note: '' };
  const looksPath = path.isAbsolute(arg) || arg.includes('/') || arg.includes('\\') || arg.endsWith('.json');
  if (looksPath) {
    const p = path.resolve(cwd, arg);
    let st; try { st = fs.statSync(p); } catch { throw mkErr(`không tìm thấy đường dẫn: ${p}`, 'UNKNOWN'); }
    if (st.isFile()) return { statePaths: [p], root: path.dirname(p), note: '' };
    if (fs.existsSync(path.join(p, 'state.json'))) return { statePaths: [path.join(p, 'state.json')], root: p, note: '' };
    if (fs.existsSync(path.join(p, '.orch-run'))) return { statePaths: orchStateFiles(p), root: p, note: '' };
    if (path.basename(p) === '.orch-run') return { statePaths: orchStateFiles(path.dirname(p)), root: path.dirname(p), note: '' };
    throw mkErr(`không có state.json hay .orch-run trong: ${p}`, 'UNKNOWN');
  }
  const waveCwd = path.join(cwd, '.orch-run', arg, 'state.json');
  if (fs.existsSync(waveCwd)) return { statePaths: [waveCwd], root: cwd, note: `resolved → ${path.join(cwd, '.orch-run', arg)}` };
  const repo = path.join(HOME, arg);
  if (fs.existsSync(path.join(repo, '.orch-run'))) return { statePaths: orchStateFiles(repo), root: repo, note: `resolved → repo ${repo}` };
  const hits = [];
  for (const r of discoverRepos(cwd)) {
    const f = path.join(r, '.orch-run', arg, 'state.json');
    if (fs.existsSync(f)) hits.push({ r, f });
  }
  if (hits.length === 1) return { statePaths: [hits[0].f], root: hits[0].r, note: `resolved → ${path.basename(hits[0].r)}/${arg}` };
  if (hits.length > 1) throw mkErr(`'${arg}' khớp nhiều repo:\n` + hits.map((h) => '  ' + h.f).join('\n'), 'AMBIGUOUS');
  throw mkErr(`không resolve được target '${arg}'. Thử: tên wave dưới .orch-run, tên repo trong ${HOME}, đường dẫn tuyệt đối, hoặc --discover.`, 'UNKNOWN');
}

function fmtRow(ag) {
  if (ag.error) return `${ag.id} | ⚠ agent unreadable (${trunc(ag.error, 60)})`;
  const cols = [ag.id, trunc(ag.label || '-', 32), ag.engine, ag.tier,
    ag.status + (ag.flags.length ? ' ' + ag.flags.join(',') : ''),
    'd' + (ag.depth == null ? '-' : ag.depth), `${isoClock(ag.startedAt)}→${isoClock(ag.finishedAt)}`];
  const extra = [];
  if (ag.outBytes != null) extra.push(`out=${kb(ag.outBytes)}@${clock(ag.outMtime)}`);
  if (ag.resultStatus) extra.push(`result=${ag.resultStatus}`);
  if (ag.sid) extra.push(`sid=${ag.sid}`);
  return cols.join(' | ') + (extra.length ? '  ' + extra.join(' ') : '');
}

function printSummary(runs, note) {
  if (note) emit(note + '\n');
  if (!runs.length) { emit('(không tìm thấy .orch-run nào)\n'); return; }
  for (const r of runs.slice().sort((a, b) => b.mtime - a.mtime)) {
    emit(`▍ ${r.name}  (${r.statePath})` + (r.intentPending ? `  [intent chờ: ${r.intentPending}]` : '') + '\n');
    if (!r.ok) { emit(`  ⚠ state unreadable (${trunc(r.error, 80)})\n`); continue; }
    if (!r.agents.length) { emit('  (no agents)\n'); continue; }
    for (const ag of r.agents) emit('  ' + fmtRow(ag) + '\n');
  }
}

function runDiscover(cwd, now, json) {
  const repos = discoverRepos(cwd);
  if (json) { emit(JSON.stringify({ discover: repos.map((r) => ({ repo: r, runs: orchStateFiles(r).map((s) => readRun(s, now)) })) }, null, 2) + '\n'); return; }
  if (!repos.length) { emit(`(không phát hiện repo nào có .orch-run dưới ${HOME})\n`); return; }
  for (const r of repos) { emit(`\n=== ${r} ===\n`); printSummary(orchStateFiles(r).map((s) => readRun(s, now)), ''); }
}

function runTail(target, opts) {
  const ro = target.statePaths.length === 1 ? { state: target.statePaths[0] } : { root: target.root };
  let resolved;
  try { resolved = resolveTarget(opts.tail, ro); }
  catch (e) { process.stderr.write(e.message + (e.knownAgents && e.knownAgents.length ? `\nĐã biết:\n  ${e.knownAgents.join('\n  ')}` : '') + '\n'); process.exit(2); }
  if (resolved.warning) process.stderr.write(resolved.warning + '\n');
  const entry = resolved.entry;
  if (entry.engine === 'codex') tailCodex(entry.forensicsPath, opts);
  else tailClaude(entry, opts, safeWithin(entry.orchDir, path.basename(entry.forensicsPath || `agent-${entry.agentId}-result.md`)));
}

function parseArgs(argv) {
  const o = { n: 40, noColor: false, json: false, discover: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tail') o.tail = argv[++i];
    else if (a === '-n' || a === '--n') o.n = Math.max(1, parseInt(argv[++i], 10) || 40);
    else if (a === '--json') o.json = true;
    else if (a === '--discover') o.discover = true;
    else if (a === '--no-color') o.noColor = true;
    else if (a === '--state') o.target = argv[++i];
    else if (!a.startsWith('-') && o.target == null) o.target = a;
    else process.stderr.write(`(bỏ qua arg lạ: ${a})\n`);
  }
  return o;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const now = Date.now();
  if (opts.discover) return runDiscover(cwd, now, opts.json);
  let target;
  try { target = resolveTargetPaths(opts.target, cwd); }
  catch (e) { process.stderr.write(e.message + '\n'); process.exit(2); }
  if (opts.tail) return runTail(target, opts);
  const runs = target.statePaths.map((s) => readRun(s, now));
  if (opts.json) { emit(JSON.stringify({ note: target.note, runs }, null, 2) + '\n'); return; }
  printSummary(runs, target.note);
}

if (require.main === module) main();

module.exports = { resolveTargetPaths, discoverRepos };
