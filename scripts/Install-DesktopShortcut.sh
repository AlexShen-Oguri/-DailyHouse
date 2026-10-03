#!/bin/bash
set -euo pipefail
umask 077

if [ "$(uname -s)" != Darwin ]; then echo 'This desktop launcher requires macOS.' >&2; exit 1; fi
project_root="$(cd "$(dirname "$0")/.." && pwd -P)"
destination="$HOME/Desktop"
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != --destination ]; then
    echo 'Usage: Install-DesktopShortcut.command [--destination existing-directory]' >&2
    exit 1
  fi
  destination="$2"
fi
destination="$(cd "$destination" && pwd -P)"
target="$destination/日常小院.app"
icon="$project_root/assets/garden-launcher.icns"
bundle_id='com.dailyhouse.desktop-launcher'

if [ ! -f "$project_root/Start.command" ] || [ ! -f "$icon" ]; then
  echo 'Start.command or assets/garden-launcher.icns is missing. Restore the source files first.' >&2
  exit 1
fi
case "$project_root" in *$'\n'*|*$'\r'*) echo 'A project path with a newline cannot be used for a desktop launcher.' >&2; exit 1 ;; esac
if [ -e "$target" ] || [ -L "$target" ]; then
  if [ -L "$target" ] || [ ! -d "$target" ] || [ ! -f "$target/Contents/Resources/workbench-root.txt" ]; then
    echo 'An unrelated item named 日常小院.app already exists. No item was overwritten.' >&2
    exit 1
  fi
  saved_id="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$target/Contents/Info.plist" 2>/dev/null || true)"
  saved_root="$(cat "$target/Contents/Resources/workbench-root.txt")"
  if [ "$saved_id" != "$bundle_id" ] || [ "$saved_root" != "$project_root" ]; then
    echo 'The existing launcher belongs to another installation. No item was overwritten.' >&2
    exit 1
  fi
fi

staging="$(mktemp -d "$destination/.dailyhouse-shortcut.XXXXXX")"
trap 'if [ ! -e "$target" ] && [ -d "$staging/previous.app" ]; then mv "$staging/previous.app" "$target"; fi; rm -rf "$staging"' EXIT
app="$staging/日常小院.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$icon" "$app/Contents/Resources/garden-launcher.icns"
printf '%s\n' "$project_root" > "$app/Contents/Resources/workbench-root.txt"
printf 'APPL????' > "$app/Contents/PkgInfo"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.dailyhouse.desktop-launcher</string>
  <key>CFBundleName</key><string>日常小院</string>
  <key>CFBundleDisplayName</key><string>日常小院</string>
  <key>CFBundleExecutable</key><string>DailyHouse</string>
  <key>CFBundleIconFile</key><string>garden-launcher.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
cat > "$app/Contents/MacOS/DailyHouse" <<'LAUNCHER'
#!/bin/bash
set -euo pipefail
umask 077
resources="$(cd "$(dirname "$0")/../Resources" && pwd)"
IFS= read -r workbench_root < "$resources/workbench-root.txt"
# LaunchServices hands the project command to Terminal, so the normal macOS
# document-access permissions apply instead of an unsigned shell app reading it.
if ! /usr/bin/open -a Terminal "$workbench_root/Start.command"; then
  /usr/bin/open "$resources/LauncherHelp.txt"
  exit 1
fi
LAUNCHER
cat > "$app/Contents/Resources/LauncherHelp.txt" <<'HELP'
日常小院的项目目录可能已移动，当前桌面快捷方式无法找到 Start.command。
请在项目的新位置双击 Install-DesktopShortcut.command，重建桌面入口。
如果提示旧入口属于另一处安装，先将旧的“日常小院.app”移到废纸篓后再重建。
只删除桌面入口不会删除小院数据、项目源码或停止已经运行的服务。
HELP
chmod +x "$app/Contents/MacOS/DailyHouse"
/usr/bin/plutil -lint -s "$app/Contents/Info.plist"

if [ -d "$target" ]; then mv "$target" "$staging/previous.app"; fi
if ! mv "$app" "$target"; then
  if [ -d "$staging/previous.app" ]; then mv "$staging/previous.app" "$target"; fi
  echo 'Could not install the desktop launcher.' >&2
  exit 1
fi
echo "Desktop launcher installed: $target"
echo 'Double-click 日常小院 to run Start.command in Terminal and open the browser.'
