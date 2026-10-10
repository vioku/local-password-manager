#!/usr/bin/env bash
# Linux / macOS launcher for Local Password Manager.
# Run:  ./start.sh     (if you get "Permission denied": chmod +x start.sh)

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
cd "$DIR" || exit 1

hold() {
  # Keep the terminal window open so you can read any messages (e.g. when double-clicked).
  echo
  read -r -p "Press Enter to close..." _ || true
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Install Node.js 18+ from https://nodejs.org or your package manager:"
  echo "  Ubuntu/Debian : sudo apt install nodejs"
  echo "  Fedora        : sudo dnf install nodejs"
  echo "  Arch          : sudo pacman -S nodejs"
  echo "  macOS (brew)  : brew install node"
  hold
  exit 1
fi

if ! node -e 'process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)'; then
  echo "Your Node.js version is too old ($(node -v)). Version 18 or newer is required."
  hold
  exit 1
fi

node "$DIR/src/index.js"
code=$?

if [ "$code" -ne 0 ] && [ "$code" -ne 130 ] && [ "$code" -ne 143 ]; then
  echo
  echo "The program exited with code $code."
  hold
fi

exit "$code"
