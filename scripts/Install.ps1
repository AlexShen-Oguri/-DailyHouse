param([switch]$BackendOnly, [switch]$RunTests)
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$null = Get-WorkbenchNode
Initialize-WorkbenchConfig
if (Get-ManagedWorkbenchProcess) { throw 'Stop the running workbench with Stop.cmd before reinstalling dependencies.' }
$cachePath = Join-Path $script:RuntimeDir 'npm-cache'
$packages = @('backend')
if (-not $BackendOnly) { $packages += 'frontend' }
foreach ($package in $packages) {
    $directory = Join-Path $script:WorkbenchRoot $package
    if (-not (Test-Path -LiteralPath (Join-Path $directory 'package-lock.json'))) {
        throw "Missing $package/package-lock.json. Restore the lockfile before installing."
    }
    Write-Host "Installing $package dependencies..."
    Invoke-WorkbenchNpm $directory @('ci', '--no-audit', '--no-fund', '--prefer-online', '--offline=false', '--cache', $cachePath)
    Write-Host "Building $package..."
    Invoke-WorkbenchNpm $directory @('run', 'build')
    if ($RunTests) { Invoke-WorkbenchNpm $directory @('test') }
}
Write-Host 'Installation complete. Double-click Start.cmd to open your workbench.'
Write-Host 'Apple Calendar: connect an existing iCloud subscription or exported ICS file in Settings.'
