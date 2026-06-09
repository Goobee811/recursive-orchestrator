param(
  [Parameter(Mandatory=$true)][string]$State,
  [Parameter(Mandatory=$true)][string]$ChainId,
  [string]$OutDir = "plans/reports",
  [string]$WmuxCli = ""
)

$ErrorActionPreference = "Stop"

function Read-Json($Path) {
  if (!(Test-Path -LiteralPath $Path)) { throw "missing file: $Path" }
  return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function One-Line($Value) {
  return (($Value -as [string]) -replace "[`r`n|]+", " ").Trim()
}

function Md-Code($Value) {
  $s = One-Line $Value
  if (!$s) { return "(none)" }
  return "``$s``"
}

function Resolve-WorkPath($BaseDir, $PathValue) {
  if (!$PathValue) { return $null }
  if ([System.IO.Path]::IsPathRooted($PathValue)) { return $PathValue }
  return (Join-Path $BaseDir $PathValue)
}

function Get-RepoRoot($StartDir) {
  $root = (& git -C $StartDir rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -eq 0 -and $root) { return $root.Trim() }
  return $StartDir
}

function Test-GitChange($RepoRoot, $FilePath) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $status = (& git -C $RepoRoot status --porcelain -- $FilePath 2>$null) -join "`n"
    $statusExit = $LASTEXITCODE
    $diff = (& git -C $RepoRoot diff -- $FilePath 2>$null) -join "`n"
    $diffExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldPreference
  }
  return [pscustomobject]@{
    file = $FilePath
    changed = (($statusExit -eq 0 -and $diffExit -eq 0) -and (($status.Trim().Length -gt 0) -or ($diff.Trim().Length -gt 0)))
    evidence = (One-Line (($status + " " + $diff).Substring(0, [Math]::Min(180, ($status + " " + $diff).Length))))
  }
}

function Find-ResultFiles($StateDir, $Agent) {
  $id = $Agent.id
  $engine = ($Agent.engine -as [string])
  if ($engine -and $engine.ToLower() -eq "codex") {
    return [pscustomobject]@{
      result = (Join-Path $StateDir "agent-$id-result.json")
      jsonl = (Join-Path $StateDir "agent-$id-out.jsonl")
    }
  }
  return [pscustomobject]@{
    result = (Resolve-WorkPath $StateDir $Agent.resultFile)
    jsonl = $null
  }
}

function Summarize-Codex($StateDir, $RepoRoot, $Agent) {
  $files = Find-ResultFiles $StateDir $Agent
  if (!(Test-Path -LiteralPath $files.result)) {
    return [pscustomobject]@{ status="BLOCKED"; verified=$false; text="Missing Codex result JSON."; files=@(); decisions=@(); remaining=@(); blockers=@("missing result JSON") }
  }
  $result = Read-Json $files.result
  $changed = @($result.filesChanged)
  $blockers = @($result.blockers)
  if ($changed.Count -eq 0) { $blockers += "filesChanged empty; cannot prove worker changed target files" }
  $evidence = @()
  foreach ($file in $changed) {
    $check = Test-GitChange $RepoRoot $file
    $evidence += $check
    if (!$check.changed) { $blockers += "no git diff/status evidence for $file" }
  }
  if (!(Test-Path -LiteralPath $files.jsonl)) { $blockers += "missing Codex JSONL forensic log" }
  $verified = ($blockers.Count -eq 0)
  $status = if ($verified) { One-Line $result.status } else { "BLOCKED" }
  return [pscustomobject]@{
    status = $status.ToUpper()
    verified = $verified
    text = "Codex result from $(Split-Path $files.result -Leaf); diff evidence: " + (($evidence | ForEach-Object { "$($_.file)=$($_.changed)" }) -join ", ")
    files = $changed
    decisions = @($result.decisions)
    remaining = @($result.remaining)
    blockers = $blockers
  }
}

function Summarize-Markdown($StateDir, $Agent) {
  $files = Find-ResultFiles $StateDir $Agent
  if (!(Test-Path -LiteralPath $files.result)) {
    return [pscustomobject]@{ status="BLOCKED"; verified=$false; text="Missing worker handoff markdown."; files=@($Agent.resultFile); decisions=@(); remaining=@(); blockers=@("missing handoff markdown") }
  }
  $text = Get-Content -LiteralPath $files.result -Raw
  return [pscustomobject]@{ status="DONE"; verified=$true; text=(One-Line $text.Substring(0, [Math]::Min(240, $text.Length))); files=@($Agent.resultFile); decisions=@(); remaining=@(); blockers=@() }
}

function Add-TableRow($Cells) {
  return "| " + (($Cells | ForEach-Object { (One-Line $_) }) -join " | ") + " |"
}

$statePath = (Resolve-Path -LiteralPath $State).Path
$stateDir = Split-Path $statePath -Parent
$repoRoot = Get-RepoRoot $stateDir
$outPath = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path (Get-Location) $OutDir }
New-Item -ItemType Directory -Force -Path $outPath | Out-Null

$stateJson = Read-Json $statePath
$links = @()
foreach ($wave in @($stateJson.waves)) {
  foreach ($agent in @($wave.agents)) {
    if (($agent.chainId -as [string]) -eq $ChainId) { $links += $agent }
  }
}
if ($links.Count -eq 0) { throw "chain not found: $ChainId" }
$links = $links | Sort-Object {[int]$_.linkSeq}
$last = $links[-1]
if ($null -ne $last.nextLink) {
  $blocked = @("chain chua ket thuc: last link nextLink=$($last.nextLink)")
  [pscustomobject]@{ chainId=$ChainId; links=@(); handoffFile=$null; validated=$false; blocked=$blocked } | ConvertTo-Json -Depth 6
  exit 1
}

$summaries = @()
foreach ($link in $links) {
  $engine = ($link.engine -as [string])
  if (!$engine) { $engine = "claude" }
  $engine = $engine.ToLower()
  $summary = if ($engine -eq "codex") { Summarize-Codex $stateDir $repoRoot $link } else { Summarize-Markdown $stateDir $link }
  $summaries += [pscustomobject]@{ link=$link; engine=$engine; summary=$summary }
}

$allBlockers = @($summaries | ForEach-Object { $_.summary.blockers } | Where-Object { $_ })
$date = Get-Date -Format "yyMMdd-HHmm"
$handoff = Join-Path $outPath "handoff-$date-$ChainId.md"
$chainStatus = if ($allBlockers.Count -gt 0) { "blocked" } else { "done" }

$lines = @(
  "# Handoff - $ChainId",
  "",
  "Chain $ChainId aggregated by linkSeq. Routing source is state.json; Codex links are only done when git evidence confirms every declared changed file.",
  "",
  "**Ngay:** $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
  "**Branch:** $((& git -C $repoRoot branch --show-current 2>$null) -join '')",
  "**Plan:** [[plans/260609-1722-recursive-pane-orchestration/phase-05-handoff-chain-lifecycle]]",
  "**Trang thai:** $chainStatus",
  "",
  "## 1. Completed Work",
  "",
  "| Link | Engine | Files | Status |",
  "|------|--------|-------|--------|"
)
foreach ($s in $summaries) { $lines += Add-TableRow @($s.link.linkSeq, $s.engine, (($s.summary.files | ForEach-Object { Md-Code $_ }) -join ", "), $s.summary.status) }
$lines += @("", "## 2. Current State", "", "**Dang chay tot:** Chain sorted by numeric linkSeq and terminal link has nextLink null.", "**Dang lam do:** $($allBlockers.Count) blocker(s) from link verification.", "**Chua commit:** See git status in repo root.", "**Loi/Tests:** leader aggregate runtime validation executed below.", "", "## 3. Decisions", "", "| Decision | Reason |", "|----------|--------|")
$lines += Add-TableRow @("Use state chainId/linkSeq for aggregation", "Prevents mixing unrelated handoffs by filename or slug")
$lines += Add-TableRow @("Verify Codex with git status/diff", "Structured JSON alone cannot prove files were changed")
foreach ($s in $summaries) { foreach ($d in @($s.summary.decisions)) { if ($d) { $lines += Add-TableRow @("Link $($s.link.linkSeq): $d", "Worker decision") } } }
$lines += @("", "## 4. Issues", "", "| Issue | Impact | Note |", "|-------|--------|------|")
if ($allBlockers.Count -eq 0) { $lines += Add-TableRow @("None", "No known blocker", "All links verified") } else { foreach ($b in $allBlockers) { $lines += Add-TableRow @($b, "Link marked BLOCKED", "Verify/re-dispatch before claiming done") } }
$lines += @("", "## 5. File Reference", "", "| File | Role |", "|------|------|")
$lines += Add-TableRow @($statePath, "Chain state source")
foreach ($s in $summaries) { foreach ($f in @($s.summary.files)) { if ($f) { $lines += Add-TableRow @($f, "Link $($s.link.linkSeq) output or changed file") } } }
$lines += @("", "## 6. Cross-References", "", "| Doc/Plan | Relation |", "|----------|----------|", "| [[plans/260609-1722-recursive-pane-orchestration/phase-05-handoff-chain-lifecycle]] | Source spec for chain aggregate |", "", "## 7. Next Steps", "", "| Priority | Action | Dependency |", "|----------|--------|------------|")
if ($allBlockers.Count -eq 0) { $lines += Add-TableRow @("1", "Send aggregate handoff to orchestrator", "Validated handoff file") } else { $lines += Add-TableRow @("1", "Re-verify or re-dispatch blocked Codex link", "Missing git evidence") }
$lines += @("", "## Link Notes", "")
foreach ($s in $summaries) { $lines += "### Link $($s.link.linkSeq) - $($s.link.id)"; $lines += $s.summary.text; $lines += "" }
Set-Content -LiteralPath $handoff -Value ($lines -join "`n") -Encoding UTF8

$validator = Join-Path $HOME ".claude\skills\context-handoff\scripts\validate-handoff.js"
$validationRaw = (& node $validator $handoff 2>$null) -join "`n"
$validated = $false
try { $validated = ((($validationRaw | ConvertFrom-Json).pass) -eq $true) } catch { $validated = $false }

$linkOut = @($summaries | ForEach-Object {
  [pscustomobject]@{ linkSeq=[int]$_.link.linkSeq; id=$_.link.id; engine=$_.engine; status=$_.summary.status; verified=$_.summary.verified }
})
[pscustomobject]@{ chainId=$ChainId; links=$linkOut; handoffFile=$handoff; validated=$validated; blocked=$allBlockers } | ConvertTo-Json -Depth 8
if (!$validated) { exit 1 }
