#!/bin/bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "$0")/.." && pwd)"
runtime="$root/.runtime"
action="${1:-start}"
case "$action" in install|start|stop) ;; *) echo 'Usage: macos.sh install|start|stop [--run-tests|--no-browser]' >&2; exit 1 ;; esac
if [ "$(uname -s)" != Darwin ]; then echo 'This launcher requires macOS.' >&2; exit 1; fi
mkdir -p "$runtime"

# Prefer the project-local runtime, then an existing compatible Node + npm.
node_bin="$runtime/node/bin/node"
npm_bin="$runtime/node/bin/npm"
if [ ! -x "$node_bin" ] || [ ! -x "$npm_bin" ]; then
  node_bin="$(command -v node || true)"
  npm_bin="$(command -v npm || true)"
fi
if [ -z "$node_bin" ] || [ -z "$npm_bin" ] || [[ "$("$node_bin" --version 2>/dev/null || true)" != v24.* ]]; then
  if [ "$action" = stop ] && [ ! -f "$runtime/backend.macos.json" ]; then
    echo 'Workbench is not running.'
    exit 0
  fi
  if [ "$action" = stop ]; then echo 'Node.js 24 is required to stop the saved server safely. Restore .runtime/node first.' >&2; exit 1; fi
  case "$(uname -m)" in
    arm64) arch=arm64; checksum=e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1 ;;
    x86_64) arch=x64; checksum=dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080 ;;
    *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
  esac
  if ! mkdir "$runtime/node-install.lock" 2>/dev/null; then
    echo 'Another Node installation is in progress. If it was interrupted, remove .runtime/node-install.lock and retry.' >&2
    exit 1
  fi
  staging="$(mktemp -d "$runtime/node-install.XXXXXX")"
  trap 'rm -rf "$staging"; rmdir "$runtime/node-install.lock"' EXIT
  archive="node-v24.18.0-darwin-$arch.tar.gz"
  mkdir -p "$runtime/downloads"
  archive_path="$runtime/downloads/$archive"
  if [ ! -f "$archive_path" ] || [ "$(shasum -a 256 "$archive_path" | cut -d ' ' -f 1)" != "$checksum" ]; then
    echo 'Downloading official Node.js 24.18.0 into .runtime/node...'
    curl --fail --location --retry 3 --connect-timeout 20 --output "$staging/$archive" "https://nodejs.org/download/release/v24.18.0/$archive"
    mv "$staging/$archive" "$archive_path"
  fi
  actual="$(shasum -a 256 "$archive_path" | cut -d ' ' -f 1)"
  if [ "$actual" != "$checksum" ]; then echo 'Node.js SHA256 verification failed. The downloaded file was not executed.' >&2; exit 1; fi
  mkdir "$staging/node"
  tar -xzf "$archive_path" -C "$staging/node" --strip-components=1
  if [ -e "$runtime/node" ]; then echo 'An incomplete .runtime/node exists. Move it aside and retry.' >&2; exit 1; fi
  mv "$staging/node" "$runtime/node"
  node_bin="$runtime/node/bin/node"
  npm_bin="$runtime/node/bin/npm"
  rm -rf "$staging"
  rmdir "$runtime/node-install.lock"
  trap - EXIT
fi
export PATH="$(dirname "$node_bin"):/opt/homebrew/bin:/usr/local/bin:$PATH"
export WORKBENCH_NPM_EXECUTABLE="$npm_bin"
shift || true
exec "$node_bin" "$root/scripts/macos-workbench.mjs" "$action" "$@"
