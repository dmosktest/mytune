# mytune host collector — runs on YOUR machine only.
# Prints a mytune URL with query params + optional OS metrics for paste.
# Nothing is uploaded.
# Usage:
#   irm https://mytune.dmosk.net/collect.ps1 | iex
#   & ([scriptblock]::Create((irm https://mytune.dmosk.net/collect.ps1))) -Lang ru
# Env: MYTUNE_ORIGIN, MYTUNE_LANG

param(
  [string]$Lang = $(if ($env:MYTUNE_LANG) { $env:MYTUNE_LANG } else { "en" })
)

$ErrorActionPreference = "Stop"
$Origin = if ($env:MYTUNE_ORIGIN) { $env:MYTUNE_ORIGIN.TrimEnd("/") } else { "https://mytune.dmosk.net" }

function Map-DbVersion([string]$raw) {
  $lower = $raw.ToLowerInvariant()
  if ($lower -match "mariadb") {
    if ($lower -match "11\.([4-9]|\d{2})") { return "mariadb-11.4" }
    return "mariadb-10.11"
  }
  if ($lower -match "(?:^|[^\d])9\.") { return "mysql-9.0" }
  if ($lower -match "8\.4") { return "mysql-8.4" }
  if ($lower -match "8\.") { return "mysql-8.0" }
  return "mysql-8.4"
}

$osType = "windows"
$ramGb = 16
$memTotalMb = $null
$memAvailMb = $null
$swapUsedMb = $null
try {
  $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
  $ramGb = [Math]::Max(1, [int][Math]::Round($cs.TotalPhysicalMemory / 1GB))
  $memTotalMb = [Math]::Max(1, [int][Math]::Round($cs.TotalPhysicalMemory / 1MB))
} catch {}

try {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  if ($os.FreePhysicalMemory) {
    $memAvailMb = [int][Math]::Round($os.FreePhysicalMemory / 1024)
  }
  if ($null -ne $os.TotalSwapSpaceSize -and $null -ne $os.FreeSpaceInPagingFiles) {
    $swapUsedMb = [Math]::Max(0, [int][Math]::Round(($os.TotalSwapSpaceSize - $os.FreeSpaceInPagingFiles) / 1024))
  }
} catch {}

$cpu = $null
try {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
  if (-not $cpu -or $cpu -lt 1) { $cpu = $null }
} catch {}

$hd = "ssd"
$iopsEst = 2000
try {
  $disk = Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($disk) {
    switch -Regex ($disk.MediaType) {
      "HDD" { $hd = "hdd"; $iopsEst = 200 }
      "SSD" { $hd = "ssd"; $iopsEst = 2000 }
      "Unspecified" {
        if ("$($disk.FriendlyName)" -match "NVMe|nvme") { $hd = "nvme"; $iopsEst = 10000 }
        else { $hd = "ssd"; $iopsEst = 2000 }
      }
      default {
        if ("$($disk.BusType)" -match "NVMe") { $hd = "nvme"; $iopsEst = 10000 }
      }
    }
  }
} catch {}

$dbVer = "mysql-8.4"
try {
  $verRaw = $null
  foreach ($cmd in @("mysql", "mariadb", "mysqld")) {
    $exe = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($exe) {
      $verRaw = & $exe --version 2>$null | Out-String
      if ($verRaw) { break }
    }
  }
  if ($verRaw) { $dbVer = Map-DbVersion $verRaw }
} catch {}

$myp = $null
if ($memAvailMb -and $memTotalMb -and $memTotalMb -gt 0) {
  $usedPct = 100 - [int](($memAvailMb * 100) / $memTotalMb)
  if ($usedPct -gt 70) { $myp = 70 }
  elseif ($usedPct -gt 40) { $myp = 85 }
}

$qs = "v=$dbVer&os=$osType&ram=$ramGb&unit=GB&hd=$hd&db=web"
if ($cpu) { $qs += "&cpu=$cpu" }
if ($myp) { $qs += "&myp=$myp" }
$url = "$Origin/$Lang/?$qs"

Write-Host "mytune collector (local only — nothing uploaded)"
$mypNote = if ($myp) { " myp=$myp%" } else { "" }
Write-Host "  os=$osType ram=${ramGb}GB cpu=$(if ($cpu) { $cpu } else { '?' }) hd=$hd db=$dbVer$mypNote"
Write-Host "  mem_avail_mb=$(if ($memAvailMb) { $memAvailMb } else { '?' }) swap_used_mb=$(if ($null -ne $swapUsedMb) { $swapUsedMb } else { '?' }) iops_est=$iopsEst"
Write-Host ""
Write-Host $url
Write-Host ""
Write-Host "Open the link, review values, then press Generate."
Write-Host ""
Write-Host "# Optional: paste these OS lines into mytune → Real workload (with SHOW GLOBAL STATUS)"
if ($memTotalMb) { Write-Host "os_mem_total_mb: $memTotalMb" }
if ($memAvailMb) { Write-Host "os_mem_available_mb: $memAvailMb" }
if ($null -ne $swapUsedMb) { Write-Host "os_swap_used_mb: $swapUsedMb" }
Write-Host "os_iops_est: $iopsEst"
