#!/bin/bash
set -euo pipefail
exec /bin/bash "$(cd "$(dirname "$0")" && pwd)/scripts/macos.sh" start "$@"
