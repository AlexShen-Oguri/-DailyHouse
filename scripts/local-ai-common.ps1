Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:LocalAIRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '.runtime\local-ai'
$script:LocalAIExe = Join-Path $script:LocalAIRoot 'ollama-v0.34.4\ollama.exe'
$script:LocalAIState = Join-Path $script:LocalAIRoot 'process.json'
$script:LocalAIModel = 'hf.co/unsloth/Qwen3.5-4B-GGUF:Q4_K_M'

function Set-LocalAIEnvironment {
    $env:OLLAMA_HOST = '127.0.0.1:11434'
    $env:OLLAMA_MODELS = Join-Path $script:LocalAIRoot 'models'
    $env:OLLAMA_NO_CLOUD = '1'
    $env:OLLAMA_CONTEXT_LENGTH = '8192'
    $env:OLLAMA_NUM_PARALLEL = '1'
    $env:OLLAMA_MAX_LOADED_MODELS = '1'
}

function Test-LocalAIHealth {
    try {
        $result = Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 2
        return [bool]$result.version
    } catch { return $false }
}

function Get-OwnedLocalAIProcess {
    if (-not (Test-Path -LiteralPath $script:LocalAIState)) { return $null }
    $saved = [IO.File]::ReadAllText($script:LocalAIState) | ConvertFrom-Json
    if ($saved.executable -ne $script:LocalAIExe) { throw 'Local AI state belongs to another installation.' }
    $owned = Get-Process -Id ([int]$saved.processId) -ErrorAction SilentlyContinue
    if (-not $owned) { Remove-Item -LiteralPath $script:LocalAIState -Force; return $null }
    if ($owned.Path -ne $script:LocalAIExe -or $owned.StartTime.ToUniversalTime().Ticks.ToString() -ne $saved.startedUtcTicks) {
        throw 'Local AI PID was reused; no process will be stopped.'
    }
    return $owned
}
