. (Join-Path $PSScriptRoot 'local-ai-common.ps1')
$archive = Join-Path $script:LocalAIRoot 'downloads\ollama-windows-amd64-v0.34.4.zip'
$expectedHash = '535193f38f3344e5b08f5d1c171c31ce11aa17f0124ff69ae26d8ec7fe06fa62'
$installMarker = Join-Path $script:LocalAIRoot 'ollama-v0.34.4\installed.sha256'
if (-not (Test-Path -LiteralPath $script:LocalAIExe) -or -not (Test-Path -LiteralPath $installMarker) -or ([IO.File]::ReadAllText($installMarker).Trim() -ne $expectedHash)) {
    $running = Get-OwnedLocalAIProcess
    if ($running) { throw 'Stop the managed local AI before repairing its runtime installation.' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archive) | Out-Null
    if (-not (Test-Path -LiteralPath $archive)) {
        & curl.exe --fail --location --retry 2 --output $archive 'https://github.com/ollama/ollama/releases/download/v0.34.4/ollama-windows-amd64.zip'
        if ($LASTEXITCODE -ne 0) { throw 'Ollama download failed. Remove the incomplete archive before retrying.' }
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
        throw 'Ollama archive checksum mismatch. Remove the incomplete archive before retrying.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath (Split-Path -Parent $script:LocalAIExe) -Force
    [IO.File]::WriteAllText($installMarker, $expectedHash, [Text.UTF8Encoding]::new($false))
}
& (Join-Path $PSScriptRoot 'Start-LocalAI.ps1')
Set-LocalAIEnvironment
if (-not (Get-OwnedLocalAIProcess)) { Write-Warning 'An external Ollama service manages model storage and cloud settings; this installer does not change that service.' }
& $script:LocalAIExe pull $script:LocalAIModel
if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Run this installer again to resume.' }
Write-Host 'Local model installed. Start.cmd will start its API automatically.'
