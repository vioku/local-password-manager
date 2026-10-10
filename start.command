#!/usr/bin/env bash
# macOS launcher: double-click this file in Finder to open Terminal.
# First time: right-click > Open (Gatekeeper), or run: chmod +x start.command
DIR="$(cd "$(dirname "$0")" && pwd)" || exit 1
exec bash "$DIR/start.sh"
