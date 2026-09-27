param([switch]$IfInstalled)
. (Join-Path $PSScriptRoot 'local-ai-common.ps1')
if (-not (Test-Path -LiteralPath $script:LocalAIExe)) {
    if ($IfInstalled) { return }
    throw 'Run scripts/Install-LocalAI.ps1 first.'
}
New-Item -ItemType Directory -Force -Path $script:LocalAIRoot | Out-Null
$aiLock = $null
try {
    $aiLock = [IO.File]::Open((Join-Path $script:LocalAIRoot 'startup.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $owned = Get-OwnedLocalAIProcess
    if ($owned) {
        if (-not (Test-LocalAIHealth)) { throw 'Managed local AI is running but unavailable. Stop and restart it.' }
        Write-Host 'Local AI is already running.'
        return
    }
    if (Test-LocalAIHealth) {
        Write-Host 'Using an existing local Ollama service; its lifecycle is managed separately.'
        return
    }
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 11434)
    try { $probe.Start() } catch { throw 'Port 11434 is occupied. No process was stopped.' } finally { $probe.Stop() }
    Set-LocalAIEnvironment
    $owned = Start-Process -FilePath $script:LocalAIExe -ArgumentList 'serve' -WorkingDirectory $script:LocalAIRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $script:LocalAIRoot 'stdout.log') -RedirectStandardError (Join-Path $script:LocalAIRoot 'stderr.log') -PassThru
    $saved = @{ processId = $owned.Id; startedUtcTicks = $owned.StartTime.ToUniversalTime().Ticks.ToString(); executable = $script:LocalAIExe }
    [IO.File]::WriteAllText($script:LocalAIState, ($saved | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-LocalAIHealth) { Write-Host 'Local AI ready at http://127.0.0.1:11434 (cloud disabled).'; return }
        $owned.Refresh()
        if ($owned.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    $owned = Get-OwnedLocalAIProcess
    if ($owned) { Stop-Process -InputObject $owned }
    if (Test-Path -LiteralPath $script:LocalAIState) { Remove-Item -LiteralPath $script:LocalAIState -Force }
    throw 'Local AI did not start. See .runtime/local-ai/stderr.log.'
} finally { if ($aiLock) { $aiLock.Dispose() } }
