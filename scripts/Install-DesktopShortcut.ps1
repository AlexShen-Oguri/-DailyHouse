$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktopDirectory = [IO.Path]::GetFullPath([Environment]::GetFolderPath('DesktopDirectory'))
$launcherPath = Join-Path $desktopDirectory '启动日常小院.cmd'
$shortcutPath = Join-Path $desktopDirectory '日常小院.lnk'
$startCommand = Join-Path $projectRoot 'Start.cmd'
$iconPath = Join-Path $projectRoot 'assets\garden-launcher.ico'
foreach ($requiredFile in @($startCommand, $iconPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Required file is missing: $requiredFile" }
}
foreach ($desktopTarget in @($launcherPath, $shortcutPath)) {
    if (-not [IO.Path]::GetFullPath($desktopTarget).StartsWith($desktopDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'The launcher target is outside the Desktop directory.' }
}
$launcherText = "@echo off`r`nchcp 65001 >nul`r`ncall `"$startCommand`" %*`r`n"
if (Test-Path -LiteralPath $launcherPath) {
    $existingText = [IO.File]::ReadAllText($launcherPath)
    if ($existingText -ne $launcherText) { throw 'A different Desktop CMD already exists with this name. No file was overwritten.' }
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.Description -ne '日常小院 · 个人工作台') { throw 'A different Desktop shortcut already exists with this name. No file was overwritten.' }
[IO.File]::WriteAllText($launcherPath, $launcherText, [Text.UTF8Encoding]::new($false))
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
$shortcut.Arguments = '/c ""' + $launcherPath + '""'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = $iconPath + ',0'
$shortcut.WindowStyle = 7
$shortcut.Description = '日常小院 · 个人工作台'
$shortcut.Save()
$verification = $shell.CreateShortcut($shortcutPath)
if ($verification.IconLocation -ne ($iconPath + ',0') -or $verification.Arguments -ne ('/c ""' + $launcherPath + '""')) { throw 'The saved Desktop shortcut did not match the requested launcher.' }
[pscustomobject]@{ Launcher = $launcherPath; Shortcut = $shortcutPath; Target = $verification.TargetPath; Arguments = $verification.Arguments; Icon = $verification.IconLocation; WindowStyle = $verification.WindowStyle }
