param([switch]$NoBrowser, [switch]$BackendOnly)
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$nodePath = Get-WorkbenchNode
Initialize-WorkbenchConfig
try { & (Join-Path $PSScriptRoot 'Start-LocalAI.ps1') -IfInstalled } catch { Write-Warning "Local AI unavailable: $($_.Exception.Message)" }
$startupLock = $null
try {
    $startupLock = [IO.File]::Open((Join-Path $script:RuntimeDir 'startup.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch { throw 'Another start or stop operation is in progress. Please try again shortly.' }
try {
    $portNumber = Get-WorkbenchPort
    $url = "http://127.0.0.1:$portNumber/"
    $existing = Get-ManagedWorkbenchProcess
    if ($existing) {
        if (-not (Test-WorkbenchHealth $portNumber)) { throw 'The saved server is running but is not healthy. Run Stop.cmd, then Start.cmd.' }
        Write-Host "Workbench is already running: $url"
        if (-not $NoBrowser) { Start-Process $url }
        return
    }
    $needsInstall = -not (Test-Path -LiteralPath (Join-Path $script:WorkbenchRoot 'backend\node_modules\tsx\package.json')) -or -not (Test-Path -LiteralPath $script:BackendEntry)
    if (-not $BackendOnly) { $needsInstall = $needsInstall -or -not (Test-Path -LiteralPath (Join-Path $script:WorkbenchRoot 'frontend\dist\index.html')) }
    if ($needsInstall) { & (Join-Path $PSScriptRoot 'Install.ps1') -BackendOnly:$BackendOnly }
    $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $portNumber)
    try { $portProbe.Start() } catch { throw "Port $portNumber is already in use. No other process was stopped." } finally { $portProbe.Stop() }
    $env:NODE_ENV = 'production'
    $env:WORKBENCH_SOURCE_FINGERPRINT = 'v' + [IO.File]::ReadAllText((Join-Path $script:WorkbenchRoot 'VERSION')).Trim() + '-windows'
    $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @('--import', 'tsx', ('"' + $script:BackendEntry + '"')) -WorkingDirectory (Join-Path $script:WorkbenchRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $script:RuntimeDir 'backend.stdout.log') -RedirectStandardError (Join-Path $script:RuntimeDir 'backend.stderr.log') -PassThru
    $state = @{ processId = $serverProcess.Id; startedUtcTicks = $serverProcess.StartTime.ToUniversalTime().Ticks.ToString(); node = $nodePath; root = $script:WorkbenchRoot; entry = $script:BackendEntry; port = $portNumber }
    [IO.File]::WriteAllText($script:StateFile, ($state | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $serverProcess.Refresh()
        if ($serverProcess.HasExited) { break }
        if (Test-WorkbenchHealth $portNumber) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        $ownedProcess = Get-ManagedWorkbenchProcess
        if ($ownedProcess) { Stop-Process -InputObject $ownedProcess }
        if (Test-Path -LiteralPath $script:StateFile) { Remove-Item -LiteralPath $script:StateFile -Force }
        throw 'The server could not start. See .runtime/backend.stderr.log for details.'
    }
    Write-Host "Workbench started: $url"
    Write-Host 'You may close this window. Double-click Stop.cmd to stop the background server.'
    if (-not $NoBrowser) { Start-Process $url }
} finally { $startupLock.Dispose() }
