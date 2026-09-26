. (Join-Path $PSScriptRoot 'windows-common.ps1')
if (-not (Test-Path -LiteralPath $script:RuntimeDir)) { Write-Host 'Workbench is not running.'; return }
try {
    $startupLock = [IO.File]::Open((Join-Path $script:RuntimeDir 'startup.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch { throw 'Another start or stop operation is in progress. Please try again shortly.' }
try {
    $serverProcess = Get-ManagedWorkbenchProcess
    if ($serverProcess) {
        Stop-Process -InputObject $serverProcess
        $serverProcess.WaitForExit(5000) | Out-Null
        Write-Host 'Workbench stopped.'
    } else { Write-Host 'Workbench is not running.' }
    if (Test-Path -LiteralPath $script:StateFile) { Remove-Item -LiteralPath $script:StateFile -Force }
} finally { $startupLock.Dispose() }
