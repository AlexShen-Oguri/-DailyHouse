. (Join-Path $PSScriptRoot 'local-ai-common.ps1')
if (-not (Test-Path -LiteralPath $script:LocalAIRoot)) { return }
$aiLock = $null
try {
    $aiLock = [IO.File]::Open((Join-Path $script:LocalAIRoot 'startup.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $owned = Get-OwnedLocalAIProcess
    if ($owned) {
        # Unload our model before stopping our server so GPU memory is released.
        try { Invoke-RestMethod 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -Body (@{model=$script:LocalAIModel;keep_alive=0} | ConvertTo-Json) -TimeoutSec 10 | Out-Null } catch { }
        Stop-Process -InputObject $owned
        $owned.WaitForExit(5000) | Out-Null
        Write-Host 'Managed local AI stopped.'
    }
    if (Test-Path -LiteralPath $script:LocalAIState) { Remove-Item -LiteralPath $script:LocalAIState -Force }
} finally { if ($aiLock) { $aiLock.Dispose() } }
