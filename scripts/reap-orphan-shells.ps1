<#
.SYNOPSIS
  Reap orphaned wmux surface shells. DRY-RUN by default.

.DESCRIPTION
  wmux `close-surface` / `close-pane` detach a surface from the UI but do NOT kill
  the backing shell. Every wmux terminal surface is a long-lived shell launched as:
      powershell.exe -NoLogo -ExecutionPolicy Bypass -NoExit -Command ". $env:WMUX_PS1_SCRIPT"
  Because of `-NoExit`, the shell survives after its surface is closed, so each
  spawn/harvest cycle leaks one ~115 MB shell. This tool finds those leaked shells
  and (optionally) kills them.

  Live vs orphan is decided by IDENTITY, not heuristics: each surface shell carries
  its surface id in the WMUX_SURFACE_ID environment variable. A shell whose
  WMUX_SURFACE_ID is NOT present in the current wmux tree is an orphan.

  A shell is reaped ONLY if ALL of these hold (four independent locks):
    1. CommandLine is the exact wmux surface-shell signature.
    2. Parent process is the wmux electron main process (a real wmux-spawned shell).
    3. Pid is NOT in this script's own ancestor chain (never kill self / our surface).
    4. WMUX_SURFACE_ID was read successfully AND is absent from the live tree set.

  Fail-safe: if the live set cannot be established (tree unreachable, electron not
  found, orchestrator pane missing, or any live surface could not be located among
  the shells), the script refuses to kill anything and reports why.

.PARAMETER Reap
  Actually kill every orphan found. Omit for dry-run (list only, default).

.PARAMETER TargetPid
  Kill exactly one pid. The pid must still qualify as an orphan under all locks;
  otherwise the kill is refused. Implies kill intent (no -Reap needed).

.PARAMETER WmuxCli
  Path to the wmux CLI node script.

.PARAMETER MinOrphanAgeMin
  Minimum process age, in minutes, before a confirmed orphan is eligible to kill.
  Younger orphan candidates are reported as YOUNG-SKIPPED and never killed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\reap-orphan-shells.ps1
  powershell -ExecutionPolicy Bypass -File scripts\reap-orphan-shells.ps1 -Reap
  powershell -ExecutionPolicy Bypass -File scripts\reap-orphan-shells.ps1 -TargetPid 42960
#>
param(
  [switch]$Reap,
  [int]$TargetPid = 0,
  [int]$MinOrphanAgeMin = 2,
  [string]$WmuxCli = "C:\Users\Bee\wmux\resources\cli\wmux.js"
)

$ErrorActionPreference = "Stop"

# Write a clear message to stderr and exit with a deterministic code. Used for every
# refusal / fail-safe path so the caller can distinguish "refused" (>=2) from success.
function Stop-Reaper {
  param([string]$Message, [int]$Code)
  [Console]::Error.WriteLine($Message)
  exit $Code
}

if (-not [Environment]::Is64BitProcess) {
  Stop-Reaper "FAIL-SAFE: this script must run in 64-bit PowerShell because the PEB environment reader uses x64 offsets. Refusing to kill anything." 3
}

# The orchestrator owns this pane; it must always stay alive. Its presence in the
# live tree is also used as a sanity gate (a tree without it is treated as stale).
$OrchestratorPaneId = "pane-fdc4920d-7803-4db3-9197-1bb48d83e8de"

# Substring unique to a wmux surface shell's command line (live and orphan share it).
# Transient tool/wrapper shells use a different invocation and never match this.
$SurfaceSignature = '-NoExit -Command ". $env:WMUX_PS1_SCRIPT"'

# --- P/Invoke env reader: read another process's WMUX_SURFACE_ID -------------------
# Win32_Process exposes no environment block, so we walk the target's PEB:
#   PEB+0x20 -> ProcessParameters ; ProcessParameters+0x80 -> Environment block (x64).
# Read-only; works for same-user/same-bitness processes (all our shells qualify).
$envReaderSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WmuxProcEnv {
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h,int c,ref PBI p,int l,out int r);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(int a,bool i,int pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h,IntPtr a,byte[] b,int s,out int r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr R1; public IntPtr Peb; public IntPtr A; public IntPtr B; public IntPtr Id; public IntPtr R3; }
  static IntPtr RP(IntPtr h,IntPtr a){ byte[] b=new byte[8]; int r; if(!ReadProcessMemory(h,a,b,8,out r))return IntPtr.Zero; return (IntPtr)BitConverter.ToInt64(b,0);}
  public static string GetEnv(int pid){
    IntPtr h=OpenProcess(0x410,false,pid); if(h==IntPtr.Zero)return null;   // PROCESS_QUERY_INFORMATION|PROCESS_VM_READ
    try{ PBI p=new PBI(); int r; if(NtQueryInformationProcess(h,0,ref p,Marshal.SizeOf(p),out r)!=0)return null;
      IntPtr pp=RP(h,(IntPtr)((long)p.Peb+0x20)); if(pp==IntPtr.Zero)return null;
      IntPtr ev=RP(h,(IntPtr)((long)pp+0x80)); if(ev==IntPtr.Zero)return null;
      int[] szs={65536,32768,16384,8192,4096};
      foreach(int sz in szs){ byte[] bf=new byte[sz]; int rd; if(ReadProcessMemory(h,ev,bf,sz,out rd)&&rd>0)return Encoding.Unicode.GetString(bf,0,rd);}
      return null;
    } finally { CloseHandle(h); }
  }
}
'@
Add-Type -TypeDefinition $envReaderSource

$NUL = [char]0

function Get-ShellSurfaceId {
  param([int]$ProcId)
  $env = [WmuxProcEnv]::GetEnv($ProcId)
  if ($null -eq $env) { return $null }
  foreach ($part in ($env.Split($NUL))) {
    if ($part.StartsWith('WMUX_SURFACE_ID=')) { return $part.Substring(16) }
  }
  return ""
}

# Walk the ancestor chain of the current process. Returns the ancestor pid set plus
# the wmux electron pid (first ancestor whose image is wmux.exe). The current shell,
# our own surface shell, and electron are all in here -> structurally unkillable.
function Get-AncestryContext {
  $procs = @{}
  foreach ($p in Get-CimInstance Win32_Process) { $procs[[int]$p.ProcessId] = $p }
  $ancestors = @{}
  $electronPid = 0
  $cur = $PID
  $guard = 0
  while ($cur -and -not $ancestors.ContainsKey($cur) -and $guard -lt 30) {
    $ancestors[$cur] = $true
    $row = $procs[[int]$cur]
    if (-not $row) { break }
    if ($electronPid -eq 0 -and $row.Name -eq 'wmux.exe') { $electronPid = [int]$row.ProcessId }
    $cur = [int]$row.ParentProcessId
    $guard++
  }
  return [pscustomobject]@{ Ancestors = $ancestors; ElectronPid = $electronPid }
}

# Collect every surface id present in the live wmux tree, recursing branch->leaf.
function Get-LiveSurfaceIds {
  param([string]$Cli)
  $raw = & node $Cli tree 2>&1
  if ($LASTEXITCODE -ne 0) { throw "wmux tree failed: $($raw -join "`n")" }
  $parsed = $raw | ConvertFrom-Json
  $surfaces = New-Object System.Collections.Generic.List[string]
  $panes = New-Object System.Collections.Generic.List[string]
  $stack = New-Object System.Collections.Stack
  if ($parsed.tree) { $stack.Push($parsed.tree) }
  while ($stack.Count -gt 0) {
    $node = $stack.Pop()
    if ($node.type -eq 'leaf') {
      if ($node.paneId) { $panes.Add([string]$node.paneId) }
      if ($node.surfaces) { foreach ($s in $node.surfaces) { if ($s.id) { $surfaces.Add([string]$s.id) } } }
    }
    if ($node.children) { foreach ($c in $node.children) { $stack.Push($c) } }
  }
  return [pscustomobject]@{ Surfaces = $surfaces; Panes = $panes }
}

# --- Establish the live set (fail-safe gates) -------------------------------------
$ctx = Get-AncestryContext
if ($ctx.ElectronPid -eq 0) {
  Stop-Reaper "FAIL-SAFE: wmux electron (wmux.exe) not found in ancestor chain; not running inside a wmux surface. Refusing to kill anything." 3
}
$electronPid = $ctx.ElectronPid
$ancestors = $ctx.Ancestors

try {
  $live = Get-LiveSurfaceIds -Cli $WmuxCli
} catch {
  Stop-Reaper "FAIL-SAFE: could not read wmux tree ($($_.Exception.Message)). Refusing to kill anything." 3
}
$liveSurfaces = $live.Surfaces
if ($liveSurfaces.Count -eq 0) {
  Stop-Reaper "FAIL-SAFE: wmux tree reported zero surfaces. Refusing to kill anything." 3
}
if (-not ($live.Panes -contains $OrchestratorPaneId)) {
  Stop-Reaper "FAIL-SAFE: orchestrator pane $OrchestratorPaneId absent from live tree (stale/unexpected state). Refusing to kill anything." 3
}

# --- Classify candidate shells ----------------------------------------------------
$candidates = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($SurfaceSignature) }

$now = Get-Date
$orphans = @()
$youngSkipped = @()
$excluded = @()
$uncertain = @()
$locatedLiveSurfaces = @{}

foreach ($c in $candidates) {
  $cpid = [int]$c.ProcessId
  $sid = Get-ShellSurfaceId -ProcId $cpid
  $ageTotalMin = ($now - $c.CreationDate).TotalMinutes
  $ageMin = [math]::Round($ageTotalMin, 0)
  $ramMb = [math]::Round($c.WorkingSetSize / 1MB, 0)
  $rec = [pscustomobject]@{ Pid = $cpid; Ppid = [int]$c.ParentProcessId; AgeMin = $ageMin; RamMb = $ramMb; Sid = $sid; Reason = "" }

  if ($ancestors.ContainsKey($cpid)) {
    $rec.Reason = "EXCLUDE: own ancestor chain"; $excluded += $rec
    if ($sid) { $locatedLiveSurfaces[$sid] = $true }
  }
  elseif ([string]::IsNullOrEmpty($sid)) {
    if ($null -eq $sid) {
      $rec.Reason = "SKIP: env unreadable, cannot verify"
    } else {
      $rec.Reason = "SKIP: missing WMUX_SURFACE_ID, cannot verify"
    }
    $uncertain += $rec
  }
  elseif ($liveSurfaces -contains $sid) {
    $rec.Reason = "EXCLUDE: live surface in tree"; $excluded += $rec
    $locatedLiveSurfaces[$sid] = $true
  }
  elseif ($rec.Ppid -ne $electronPid) {
    $rec.Reason = "SKIP: parent not wmux electron"; $uncertain += $rec
  }
  elseif ($ageTotalMin -lt $MinOrphanAgeMin) {
    $rec.Reason = ("YOUNG-SKIPPED: age below {0}m threshold" -f $MinOrphanAgeMin); $youngSkipped += $rec
  }
  else {
    $rec.Reason = "ORPHAN: surface gone"; $orphans += $rec
  }
}

# Fail-safe: every live surface must be located among the shells. If a live surface
# was not matched to a shell we positively excluded, we cannot guarantee an "orphan"
# is not actually that live surface -> refuse to kill.
$unlocated = @()
foreach ($s in $liveSurfaces) { if (-not $locatedLiveSurfaces.ContainsKey($s)) { $unlocated += $s } }
$liveSetReliable = ($unlocated.Count -eq 0)

# --- Report -----------------------------------------------------------------------
function Write-Row {
  param($r)
  $sidShort = if ($r.Sid) { $r.Sid } else { "<unreadable>" }
  Write-Output ("  pid={0,-6} ppid={1,-6} age={2,4}m ram={3,4}MB  {4,-34}  {5}" -f $r.Pid, $r.Ppid, $r.AgeMin, $r.RamMb, $sidShort, $r.Reason)
}

Write-Output "================ wmux orphan-shell reaper ================"
Write-Output ("electron pid     : {0}" -f $electronPid)
Write-Output ("live surfaces    : {0}  [{1}]" -f $liveSurfaces.Count, ($liveSurfaces -join ", "))
Write-Output ("orchestrator pane: present in tree (gate ok)")
Write-Output ("min orphan age   : {0}m" -f $MinOrphanAgeMin)
Write-Output ""
Write-Output ("LIVE / EXCLUDED ({0}):" -f $excluded.Count)
foreach ($r in ($excluded | Sort-Object Pid)) { Write-Row $r }
if ($uncertain.Count -gt 0) {
  Write-Output ""
  Write-Output ("UNCERTAIN / SKIPPED ({0}) - never killed:" -f $uncertain.Count)
  foreach ($r in ($uncertain | Sort-Object Pid)) { Write-Row $r }
}
if ($youngSkipped.Count -gt 0) {
  Write-Output ""
  Write-Output ("YOUNG-SKIPPED ({0}) - never killed this run:" -f $youngSkipped.Count)
  foreach ($r in ($youngSkipped | Sort-Object Pid)) { Write-Row $r }
}
Write-Output ""
$orphanRam = ($orphans | Measure-Object -Property RamMb -Sum).Sum
Write-Output ("ORPHANS ({0}, ~{1} MB):" -f $orphans.Count, $orphanRam)
foreach ($r in ($orphans | Sort-Object Pid)) { Write-Row $r }
Write-Output ""

if (-not $liveSetReliable) {
  Stop-Reaper ("FAIL-SAFE: live surface(s) not located among shells [{0}]. State unreliable; refusing to kill anything." -f ($unlocated -join ", ")) 3
}

# --- Decide action ----------------------------------------------------------------
$orphanPids = @($orphans | ForEach-Object { $_.Pid })
$toKill = @()
if ($TargetPid -gt 0) {
  if ($orphanPids -notcontains $TargetPid) {
    Stop-Reaper ("REFUSED: pid {0} is not a confirmed orphan (it is live, excluded, uncertain, or unknown). Nothing killed." -f $TargetPid) 2
  }
  $toKill = @($TargetPid)
  Write-Output ("MODE: target kill pid {0}" -f $TargetPid)
}
elseif ($Reap) {
  $toKill = $orphanPids
  Write-Output ("MODE: reap all orphans")
}
else {
  Write-Output "MODE: dry-run (no -Reap, no -TargetPid). Nothing killed."
}

# --- Execute kills ----------------------------------------------------------------
$killed = @()
$failed = @()
foreach ($k in $toKill) {
  try {
    Stop-Process -Id $k -Force -Confirm:$false -ErrorAction Stop
    $killed += $k
    Write-Output ("  killed pid {0}" -f $k)
  } catch {
    $failed += $k
    Write-Output ("  FAILED to kill pid {0}: {1}" -f $k, $_.Exception.Message)
  }
}

# --- Machine-readable summary (stdout; no file written) ---------------------------
$summary = [ordered]@{
  electronPid    = $electronPid
  liveSurfaces   = $liveSurfaces
  liveSetReliable = $liveSetReliable
  orphanCount    = $orphans.Count
  orphanRamMb    = [int]$orphanRam
  orphanPids     = $orphanPids
  youngSkippedPids = @($youngSkipped | ForEach-Object { $_.Pid })
  excludedPids   = @($excluded | ForEach-Object { $_.Pid })
  uncertainPids  = @($uncertain | ForEach-Object { $_.Pid })
  killed         = $killed
  failed         = $failed
}
Write-Output ""
Write-Output ("JSON " + ($summary | ConvertTo-Json -Compress))
