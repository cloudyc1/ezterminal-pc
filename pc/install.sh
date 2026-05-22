#!/usr/bin/env bash
set -euo pipefail

PC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$PC_DIR/link" start
