<#
orchestrator-pass.ps1 — one monitor pass of the orchestrator driver loop.

This is the minimal glue that Phase 7 will grow into a polling daemon. The main
session (orchestrator, depth 0) runs ONE pass at a time, by hand at first, so we
can watch each stage before trusting a loop:

  1. reconcile-agents   — poll `wmux agent list`, move any tracked agent whose pane
                          process exited off 'running' (frees its concurrency slot +
                          closes its wave). wmux-spawned agents get no stop hook, so
                          this is the only path that closes their lifecycle.
  2. process-nested     — pick up pending nested-request-*.json (worker fan-out) and
                          spawn the children into panes on the orchestrator surface.
  3. chain-router       — pick up pending chain-request-*.json (180k continuation):
                          spawn the next link, or reverse-relay a finished thread to
                          its Leader. (-Chain to enable; the 5C dogfood needs it.)
  4. crash-recovery     — flag any 'running' agent that VANISHED from the live list
                          and went stale past the heartbeat window. -Mark frees its
                          slot (only ever with a live cross-check; never on time alone).

reconcile + crash-recovery need the live list, so they are skipped when -WmuxCli is
absent (pure offline -DryRun). process-nested / chain-router already reconcile at the
top of their own pass; running reconcile here too is idempotent and keeps the driver
correct even when no request is pending.

Usage:
  pwsh orchestrator-pass.ps1 -State <state.json> [-WmuxCli <path>] [-SafeWrapper <ps1>]
       [-Chain] [-Mark] [-HeartbeatMs 600000] [-DryRun]
#>
param(
  [Parameter(Mandatory = $true)] [string]$State,
  [string]$WmuxCli = $env:WMUX_CLI,
  [string]$SafeWrapper = "",
  [int]$HeartbeatMs = 600000,
  [int]$MaxDepth = 5,
  [int]$MaxConcurrent = 8,
  [string]$Cwd = (Get-Location).Path,
  [string]$RootPane = $env:WMUX_PANE_ID,
  [string]$Layout = "split",
  [switch]$Chain,
  [switch]$Mark,
  [switch]$HarvestKill,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$scripts = $PSScriptRoot
$node = "node"

function Invoke-Step {
  param([string]$Name, [string[]]$Argv)
  # node's JSON goes to stdout (success stream); let it flow straight to the console.
  # Do NOT pipe this function to Out-Null at the call site — that swallows the JSON too.
  Write-Host ("── {0} ──────────────────────────────" -f $Name) -ForegroundColor Cyan
  & $node @Argv
  if ($LASTEXITCODE -ne 0) { Write-Host ("  (exit {0})" -f $LASTEXITCODE) -ForegroundColor Yellow }
  Write-Host ""
}

Write-Host ("=== orchestrator pass @ {0} ===" -f (Get-Date -Format "HH:mm:ss")) -ForegroundColor Green
Write-Host ("state={0} wmux={1} chain={2} mark={3} dryRun={4}`n" -f $State, [bool]$WmuxCli, [bool]$Chain, [bool]$Mark, [bool]$DryRun)
if ([string]::IsNullOrWhiteSpace($RootPane)) {
  Write-Host "WARNING: RootPane is empty; split layout cannot anchor nested/chain panes unless an agent pane is available." -ForegroundColor Yellow
}

# 1. reconcile (pane-exit completion — keys on `wmux agent list` reading 'exited')
if ($WmuxCli) {
  Invoke-Step "1/5 reconcile-agents" @("$scripts/reconcile-agents.js", "--state", $State, "--wmux-cli", $WmuxCli)
} else {
  Write-Host "── 1/5 reconcile-agents — SKIP (no -WmuxCli) ──`n" -ForegroundColor DarkGray
}

# 1b. harvest-results (result-based completion — the path reconcile can't cover for a
# headless worker whose -NoExit pane never reads 'exited'). Closes the worker off its
# own result file; -HarvestKill reaps the idle pane via `agent kill`. Safe with no wmux.
$hv = @("$scripts/harvest-results.js", "--state", $State)
if ($WmuxCli)     { $hv += @("--wmux-cli", $WmuxCli) }
if ($HarvestKill) { $hv += "--kill" }
Invoke-Step "1b/5 harvest-results" $hv

# 2. process nested-request-*.json (fan-out)
$pn = @("$scripts/process-nested-requests.js", "--state", $State, "--max-depth", "$MaxDepth", "--max-concurrent", "$MaxConcurrent", "--cwd", $Cwd)
if ($WmuxCli)     { $pn += @("--wmux-cli", $WmuxCli) }
if ($SafeWrapper) { $pn += @("--safe-wrapper", $SafeWrapper) }
if ($RootPane)    { $pn += @("--root-pane", $RootPane) }
if ($Layout)      { $pn += @("--layout", $Layout) }
if ($DryRun)      { $pn += "--dry-run" }
Invoke-Step "2/5 process-nested-requests" $pn

# 3. chain-router (continuation 180k) — opt-in via -Chain
if ($Chain) {
  $cr = @("$scripts/chain-router.js", "--state", $State, "--max-concurrent", "$MaxConcurrent", "--cwd", $Cwd)
  if ($WmuxCli)     { $cr += @("--wmux-cli", $WmuxCli) }
  if ($SafeWrapper) { $cr += @("--safe-wrapper", $SafeWrapper) }
  if ($RootPane)    { $cr += @("--root-pane", $RootPane) }
  if ($Layout)      { $cr += @("--layout", $Layout) }
  if ($DryRun)      { $cr += "--dry-run" }
  Invoke-Step "3/5 chain-router" $cr
} else {
  Write-Host "── 3/5 chain-router — SKIP (no -Chain) ──`n" -ForegroundColor DarkGray
}

# 4. crash-recovery detect (needs live list for the cross-check that prevents false crash)
if ($WmuxCli) {
  $cd = @("$scripts/crash-recovery.js", "detect", "--state", $State, "--wmux-cli", $WmuxCli, "--heartbeat-ms", "$HeartbeatMs")
  if ($Mark) { $cd += "--mark" }
  Invoke-Step "4/5 crash-recovery detect" $cd
} else {
  Write-Host "── 4/5 crash-recovery detect — SKIP (no -WmuxCli) ──`n" -ForegroundColor DarkGray
}

Write-Host "=== pass done ===" -ForegroundColor Green
