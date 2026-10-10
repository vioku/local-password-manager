<div align="center">

# 🔐 Local Password Manager

**A terminal-based, offline password vault. Encrypted, no account, no cloud, zero dependencies.**

[![CI](https://github.com/vioku/local-password-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/vioku/local-password-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

</div>

---



## Why?

- **Your data never leaves your machine.** One encrypted `vault.json`. No server, telemetry, or account.
- **Zero dependencies.** Only Node.js built-ins (`crypto`, `fs`, `readline`). No third-party supply chain to trust.
- **Small and auditable.** ~1,500 lines, no build step.
- **Double-click to run.** Launchers for Windows, macOS, and Linux.

> ⚠️ **Status:** not independently audited. Read [Limitations & disclaimer](#limitations--disclaimer) before storing critical passwords.

## Screenshot

```text
  ╭──────────────────────────────────────────────────────╮
  │ LOCAL PASSWORD MANAGER                        v1.1.0 │
  │ Local password vault, encrypted with AES-256-GCM      │
  ╰──────────────────────────────────────────────────────╯

  ◇ Unlocked  •  Entries: 12  •  Auto-lock: 5 min

   [1] New Password  generate & save a random password
   [2] List Password
   [3] Search
   [4] View Password  show / copy
   [5] Update Password
   [6] Delete Password
   [7] Generator Settings
   [8] Change Master Password
   [0] Lock / Exit

  ❯
```

## Quick start

**Requirement:** [Node.js](https://nodejs.org) **18 or newer**. No `npm install` needed.

| System | How to run |
|---|---|
| **Windows** | Double-click **`start.cmd`** |
| **macOS** | Double-click **`start.command`** (first time: right-click → *Open*) |
| **Linux** | `./start.sh`, or install the app-menu shortcut: `./scripts/install-linux-shortcut.sh` |
| **Any** | `npm start` or `node src/index.js` |

On first launch you'll be asked to create a **master password**.

Optional global command: `npm link`, then run `lpm` from anywhere.

Notes: on macOS, if Gatekeeper blocks the script use `xattr -d com.apple.quarantine start.command`; if you get *permission denied*, run `chmod +x start.sh start.command`. On legacy Windows consoles the UI falls back to ASCII automatically (use Windows Terminal for the best look).

## Features

- Add / view / search / update / delete entries; paginated lists that fit your terminal (`n` next, `p` previous).
- CSPRNG password generator (8–256 chars; upper/lower/digits/symbols) with an entropy-based strength meter.
- Copy to clipboard, auto-cleared after 30 s (only if the clipboard still holds that password).
- Change master password; 5-minute idle auto-lock; master-password confirmation before sensitive actions.
- Hidden input without history; sensitive screens don't linger in terminal scrollback.
- Color UI with `NO_COLOR` support and ASCII fallback.

## Menu

| Key | Action |
|---|---|
| `1` | Generate and save a new password (needs master-password confirmation) |
| `2` | List entries (no passwords shown) |
| `3` | Search by name / username |
| `4` | View an entry: show or copy password |
| `5` | Update name/username or regenerate password |
| `6` | Delete an entry |
| `7` | Generator settings (length, character sets) |
| `8` | Change master password (vault re-encrypted with a new salt) |
| `0` | Lock and exit |

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `PM_VAULT_PATH` | Vault file location | `data/vault.json` in the project |
| `PM_NO_ALT_SCREEN=1` | Disable the alternate screen (normal scrolling, but sensitive screens may remain in scrollback) | enabled |
| `PM_ASCII=1` / `0` | Force ASCII / Unicode UI | auto |
| `NO_COLOR=1` | Disable colors | colors on in a TTY |

## Security design

| Aspect | Choice |
|---|---|
| Encryption | **AES-256-GCM** (authenticated), 16-byte tag validated |
| KDF | **scrypt**, N=2<sup>17</sup>, r=8, p=1 (≈128 MiB; OWASP minimum recommendation) |
| Salt / IV | 16-byte random salt per vault; fresh random 12-byte IV on every save |
| Authenticated header | Version, KDF params and salt are bound as GCM **AAD** (no silent downgrade) |
| Master password | Never stored; only the derived key is kept in memory and zeroed on lock; NFKC-normalized |
| File validation | KDF parameters from the file are bounded (N ≤ 2<sup>18</sup>, ≤ 512 MiB) |
| Metadata | Plaintext padded to 4 KiB multiples to blur entry count |
| File writes | Atomic (temp file → `fsync` → `rename`), mode `0600` (Linux/macOS), conflict detection |
| Local brute force | Escalating delay, max 5 attempts per session (offline attacks are bounded by scrypt cost) |
| Clipboard | Cleared after 30 s / on lock / on exit, only if unchanged |

**Protects against:** a stolen or leaked `vault.json`; tampering/corruption; casual access to an unlocked machine (auto-lock, re-confirmation).

**Does not protect against:** malware/keyloggers/root access while running; weak master passwords; process memory (JavaScript strings can't be wiped; keys/buffers are zeroed, string copies wait for GC); old backups (still encrypted with the master password of that time).

## Vault format 

```jsonc
{
  "format": "lpm-vault",
  "version": 2,
  "kdf": { "algorithm": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "<base64, 16 bytes>" },
  "cipher": { "algorithm": "aes-256-gcm", "iv": "<base64, 12 bytes>", "authTag": "<base64, 16 bytes>" },
  "data": "<base64 ciphertext, padded to 4096-byte multiples>"
}
```

Key = `scrypt(NFKC(password), salt, N, r, p)` (32 bytes). AAD = `lpm-vault|2|scrypt|N|r|p|<salt base64>`. v1 vaults (from v1.0) open fine and are upgraded to v2 on first login.

## Backup & recovery

- **Backup:** copy `vault.json`. It is already encrypted.
- **Move to another machine:** copy the file and open it with the same master password.
- **Forgot the master password:** the vault **cannot** be recovered. No backdoor, by design.
- **Never commit the vault to Git** (`data/` is git-ignored).

## Development

```bash
npm test     # unit tests (node:test), no dependencies
npm start
```

CI runs the tests on Linux, macOS, and Windows with Node 18/20/22. See [CONTRIBUTING.md](CONTRIBUTING.md). Changes to `src/crypto.js` or the vault format need discussion and compatibility tests first.

## Limitations & disclaimer

- Provided **as is**, without warranty (see [LICENSE](LICENSE)).
- **Not independently audited.** Using standard primitives does not guarantee a flaw-free implementation.
- Keep backups and remember your master password.
- For critical use (finance, teams), consider an audited password manager.

## License

[MIT](LICENSE) © Local Password Manager contributors
