<#
.SYNOPSIS
  Wrap one worker launch with the enforceable safety layers, then exec the launcher.

.DESCRIPTION
  Workers run at full bypass (claude --dangerously-skip-permissions / codex
  danger-full-access), so nothing INSIDE a running agent can be policed from here. What
  this wrapper CAN enforce sits on either side of the launch:

    pre-launch  (gate, can refuse to start the worker at all):
      * secret pre-flight  — scan the prompt/spec for leaked credentials; abort if any.
      * denylist           — abort if the spec itself instructs a destructive command
                             (the spec is attacker-editable; a worker told to run one is
                             the signal we can act on — we cannot watch its shell later).
      * backup             — snapshot every declared file to an immutable backup dir, and
                             optionally a git checkpoint commit. THIS is the real net: if
                             a bypassed worker corrupts a file, the pre-state is recoverable.
    post-launch (detect, cannot prevent under bypass — only surface + optionally undo):
      * write-fence        — list files changed outside the worker's allowed glob; with
                             -RestoreOutOfZone, revert them from git.

  Fail-safe: any gate that cannot prove safety blocks the launch. Backup always runs when
  a state file + agent id are given; it is not optional (the last-resort recovery layer).

.NOTES
  Invoked as the pane --cmd in place of a bare `node launcher`. Reads the worker's allowed
  file set from state.json (agent.files) — never trusts a path passed on the command line.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Launcher,
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [string]$Engine = 'claude',
  [string]$StateFile = '',
  [string]$AgentId = '',
  [string]$ScriptsDir = '',
  [string]$BackupRoot = '',
  [switch]$GitCheckpoint,
  [switch]$NoSecretScan,
  [switch]$AllowDestructive,
  [switch]$RestoreOutOfZone
)

$ErrorActionPreference = 'Stop'
function Log([string]$m) { Write-Host "[safe-launch] $m" }
function Abort([int]$code, [string]$m) { Write-Host "[safe-launch] ABORT: $m" -ForegroundColor Red; exit $code }

if ([string]::IsNullOrWhiteSpace($ScriptsDir)) { $ScriptsDir = $PSScriptRoot }
if (-not (Test-Path -LiteralPath $PromptFile)) { Abort 1 "prompt file not found: $PromptFile" }

# ── allowed file set (from state.json, NOT from argv) ─────────────────────────
$allowed = @()
$resultFile = ''
$agentCwd = (Get-Location).Path
if ($StateFile -and $AgentId -and (Test-Path -LiteralPath $StateFile)) {
  try {
    $state = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($w in $state.waves) {
      foreach ($a in $w.agents) {
        if ($a.id -eq $AgentId) {
          if ($a.files) { $allowed = @($a.files) }
          if ($a.cwd) { $agentCwd = [string]$a.cwd }
          if ($a.resultFile) { $resultFile = [string]$a.resultFile }
        }
      }
    }
  } catch { Log "could not parse state.json ($($_.Exception.Message)); proceeding without allowed-glob" }
}

# ── 1. secret pre-flight ──────────────────────────────────────────────────────
if (-not $NoSecretScan) {
  $scan = Join-Path $ScriptsDir 'scan-secrets.js'
  if (Test-Path -LiteralPath $scan) {
    & node $scan $PromptFile | Out-Null
    if ($LASTEXITCODE -ne 0) { Abort 3 "secret-scan flagged the prompt/spec (exit $LASTEXITCODE) — not launching" }
    Log 'secret-scan: clean'
  } else { Log "scan-secrets.js missing at $scan — skipping (fail-open noted)" }
}

# ── 2. denylist on the spec ───────────────────────────────────────────────────
# These target the SPEC, not the agent's runtime (unreachable under bypass): a worker
# whose instructions contain a destructive command is the tripwire we can refuse on.
$denylist = @(
  'rm\s+-rf\b',
  'Remove-Item\b[^\r\n]*-Recurse',
  'git\s+push\b[^\r\n]*(--force|\s-f\b)',
  'Format-Volume\b',
  '(Invoke-WebRequest|iwr|curl)\b[^\r\n]*\|\s*(iex|Invoke-Expression)',
  'Clear-Content\b',
  '\bdel\s+/[sSqQ]'
)
$promptText = Get-Content -LiteralPath $PromptFile -Raw -Encoding UTF8
foreach ($pat in $denylist) {
  if ($promptText -match $pat) {
    if ($AllowDestructive) { Log "denylist match ($pat) overridden by -AllowDestructive" }
    else { Abort 4 "spec contains a denylisted destructive pattern: /$pat/ (override with -AllowDestructive)" }
  }
}
Log 'denylist: clean'

# ── 3. backup (mandatory net) ─────────────────────────────────────────────────
$backupDir = $null
if ($allowed.Count -gt 0) {
  if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $root = if ($StateFile) { Split-Path -Parent $StateFile } else { $agentCwd }
    $BackupRoot = Join-Path $root 'backups'
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $idTag = if ($AgentId) { $AgentId } else { 'worker' }
  $backupDir = Join-Path $BackupRoot "$idTag-$stamp"
  $copied = 0
  foreach ($entry in $allowed) {
    # An allowed entry comes from the request file (editable outside the worker), so a
    # '..' glob could pull an unbounded tree into the snapshot — refuse it (same spirit
    # as isValidAgentId rejecting traversal). The worker's zone is at/under its cwd.
    if ($entry -match '\.\.') { Log "backup skip traversal entry: $entry"; continue }
    $items = @(Get-ChildItem -Path (Join-Path $agentCwd $entry) -File -ErrorAction SilentlyContinue)
    foreach ($it in $items) {
      try {
        $rel = (Resolve-Path -LiteralPath $it.FullName -Relative).TrimStart('.', '\', '/')
        $dest = Join-Path $backupDir $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        Copy-Item -LiteralPath $it.FullName -Destination $dest -Force
        $copied++
      } catch { Log "backup skip $($it.FullName): $($_.Exception.Message)" }
    }
  }
  Log "backup: $copied file(s) → $backupDir"
} else {
  Log 'backup: no declared files for this agent; relying on git checkpoint / repo history'
}

# ── 3b. optional git checkpoint ───────────────────────────────────────────────
if ($GitCheckpoint) {
  Push-Location $agentCwd
  try {
    & git rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      & git add -A 2>$null | Out-Null
      & git commit -m "checkpoint before worker $AgentId" --no-verify 2>$null | Out-Null
      Log 'git checkpoint committed (or nothing to commit)'
    } else { Log 'git checkpoint requested but cwd is not a git repo — skipped' }
  } catch { Log "git checkpoint failed: $($_.Exception.Message)" } finally { Pop-Location }
}

# ── 4. launch ─────────────────────────────────────────────────────────────────
Log "launch: node $Launcher $PromptFile (engine=$Engine)"
if ($Engine -and $Engine -ne 'claude') { & node $Launcher $PromptFile --engine $Engine }
else { & node $Launcher $PromptFile }
$launchExit = $LASTEXITCODE

# ── 5. result secret-scan (before any Leader reads it) ────────────────────────
# The worker may have echoed a credential into its result. Scan it the moment it lands,
# at the same trust boundary as the prompt scan, and quarantine on a hit so the leak
# cannot flow into an aggregated (and later committed) handoff.
if ($resultFile -and (Test-Path -LiteralPath $resultFile) -and -not $NoSecretScan) {
  $scan = Join-Path $ScriptsDir 'scan-secrets.js'
  if (Test-Path -LiteralPath $scan) {
    & node $scan $resultFile | Out-Null
    if ($LASTEXITCODE -ne 0) {
      $quarantine = "$resultFile.quarantine"
      try { Move-Item -LiteralPath $resultFile -Destination $quarantine -Force; Log "result-scan: LEAK → quarantined to $quarantine (Leader must not read the original)" }
      catch { Log "result-scan: LEAK detected but quarantine failed: $($_.Exception.Message)" }
    } else { Log 'result-scan: result clean' }
  }
}

# ── 6. write-fence detect (post-run) ──────────────────────────────────────────
if ($allowed.Count -gt 0) {
  Push-Location $agentCwd
  try {
    & git rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      # quotepath=false so paths with spaces/unicode aren't wrapped in escaped quotes
      # (which would defeat the -like match and a later `git checkout`). Porcelain v1 is
      # "XY <path>"; a rename is "R  old -> new" — keep the destination path.
      $changed = @(& git -c core.quotepath=false status --porcelain 2>$null | ForEach-Object {
        if ($_.Length -lt 4) { return }
        $p = $_.Substring(3)
        if ($p -match ' -> ') { $p = ($p -split ' -> ')[-1] }
        $p.Trim().Trim('"')
      } | Where-Object { $_ })
      $outOfZone = @()
      foreach ($c in $changed) {
        $cn = $c -replace '\\', '/'
        $inZone = $false
        foreach ($g in $allowed) { if ($cn -like ($g -replace '\\', '/')) { $inZone = $true; break } }
        if (-not $inZone) { $outOfZone += $cn }
      }
      if ($outOfZone.Count -gt 0) {
        Log "write-fence: $($outOfZone.Count) file(s) changed OUTSIDE the allowed zone:"
        $outOfZone | ForEach-Object { Write-Host "    ! $_" -ForegroundColor Yellow }
        if ($RestoreOutOfZone) {
          foreach ($f in $outOfZone) { & git checkout -- $f 2>$null }
          Log 'write-fence: out-of-zone changes reverted from git'
        }
      } else { Log 'write-fence: all changes within the allowed zone' }
    } else { Log 'write-fence: cwd not a git repo — backup is the only recovery layer' }
  } catch { Log "write-fence check failed: $($_.Exception.Message)" } finally { Pop-Location }
}

exit $launchExit
