#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createCodexRenderer } = require('./launch-agent-ext');
const { resolveTarget, sanitizeControl } = require('./orch-forensics-map');
const { scanText } = require('./scan-secrets');

const SAFE = /^[A-Za-z0-9._-]+$/;

function parseArgs(argv) {
  const out = { confirm: false, force: false, noColor: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--force') out.force = true;
    else if (a === '--no-color') out.noColor = true;
    else if (['--state', '--ts', '--orchestrator-pane', '--wmux-cli'].includes(a)) out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else if (!out.target) out.target = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.target) throw new Error('usage: close-pane-with-log.js <paneId|agentId> [--state <path>] [--ts <token>] [--confirm] [--force] [--orchestrator-pane <id>] [--wmux-cli <path>]');
  out.ts = out.ts || new Date().toISOString().replace(/[:.]/g, '-');
  out.wmuxCli = out.wmuxCli || process.env.WMUX_CLI || 'C:\\Users\\Bee\\wmux\\resources\\cli\\wmux.js';
  return out;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }

function findAgent(statePath, entry) {
  for (const wave of readJson(statePath).waves || []) {
    for (const agent of wave.agents || []) {
      if (agent.id === entry.agentId && (!entry.paneId || agent.paneId === entry.paneId)) return agent;
    }
  }
  return {};
}

function runJson(cmd, args, opts = {}) {
  const text = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON output from ${cmd}`);
  return JSON.parse(text.slice(start));
}

function runReaperJson(args) {
  // Test-only hook: lets spike tests exercise close/reap behavior without touching real shells.
  if (process.env.CLOSE_PANE_REAPER_NODE) return runJson(process.execPath, [process.env.CLOSE_PANE_REAPER_NODE, ...args]);
  const ps = process.env.CLOSE_PANE_POWERSHELL || 'powershell';
  return runJson(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args]);
}

function resolveShellPid(surfaceId, paneLive) {
  const reaper = process.env.CLOSE_PANE_REAPER || path.join(__dirname, 'reap-orphan-shells.ps1');
  const json = runReaperJson(['-File', reaper, '-OrchestratorPane', paneLive]);
  const hits = (json.shells || []).filter((s) => s && s.sid === surfaceId && Number.isInteger(Number(s.pid)) && Number(s.pid) > 0);
  if (hits.length !== 1) throw new Error(`khong xac dinh duoc dung 1 pid cho surface ${surfaceId} (found ${hits.length})`);
  return Number(hits[0].pid);
}

function hasSurface(node, surfaceId) {
  if (node == null) return false;
  if (typeof node === 'string') return node.includes(surfaceId);
  if (Array.isArray(node)) return node.some((x) => hasSurface(x, surfaceId));
  if (typeof node === 'object') return Object.values(node).some((x) => hasSurface(x, surfaceId));
  return false;
}

function findSurface(node, surfaceId) {
  if (!node || typeof node !== 'object') return null;
  if (node.paneId && Array.isArray(node.surfaces) && node.surfaces.some((s) => s && (s.id === surfaceId || s.surfaceId === surfaceId))) return node;
  if (node.id === surfaceId || node.surfaceId === surfaceId) return node;
  for (const v of Object.values(node)) {
    const hit = Array.isArray(v) ? v.map((x) => findSurface(x, surfaceId)).find(Boolean) : findSurface(v, surfaceId);
    if (hit) return hit;
  }
  return null;
}

function resolveOrchestratorPane(opts) {
  if (opts.orchestratorPane) return opts.orchestratorPane;
  const sid = process.env.WMUX_SURFACE_ID;
  if (!sid) throw new Error('khong co WMUX_SURFACE_ID; truyen --orchestrator-pane <paneId>');
  try {
    const listed = runJson('node', [opts.wmuxCli, 'list-surfaces']);
    const hit = (listed.surfaces || []).find((s) => s.id === sid || s.surfaceId === sid);
    if (hit && hit.paneId) return hit.paneId;
  } catch { /* fall back to tree */ }
  const tree = runJson('node', [opts.wmuxCli, 'tree']);
  const hit = findSurface(tree, sid);
  if (hit && hit.paneId) return hit.paneId;
  throw new Error('khong resolve duoc pane LIVE; truyen --orchestrator-pane <paneId>');
}

function renderSnapshot(entry, agent, ts) {
  if (!SAFE.test(entry.agentId) || !SAFE.test(ts)) throw new Error('agentId/ts khong hop le cho ten file');
  const orchDir = path.resolve(entry.orchDir);
  const logPath = path.resolve(orchDir, `closed-pane-${entry.agentId}-${ts}.md`);
  if (!logPath.startsWith(orchDir + path.sep)) throw new Error('log path vuot ngoai orchDir');
  let body = '';
  let file = entry.forensicsPath || agent.resultFile;
  if ((!file || !fs.existsSync(file)) && agent.resultFile) file = path.resolve(process.cwd(), agent.resultFile);
  if (file && fs.existsSync(file)) {
    if ((entry.engine || agent.engine) === 'codex') {
      const renderer = createCodexRenderer({ noColor: true, write: (s) => { body += sanitizeControl(s); } });
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) if (line) renderer.write(Buffer.from(line + '\n'));
      renderer.end();
    } else {
      body = sanitizeControl(fs.readFileSync(file, 'utf8'));
    }
  } else {
    body = 'no forensics found\n';
  }
  const header = `# closed pane ${entry.agentId} @ ${ts}\n\npaneId: ${entry.paneId}\nsurfaceId: ${entry.surfaceId}\nengine: ${entry.engine || agent.engine || ''}\n\n`;
  const lines = sanitizeControl(header + body).split('\n');
  for (const finding of scanText(lines.join('\n'))) {
    if (finding.line > 0 && finding.line <= lines.length) lines[finding.line - 1] = `[REDACTED - scan-secrets: ${finding.label}]`;
  }
  fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
  return logPath;
}

function pollSurfaceGone(wmuxCli, surfaceId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if (!hasSurface(runJson('node', [wmuxCli, 'tree']), surfaceId)) return true; } catch { return true; }
    execFileSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500)']);
  }
  return false;
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

function reapAndVerify(pid, paneLive, retry = true) {
  const reaper = process.env.CLOSE_PANE_REAPER || path.join(__dirname, 'reap-orphan-shells.ps1');
  const args = ['-File', reaper, '-TargetPid', String(pid), '-MinOrphanAgeMin', '0', '-OrchestratorPane', paneLive];
  let summary = {};
  try { summary = runReaperJson(args); } catch (e) {
    const stderr = e.stderr ? Buffer.from(e.stderr).toString('utf8').trim() : '';
    summary = { error: [e.message, stderr].filter(Boolean).join('\n') };
  }
  if ((summary.killed || []).map(Number).includes(pid)) return summary;
  if (!isPidAlive(pid)) {
    process.stderr.write(`shell pid ${pid} already exited with pane close; no reap needed\n`);
    return { ...summary, noReapNeeded: true };
  }
  if (retry) {
    execFileSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000)']);
    return reapAndVerify(pid, paneLive, false);
  }
  const fix = `powershell -File scripts/reap-orphan-shells.ps1 -TargetPid ${pid} -MinOrphanAgeMin 0 -OrchestratorPane ${paneLive}`;
  const detail = summary.error ? `; detail: ${summary.error}` : '';
  throw new Error(`reap failed for pid ${pid}${detail}; run manually: ${fix}`);
}

function main(opts) {
  const { entry } = resolveTarget(opts.target, { strict: true, state: opts.state, root: process.cwd() });
  const agent = findAgent(entry.statePath, entry);
  Object.assign(entry, { wmuxAgentId: agent.wmuxAgentId, resultFile: agent.resultFile });
  if ((agent.status === 'running' || agent.status === 'pending') && !opts.force) throw new Error(`REFUSE: agent dang ${agent.status}; cho xong hoac dung --force.`);
  const paneLive = resolveOrchestratorPane(opts);
  if (opts.force && (agent.status === 'running' || agent.status === 'pending')) process.stderr.write(`WARNING: result se KHONG bao gio co; sau khi kill PHAI tu mark state: node scripts/crash-recovery.js detect --state ${entry.statePath} --wmux-cli ${opts.wmuxCli} --mark\n`);
  const pid = resolveShellPid(entry.surfaceId, paneLive);
  const logPath = renderSnapshot(entry, agent, opts.ts);
  if (!opts.confirm) return { status: 'dry-run', logPath, paneId: entry.paneId, wmuxAgentId: entry.wmuxAgentId, pid, paneLive };
  if (entry.wmuxAgentId) { try { execFileSync('node', [opts.wmuxCli, 'agent', 'kill', entry.wmuxAgentId], { encoding: 'utf8' }); } catch { /* best effort */ } }
  try {
    execFileSync('node', [opts.wmuxCli, 'close-pane', entry.paneId], { encoding: 'utf8' });
  } catch (e) {
    const stderr = e.stderr ? Buffer.from(e.stderr).toString('utf8').trim() : e.message;
    process.stderr.write(`warning: close-pane failed; continuing reap: ${stderr}\n`);
  }
  if (!pollSurfaceGone(opts.wmuxCli, entry.surfaceId)) {
    process.stderr.write(`warning: surface ${entry.surfaceId} still visible after close-pane; continuing reap\n`);
  }
  reapAndVerify(pid, paneLive, true);
  return { status: 'closed', logPath, paneId: entry.paneId, pid };
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(parseArgs(process.argv.slice(2))), null, 2) + '\n'); }
  catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1); }
}

module.exports = { parseArgs, main, renderSnapshot, resolveOrchestratorPane, resolveShellPid, reapAndVerify, isPidAlive };
