#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'close-pane-with-log.js');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
}

function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'close-pane-'));
  const orch = path.join(dir, '.orch-run', 'w');
  fs.mkdirSync(orch, { recursive: true });
  return { dir, orch, log: path.join(dir, 'wmux.log'), reap: path.join(dir, 'reap.json') };
}
function agent(id, status = 'completed', extra = {}) {
  return { id, paneId: `pane-${id}`, surfaceId: `surf-${id}`, wmuxAgentId: `wmux-${id}`, engine: 'claude', status, resultFile: path.join('.orch-run', 'w', `agent-${id}-result.md`), ...extra };
}
function state(t, agents) {
  writeJson(path.join(t.orch, 'state.json'), { waves: [{ agents }] });
  for (const a of agents) {
    const file = path.join(t.dir, a.resultFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `ok\n${a.secret || ''}\n`);
  }
}
function fakeTools(t) {
const wmux = path.join(t.dir, 'fake-wmux.js');
  fs.writeFileSync(wmux, `
const fs=require('fs'); const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(t.log)}, args.join(' ')+'\\n');
if(args[0]==='list-surfaces') { if(fs.existsSync(${JSON.stringify(path.join(t.dir, 'no-list-surfaces'))})) process.exit(7); console.log(JSON.stringify({surfaces:[{id:process.env.WMUX_SURFACE_ID,paneId:'pane-live'}]})); }
else if(args[0]==='tree') {
  if(fs.existsSync(${JSON.stringify(path.join(t.dir, 'no-list-surfaces'))})) console.log(JSON.stringify({tree:{type:'leaf',paneId:'pane-live',surfaces:[{id:process.env.WMUX_SURFACE_ID},{id:'surf-a'}]}}));
  else console.log(JSON.stringify({surfaces: fs.existsSync(${JSON.stringify(path.join(t.dir, 'closed'))}) ? [] : [{id:'surf-a',paneId:'pane-a'}]}));
}
else if(args[0]==='close-pane') { fs.writeFileSync(${JSON.stringify(path.join(t.dir, 'closed'))}, '1'); if(fs.existsSync(${JSON.stringify(path.join(t.dir, 'close-fails'))})) process.exit(9); }
else console.log('{}');
`);
  const reaperJs = path.join(t.dir, 'reaper.js');
  fs.writeFileSync(reaperJs, `
const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync(${JSON.stringify(t.reap)},'utf8'));
fs.appendFileSync(${JSON.stringify(t.log)}, 'REAPER '+process.argv.slice(2).join(' ')+'\\n');
if(cfg.requireGate && !process.argv.includes('-OrchestratorPane')) { console.error('missing orchestrator pane gate'); process.exit(3); }
if(process.argv.includes('-TargetPid')) { const pid=Number(process.argv[process.argv.indexOf('-TargetPid')+1]); cfg.calls=(cfg.calls||0)+1; fs.writeFileSync(${JSON.stringify(t.reap)}, JSON.stringify(cfg)); console.log(JSON.stringify(cfg.killOk&&cfg.calls>=cfg.killAfter?{killed:[pid],failed:[]}:{killed:[],failed:[pid]})); }
else console.log(JSON.stringify({shells:cfg.shells||[{pid:1234,sid:'surf-a',reason:'live'}]}));
`);
  if (!fs.existsSync(t.reap)) writeJson(t.reap, { killOk: true, killAfter: 1, shells: [{ pid: 1234, sid: 'surf-a', reason: 'live' }] });
  return { wmux, env: { ...process.env, CLOSE_PANE_REAPER_NODE: reaperJs, CLOSE_PANE_REAPER: 'stub.ps1', WMUX_SURFACE_ID: 'surf-orch' } };
}
function run(t, args, envExtra = {}) {
  const tools = fakeTools(t);
  return spawnSync(process.execPath, [SCRIPT, ...args, '--wmux-cli', tools.wmux], { cwd: t.dir, encoding: 'utf8', env: { ...tools.env, ...envExtra } });
}

console.log('\n[close-pane-with-log]');
{
  const t = mk(); state(t, [agent('dup')]); writeJson(path.join(t.dir, '.orch-run', 'x', 'state.json'), { waves: [{ agents: [agent('dup')] }] });
  const r = run(t, ['dup', '--ts', 't1']);
  check('F2 strict aborts duplicate agentId', r.status !== 0 && /exists in 2 runs/.test(r.stderr), r.stderr);
}
{
  const t = mk(); state(t, [agent('a', 'running')]);
  let r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1']);
  check('F7 refuses running without force', r.status !== 0 && /REFUSE/.test(r.stderr), r.stderr);
  r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1', '--force']);
  check('F7 force continues with mark warning', r.status === 0 && /PAI|PHAI/.test(r.stderr), r.stderr);
}
{
  const t = mk(); state(t, [agent('a')]);
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1']);
  const log = fs.existsSync(t.log) ? fs.readFileSync(t.log, 'utf8') : '';
  check('dry-run writes snapshot', r.status === 0 && fs.existsSync(path.join(t.orch, 'closed-pane-a-t1.md')), r.stderr);
  check('dry-run does not close or agent-kill', !/close-pane|agent kill/.test(log), log);
}
{
  const t = mk(); state(t, [agent('a')]); writeJson(t.reap, { requireGate: true, killOk: true, killAfter: 1, shells: [{ pid: 1234, sid: 'surf-a', reason: 'live' }] });
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1']);
  const log = fs.readFileSync(t.log, 'utf8');
  check('listing reaper gets OrchestratorPane gate', r.status === 0 && /REAPER -File stub\.ps1 -OrchestratorPane pane-live/.test(log), log + r.stderr);
  check('resolve live pane before shell pid listing', /list-surfaces[\s\S]*REAPER -File stub\.ps1 -OrchestratorPane pane-live/.test(log), log);
}
{
  const t = mk(); state(t, [agent('a')]); fs.writeFileSync(path.join(t.dir, 'no-list-surfaces'), '1');
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1']);
  check('tree fallback resolves pane from leaf surfaces', r.status === 0 && JSON.parse(r.stdout).paneLive === 'pane-live', r.stderr || r.stdout);
}
{
  const t = mk(); state(t, [agent('a')]); writeJson(t.reap, { killOk: true, killAfter: 1, shells: [{ pid: 0, sid: 'surf-a', reason: 'bad' }, { pid: 1234, sid: 'surf-a', reason: 'live' }] });
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1']);
  check('resolveShellPid ignores non-positive pid', r.status === 0 && JSON.parse(r.stdout).pid === 1234, r.stderr || r.stdout);
}
{
  const t = mk(); state(t, [agent('a')]);
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1', '--confirm']);
  const log = fs.readFileSync(t.log, 'utf8');
  check('--confirm succeeds when reaper killed[] includes pid', r.status === 0, r.stderr);
  check('F9 order agent-kill then close-pane then reap', /agent kill wmux-a[\s\S]*close-pane pane-a[\s\S]*REAPER/.test(log), log);
  check('reaper gets TargetPid MinOrphanAgeMin OrchestratorPane', /-TargetPid 1234[\s\S]*-MinOrphanAgeMin 0[\s\S]*-OrchestratorPane pane-live/.test(log), log);
}
{
  const t = mk(); state(t, [agent('a')]); fs.writeFileSync(path.join(t.dir, 'close-fails'), '1');
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1', '--confirm']);
  const log = fs.readFileSync(t.log, 'utf8');
  check('close-pane failure still polls and reaps', r.status === 0 && /close-pane pane-a[\s\S]*tree[\s\S]*REAPER/.test(log) && /close-pane failed; continuing reap/.test(r.stderr), log + r.stderr);
}
{
  const t = mk(); state(t, [agent('a')]); fakeTools(t); writeJson(t.reap, { killOk: false, killAfter: 9, shells: [{ pid: 999999, sid: 'surf-a', reason: 'dead' }] });
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1', '--confirm']);
  const cfg = JSON.parse(fs.readFileSync(t.reap, 'utf8'));
  check('pid already dead after close-pane is success without retry', r.status === 0 && cfg.calls === 1 && /no reap needed/.test(r.stderr), r.stderr);
}
{
  const t = mk(); state(t, [agent('a')]); fakeTools(t); writeJson(t.reap, { killOk: false, killAfter: 9, shells: [{ pid: process.pid, sid: 'surf-a', reason: 'live' }] });
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1', '--confirm']);
  const cfg = JSON.parse(fs.readFileSync(t.reap, 'utf8'));
  check('F8 failed kill retries once then exits non-zero', r.status !== 0 && cfg.calls === 2 && /reap failed/.test(r.stderr), r.stderr);
}
{
  const t = mk(); state(t, [agent('a', 'completed')]);
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1', '--force']);
  check('force warning only for running or pending', r.status === 0 && !/WARNING:/.test(r.stderr), r.stderr);
}
{
  const t = mk(); state(t, [agent('..\\x')]);
  writeJson(t.reap, { killOk: true, killAfter: 1, shells: [{ pid: 1234, sid: 'surf-..\\x', reason: 'live' }] });
  const r = run(t, ['..\\x', '--state', path.join(t.orch, 'state.json'), '--ts', 't1']);
  check('F11 rejects path traversal agentId', r.status !== 0 && /ten file/.test(r.stderr), r.stderr);
}
{
  const t = mk(); state(t, [agent('a', 'completed', { secret: 'api_key=SECRET123' })]);
  fs.appendFileSync(path.join(t.dir, '.orch-run', 'w', 'agent-a-result.md'), '\x1b]52;c;BAD\x07\x1b[31mred\n');
  const r = run(t, ['a', '--state', path.join(t.orch, 'state.json'), '--ts', 't1']);
  const out = fs.readFileSync(path.join(t.orch, 'closed-pane-a-t1.md'), 'utf8');
  check('F12 redacts secret line', r.status === 0 && out.includes('[REDACTED - scan-secrets: API key]'), out);
  check('F6 strips OSC/CSI controls', !out.includes('\x1b') && !out.includes(']52'), out);
}

console.log(`\nRESULT: ${pass} PASS ${fail} FAIL`);
if (fail) process.exit(1);
