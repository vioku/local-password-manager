# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [1.1.0]

### Added
- New terminal UI with boxes, icons, a status bar, colors, and a password strength meter; automatically falls back to ASCII/monochrome (`PM_ASCII`, `NO_COLOR`).
- Paginated entry lists, search results, and selection (`n`/`p`).
- **Change Master Password** menu.
- Launchers: `start.cmd` (Windows), `start.sh` (Linux/macOS), `start.command` (macOS), and `scripts/install-linux-shortcut.sh`.
- `lpm` command (via `npm link`), `PM_VAULT_PATH`, and `PM_NO_ALT_SCREEN`.
- Master-password confirmation with three attempts (press Enter to cancel).
- Unit tests, GitHub Actions CI, full English documentation, SECURITY, and CONTRIBUTING guides.

### Security
- Increased scrypt from 32 MiB to 128 MiB (N=2^17).
- Added vault format **v2**: the header (version, KDF parameters, salt) is authenticated through AAD; auth-tag length is validated; KDF parameters from files are bounded; data is padded to 4 KiB; passwords are NFKC-normalized.
- The master password is no longer retained in memory; only the derived key remains, and it is zeroed on lock.
- Atomic file writes with `fsync`, `0600` permissions, and write-conflict detection.
- Clipboard cleanup only clears the copied password if it hasn't changed; also runs on lock and exit.
- Hidden password input, alternate screen, and scrollback cleanup.
- Login delays and attempt limits.

### Fixed
- Password characters appearing twice or in plain text while typing (`s*s*d*...`).
- Idle auto-lock not triggering while waiting at a prompt.
- Crash during master-password confirmation when input lengths differed (`timingSafeEqual`).
- KDF parameters in the file being ignored during decryption.
- Dependency on `which` for clipboard detection.

### Migration
- v1 vaults are automatically upgraded to v2 on first login. Version 1.0 cannot open v2 vaults; keep a backup if needed.

## [1.0.0]
- Initial release: AES-256-GCM + scrypt encrypted vault, password generator, and clipboard support.
