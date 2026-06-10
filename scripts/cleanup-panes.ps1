param(
  [Parameter(Mandatory = $true)] [string]$State,
  [string]$WmuxCli = "C:\Users\Bee\wmux\resources\cli\wmux.js"
)

$ErrorActionPreference = "Stop"

function Get-StateAgents {
  param($ParsedState)
  $agents = @()
  if ($ParsedState -and $ParsedState.waves) {
    foreach ($wave in $ParsedState.waves) {
      if (-not $wave.agents) { continue }
      foreach ($agent in $wave.agents) {
        $agents += $agent
      }
    }
  }
  return $agents
}

function Invoke-Wmux {
  param(
    [string[]]$Arguments,
    [string]$Kind,
    [string]$Id
  )
  try {
    $output = & node @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
      return @{ ok = $false; error = ("{0} {1} failed: {2}" -f $Kind, $Id, ($output -join "`n")) }
    }
    return @{ ok = $true; error = $null }
  } catch {
    return @{ ok = $false; error = ("{0} {1} failed: {2}" -f $Kind, $Id, $_.Exception.Message) }
  }
}

$stateJson = Get-Content -LiteralPath $State -Raw | ConvertFrom-Json
$killed = @()
$closed = @()
$errors = @()

foreach ($agent in (Get-StateAgents -ParsedState $stateJson)) {
  if ($agent.wmuxAgentId) {
    $id = [string]$agent.wmuxAgentId
    $result = Invoke-Wmux -Arguments @($WmuxCli, "agent", "kill", $id) -Kind "agent kill" -Id $id
    if ($result.ok) {
      $killed += $id
    } else {
      $errors += $result.error
    }
  }

  if ($agent.paneId) {
    $pane = [string]$agent.paneId
    $result = Invoke-Wmux -Arguments @($WmuxCli, "close-pane", $pane) -Kind "close-pane" -Id $pane
    if ($result.ok) {
      $closed += $pane
    } else {
      $errors += $result.error
    }
  }
}

[ordered]@{
  killed = $killed
  closed = $closed
  errors = $errors
} | ConvertTo-Json -Compress
