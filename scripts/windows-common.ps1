Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:WorkbenchRoot = Split-Path -Parent $PSScriptRoot
$script:RuntimeDir = Join-Path $script:WorkbenchRoot '.runtime'
$script:StateFile = Join-Path $script:RuntimeDir 'backend.windows.json'
$script:BackendEntry = Join-Path $script:WorkbenchRoot 'backend\dist\index.js'

function Get-WorkbenchNode {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { throw 'Node.js 24 is required. Install Node.js 24, then try again.' }
    $version = & $command.Source --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw 'This workbench requires Node.js 24.' }
    return $command.Source
}

function Initialize-WorkbenchConfig {
    New-Item -ItemType Directory -Force -Path $script:RuntimeDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $script:WorkbenchRoot 'backend\data') | Out-Null
    $configPath = Join-Path $script:WorkbenchRoot 'backend\.env.local'
    if (-not (Test-Path -LiteralPath $configPath)) {
        $template = [IO.File]::ReadAllText((Join-Path $script:WorkbenchRoot 'backend\.env.example'))
        [IO.File]::WriteAllText($configPath, $template, [Text.UTF8Encoding]::new($false))
        Write-Host 'Created local configuration. Connect Obsidian and Apple Calendar in Settings when ready.'
    }
}

function Get-WorkbenchPort {
    $configPath = Join-Path $script:WorkbenchRoot 'backend\.env.local'
    $portNumber = 3456
    if (Test-Path -LiteralPath $configPath) {
        foreach ($line in [IO.File]::ReadAllLines($configPath)) {
            if ($line -match '^\s*PORT\s*=\s*(\d+)\s*$') { $portNumber = [int]$Matches[1]; break }
        }
    }
    if ($portNumber -lt 1 -or $portNumber -gt 65535) { throw 'PORT must be between 1 and 65535.' }
    return $portNumber
}

function Get-ManagedWorkbenchProcess {
    if (-not (Test-Path -LiteralPath $script:StateFile)) { return $null }
    $state = [IO.File]::ReadAllText($script:StateFile) | ConvertFrom-Json
    if ($state.root -ne $script:WorkbenchRoot -or $state.entry -ne $script:BackendEntry) {
        throw 'The saved process belongs to a different installation. No process was stopped.'
    }
    $serverProcess = Get-Process -Id ([int]$state.processId) -ErrorAction SilentlyContinue
    if (-not $serverProcess) {
        Remove-Item -LiteralPath $script:StateFile -Force
        return $null
    }
    if ($serverProcess.Path -ne $state.node -or $serverProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.startedUtcTicks) {
        throw 'The saved PID has been reused by another process. No process was stopped.'
    }
    return $serverProcess
}

function Test-WorkbenchHealth([int]$Port) {
    try {
        $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/health")
        $request.Proxy = $null
        $request.Timeout = 1500
        $response = $request.GetResponse()
        try {
            $reader = [IO.StreamReader]::new($response.GetResponseStream())
            try { $health = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
            return ($health.ok -eq $true -and $health.appVersion -eq ([IO.File]::ReadAllText((Join-Path $script:WorkbenchRoot 'VERSION')).Trim()))
        } finally { $response.Dispose() }
    } catch { return $false }
}

function Invoke-WorkbenchNpm([string]$Directory, [string[]]$NpmArguments) {
    $npmCommand = Get-Command npm.cmd -ErrorAction Stop
    Push-Location $Directory
    try {
        & $npmCommand.Source @NpmArguments
        if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArguments[0]) failed with exit code $LASTEXITCODE." }
    } finally { Pop-Location }
}
