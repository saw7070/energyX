<#
.SYNOPSIS
Safely restarts the built EnergyIQ Overview API and Web in the Integration Worktree.

.DESCRIPTION
Run with -PreflightOnly first. The command never prints env values. A legacy
relative-command listener can be adopted once only by passing its inspected PID
through -ExpectedExistingApiPid or -ExpectedExistingWebPid.
#>
[CmdletBinding()]
param(
  [string]$IntegrationRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$EnvFile = "",
  [string]$StorageRoot = "",
  [int]$ApiPort = 8787,
  [int]$WebPort = 3000,
  [int]$ExpectedExistingApiPid = 0,
  [int]$ExpectedExistingWebPid = 0,
  [ValidateRange(1, 120)]
  [int]$ProbeAttempts = 30,
  [ValidateRange(100, 5000)]
  [int]$ProbeDelayMilliseconds = 500,
  [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"

function Resolve-RequiredPath {
  param([string]$LiteralPath, [string]$Label)

  if (-not (Test-Path -LiteralPath $LiteralPath)) {
    throw "$Label was not found: $LiteralPath"
  }
  return (Resolve-Path -LiteralPath $LiteralPath).Path
}

function Resolve-AuthoritativeEnvFile {
  param([string]$ExplicitPath, [string]$Root)

  if ($ExplicitPath) {
    return Resolve-RequiredPath $ExplicitPath "Environment file"
  }
  $parent = Split-Path -Parent $Root
  $candidates = @(
    (Join-Path $Root ".env"),
    (Join-Path $parent "energyiq-datafoundry\.env")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  throw "No authorised local env file was found. Pass -EnvFile explicitly."
}

function Read-DotEnvValues {
  param([string]$Path)

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ($line -match '^\s*(?:#|$)') { continue }
    if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      continue
    }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    )) {
      $value = $value.Substring(1, $value.Length - 2)
    } else {
      $comment = [regex]::Match($value, '\s+#')
      if ($comment.Success) { $value = $value.Substring(0, $comment.Index).TrimEnd() }
    }
    $values[$name] = $value
  }
  return $values
}

function Test-AbsoluteWindowsPath {
  param([string]$Value)

  return [bool]($Value -match '^(?:[A-Za-z]:[\\/]|\\\\)')
}

function Resolve-AuthoritativeStorageRoot {
  param(
    [string]$ExplicitPath,
    $EnvironmentValues,
    [string]$Root
  )

  $configuredPath = if ($ExplicitPath) {
    $ExplicitPath
  } elseif ($EnvironmentValues.ContainsKey("STORAGE_ROOT_DIR") -and
    [string]$EnvironmentValues["STORAGE_ROOT_DIR"] -and
    [string]$EnvironmentValues["STORAGE_ROOT_DIR"].Trim()) {
    [string]$EnvironmentValues["STORAGE_ROOT_DIR"]
  } else {
    Join-Path (Split-Path -Parent $Root) "energyiq-datafoundry\storage"
  }
  if (-not (Test-AbsoluteWindowsPath $configuredPath)) {
    throw "STORAGE_ROOT_DIR must be an explicit absolute path."
  }

  $resolved = Resolve-RequiredPath $configuredPath "Authorised shared storage root"
  $item = Get-Item -LiteralPath $resolved
  if (-not $item.PSIsContainer) {
    throw "Authorised shared storage root must be a directory: $resolved"
  }
  $integrationLocalStorage = Join-Path $Root "storage"
  if ((Test-Path -LiteralPath $integrationLocalStorage) -and
      (Resolve-Path -LiteralPath $integrationLocalStorage).Path -eq $resolved) {
    throw "Refusing the Integration-local storage tree; use the authorised shared storage root."
  }

  Resolve-RequiredPath (Join-Path $resolved "metadata\workbench.sqlite") "Metadata store" | Out-Null
  $energyRoot = Resolve-RequiredPath (Join-Path $resolved "energy") "Workspace Energy store root"
  $workspaceStores = @(Get-ChildItem -LiteralPath $energyRoot -Filter "energy.duckdb" -File -Recurse)
  if ($workspaceStores.Count -eq 0) {
    throw "No Workspace Energy store was found beneath the authorised shared storage root."
  }
  return $resolved
}

function Get-ListenerProcesses {
  param([int]$Port)

  $pids = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  return @($pids | ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$_" })
}

function Normalize-CommandLine {
  param([string]$Value)
  if (-not $Value) { return "" }
  return $Value.Replace('/', '\').ToLowerInvariant()
}

function Test-ExpectedProcess {
  param(
    $Process,
    [ValidateSet("api", "web")][string]$Kind,
    [string]$ApiEntry,
    [string]$NextEntry,
    [string]$WebDirectory,
    [int]$ExpectedLegacyPid
  )

  $command = Normalize-CommandLine $Process.CommandLine
  if ($Kind -eq "api") {
    if ($command.Contains((Normalize-CommandLine $ApiEntry))) { return $true }
    return $ExpectedLegacyPid -gt 0 -and $Process.ProcessId -eq $ExpectedLegacyPid -and
      $command.Contains("apps\api\dist\index.js")
  }
  if ($command.Contains((Normalize-CommandLine $NextEntry)) -and
      $command.Contains((Normalize-CommandLine $WebDirectory))) { return $true }
  return $ExpectedLegacyPid -gt 0 -and $Process.ProcessId -eq $ExpectedLegacyPid -and
    $command.Contains("next") -and $command.Contains("start") -and
    $command.Contains("apps\web")
}

function Wait-PortFree {
  param([int]$Port)

  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    if ((Get-ListenerProcesses $Port).Count -eq 0) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Port $Port did not become free after the verified listener was stopped."
}

function Wait-HttpReady {
  param([string]$Uri, [int[]]$AcceptedStatusCodes)

  for ($attempt = 0; $attempt -lt $ProbeAttempts; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
      if ($AcceptedStatusCodes -contains [int]$response.StatusCode) { return $true }
    } catch {}
    Start-Sleep -Milliseconds $ProbeDelayMilliseconds
  }
  return $false
}

function Stop-CreatedProcesses {
  param([System.Collections.ArrayList]$Processes)

  foreach ($process in @($Processes) | Select-Object -Last 100) {
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

function Restore-ProcessEnvironment {
  param($PreviousValues)

  foreach ($entry in $PreviousValues.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable([string]$entry.Key, $entry.Value, "Process")
  }
}

if ($ApiPort -eq $WebPort) { throw "API and Web ports must be different." }
$root = Resolve-RequiredPath $IntegrationRoot "Integration root"
if ((Split-Path -Leaf $root) -ne "energyiq-datafoundry-integration") {
  throw "Refusing to run services outside the named Integration Worktree."
}
$gitRoot = (& git -C $root rev-parse --show-toplevel 2>$null).Trim()
if (-not $gitRoot -or (Resolve-Path -LiteralPath $gitRoot).Path -ne $root) {
  throw "IntegrationRoot must be a Git worktree root."
}
$resolvedEnvFile = Resolve-AuthoritativeEnvFile $EnvFile $root
$envValues = Read-DotEnvValues $resolvedEnvFile
$resolvedStorageRoot = Resolve-AuthoritativeStorageRoot $StorageRoot $envValues $root
$envValues["STORAGE_ROOT_DIR"] = $resolvedStorageRoot
$secretMasterKeyConfigured = [bool]($envValues.ContainsKey("SECRET_MASTER_KEY") -and
  [string]$envValues["SECRET_MASTER_KEY"] -and
  [string]$envValues["SECRET_MASTER_KEY"].Trim())
if (-not $secretMasterKeyConfigured) {
  throw "SECRET_MASTER_KEY is not configured in the authorised env file."
}

$apiEntry = Resolve-RequiredPath (Join-Path $root "apps\api\dist\index.js") "Built API entry"
$nextEntry = Resolve-RequiredPath (Join-Path $root "node_modules\next\dist\bin\next") "Next.js entry"
$webDirectory = Resolve-RequiredPath (Join-Path $root "apps\web") "Web application"
Resolve-RequiredPath (Join-Path $webDirectory ".next\BUILD_ID") "Built Web application" | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source

$apiListeners = @(Get-ListenerProcesses $ApiPort)
$webListeners = @(Get-ListenerProcesses $WebPort)
$apiOwned = $apiListeners.Count -le 1 -and ($apiListeners.Count -eq 0 -or
  (Test-ExpectedProcess $apiListeners[0] "api" $apiEntry $nextEntry $webDirectory $ExpectedExistingApiPid))
$webOwned = $webListeners.Count -le 1 -and ($webListeners.Count -eq 0 -or
  (Test-ExpectedProcess $webListeners[0] "web" $apiEntry $nextEntry $webDirectory $ExpectedExistingWebPid))

Write-Output ([pscustomobject]@{
  integrationRoot = $root
  envFile = $resolvedEnvFile
  storageRoot = $resolvedStorageRoot
  secretMasterKeyConfigured = $secretMasterKeyConfigured
  apiPort = $ApiPort
  apiExistingPid = if ($apiListeners.Count -eq 1) { $apiListeners[0].ProcessId } else { $null }
  apiExistingProcessVerified = $apiOwned
  webPort = $WebPort
  webExistingPid = if ($webListeners.Count -eq 1) { $webListeners[0].ProcessId } else { $null }
  webExistingProcessVerified = $webOwned
  preflightOnly = [bool]$PreflightOnly
})

if ($PreflightOnly) { return }
if (-not $apiOwned) { throw "Refusing to stop the unverified listener on API port $ApiPort." }
if (-not $webOwned) { throw "Refusing to stop the unverified listener on Web port $WebPort." }

foreach ($process in @($apiListeners + $webListeners)) {
  Stop-Process -Id $process.ProcessId -Force
}
Wait-PortFree $ApiPort
Wait-PortFree $WebPort

$runtimeDirectory = Join-Path $root ".scratch\runtime"
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$created = New-Object System.Collections.ArrayList
$previousProcessEnvironment = @{}
$environmentKeys = @($envValues.Keys) + @("API_PORT") | Select-Object -Unique
foreach ($name in $environmentKeys) {
  $previousProcessEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}
$apiEnvironmentApplied = $false

try {
  foreach ($entry in $envValues.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, "Process")
  }
  [Environment]::SetEnvironmentVariable("API_PORT", [string]$ApiPort, "Process")
  $apiEnvironmentApplied = $true
  $apiProcess = Start-Process -FilePath $node `
    -ArgumentList "`"$apiEntry`"" `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDirectory "$stamp-api.stdout.log") `
    -RedirectStandardError (Join-Path $runtimeDirectory "$stamp-api.stderr.log") `
    -PassThru
  [void]$created.Add($apiProcess)
  Restore-ProcessEnvironment $previousProcessEnvironment
  $apiEnvironmentApplied = $false

  $healthReady = Wait-HttpReady "http://127.0.0.1:$ApiPort/healthz" @(200)
  $serverReady = $healthReady -and (Wait-HttpReady "http://127.0.0.1:$ApiPort/ready" @(200))
  if (-not $serverReady) { throw "API did not pass /healthz and /ready probes." }

  $webProcess = Start-Process -FilePath $node `
    -ArgumentList "`"$nextEntry`"", "start", "`"$webDirectory`"", "-p", "$WebPort" `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDirectory "$stamp-web.stdout.log") `
    -RedirectStandardError (Join-Path $runtimeDirectory "$stamp-web.stderr.log") `
    -PassThru
  [void]$created.Add($webProcess)

  $webReady = Wait-HttpReady "http://127.0.0.1:$WebPort/energyiq/overview" @(200, 302, 307, 308)
  if (-not $webReady) { throw "Web did not pass the Overview probe on port $WebPort." }

  Write-Output ([pscustomobject]@{
    apiPid = $apiProcess.Id
    apiHealthzReady = $healthReady
    apiReady = $serverReady
    webPid = $webProcess.Id
    webReady = $webReady
    secretMasterKeyConfigured = $secretMasterKeyConfigured
  })
} catch {
  if ($apiEnvironmentApplied) {
    Restore-ProcessEnvironment $previousProcessEnvironment
  }
  Stop-CreatedProcesses $created
  throw
}
