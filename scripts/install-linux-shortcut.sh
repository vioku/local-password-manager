#!/usr/bin/env bash
# Creates a "Local Password Manager" shortcut in the Linux application menu
# (~/.local/share/applications) that opens a terminal automatically.
# Remove with:  ./scripts/install-linux-shortcut.sh --remove

set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
TARGET="$TARGET_DIR/local-password-manager.desktop"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$TARGET"
  echo "Shortcut removed."
  exit 0
fi

# Paths with spaces or special characters must be quoted according to the Desktop Entry specification.
case "$ROOT" in
  *[\"\`\$\\]*) echo "Project path contains unsupported characters: $ROOT" >&2; exit 1 ;;
esac

mkdir -p "$TARGET_DIR"
chmod +x "$ROOT/start.sh"

cat > "$TARGET" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=Local Password Manager
Comment=Encrypted local password vault
Exec="$ROOT/start.sh"
Path=$ROOT
Terminal=true
Categories=Utility;Security;
Keywords=password;vault;security;
DESKTOP

chmod +x "$TARGET"
echo "Shortcut created: $TARGET"
echo "Find 'Local Password Manager' in the app menu."
