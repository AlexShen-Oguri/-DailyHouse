#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
if [ ! -x "$root/.runtime/node/bin/node" ]; then echo 'Please restore the project-local Node.js 24 runtime first.' >&2; exit 1; fi
exec "$root/.runtime/node/bin/node" "$root/scripts/macos-daily-reading.mjs" disable
