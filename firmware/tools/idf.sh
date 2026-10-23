#!/usr/bin/env bash
set -euo pipefail
INK_FIRMWARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "${IDF_PATH:-}/export.sh" ]]; then
    export IDF_PATH="$INK_FIRMWARE_DIR/.tools/esp-idf"
    export IDF_TOOLS_PATH="$INK_FIRMWARE_DIR/.tools/idf-tools"
fi
if [[ ! -f "$IDF_PATH/export.sh" ]]; then
    echo "ESP-IDF is missing. Follow firmware/README.md to install ESP-IDF v5.3.4." >&2
    exit 1
fi
set +u # ESP-IDF's environment script reads optional unset shell variables.
source "$IDF_PATH/export.sh" >/dev/null
set -u
cd "$INK_FIRMWARE_DIR"
exec idf.py "$@"
