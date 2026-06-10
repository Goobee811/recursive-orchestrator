param(
  [Parameter(Mandatory = $true)] [string]$State,
  [string]$WmuxCli = "C:\Users\Bee\wmux\resources\cli\wmux.js",
  [string]$SafeWrapper = "",
  [string]$RootPane = "",
  [switch]$Chain,
  [switch]$HarvestKill,
  [switch]$Mark,
  [int]$IntervalSec = 20,
  [int]$MaxPasses = 60,
  [switch]$SkipPatchCheck
)

$ErrorActionPreference = "Stop"
$ExpectedAppAsarHash = "CED7F271E601015CEAF42FFE2EE005D698991B7A32EB31C73D1DE674BBD828B6"
$AppAsar = "C:\Users\Bee\wmux\resources\app.asar"

if (-not $SafeWrapper) {
  $SafeWrapper = Join-Path $PSScriptRoot "safe-launch-wrapper.ps1"
}

function Write-Utf8NoBomFile {
  param([string]$Path, [string]$Content)
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Ensure-StateFile {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) { return }
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  Write-Utf8NoBomFile -Path $Path -Content '{"version":1,"waves":[]}'
}

function Count-LiveAgents {
  param($ParsedState)
  $count = 0
  if ($ParsedState -and $ParsedState.waves) {
    foreach ($wave in $ParsedState.waves) {
      if (-not $wave.agents) { continue }
      foreach ($agent in $wave.agents) {
        if ($agent.status -eq "running" -or $agent.status -eq "pending") {
          $count++
        }
      }
    }
  }
  return $count
}

function Count-PendingRequests {
  param([string]$StatePath)
  $dir = Split-Path -Parent $StatePath
  if (-not $dir) { $dir = "." }
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }

  $count = 0
  $files = Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "nested-request-*.json" -or $_.Name -like "chain-request-*.json" }
  foreach ($file in $files) {
    try {
      $request = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
      if ($request.status -eq "pending") { $count++ }
    } catch {
      Write-Warning ("Skipping unreadable request file {0}: {1}" -f $file.FullName, $_.Exception.Message)
    }
  }
  return $count
}

if (-not $SkipPatchCheck) {
  try {
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $AppAsar).Hash.ToUpperInvariant()
  } catch {
    Write-Warning "update wmux da de mat patch split --pane"
    exit 1
  }
  if ($actualHash -ne $ExpectedAppAsarHash) {
    Write-Warning "update wmux da de mat patch split --pane"
    exit 1
  }
}

Ensure-StateFile -Path $State

$passScript = Join-Path $PSScriptRoot "orchestrator-pass.ps1"
$passes = 0
$liveAgents = 0
$pendingRequests = 0
$stoppedEarly = $false

for ($i = 0; $i -lt $MaxPasses; $i++) {
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $passScript, "-State", $State)
  if ($WmuxCli) { $args += @("-WmuxCli", $WmuxCli) }
  if ($SafeWrapper) { $args += @("-SafeWrapper", $SafeWrapper) }
  if ($RootPane) { $args += @("-RootPane", $RootPane) }
  if ($Chain) { $args += "-Chain" }
  if ($HarvestKill) { $args += "-HarvestKill" }
  if ($Mark) { $args += "-Mark" }

  & powershell @args
  if ($LASTEXITCODE -ne 0) {
    throw ("orchestrator-pass.ps1 exited with code {0}" -f $LASTEXITCODE)
  }

  $passes++
  $stateJson = Get-Content -LiteralPath $State -Raw | ConvertFrom-Json
  $liveAgents = Count-LiveAgents -ParsedState $stateJson
  $pendingRequests = Count-PendingRequests -StatePath $State

  if ($liveAgents -eq 0 -and $pendingRequests -eq 0) {
    $stoppedEarly = $true
    break
  }

  if ($i -lt ($MaxPasses - 1)) {
    Start-Sleep -Seconds $IntervalSec
  }
}

$summary = [ordered]@{
  passes = $passes
  liveAgents = $liveAgents
  pendingRequests = $pendingRequests
  stoppedEarly = $stoppedEarly
}
$summary | ConvertTo-Json -Compress
