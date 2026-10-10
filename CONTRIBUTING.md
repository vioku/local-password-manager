# Contributing

Thanks for your interest! Bug reports, ideas, documentation, translations, and code contributions are all welcome.

## Set up your environment

You need Node.js 18 or newer. There are no dependencies to install.

```bash
git clone https://github.com/USERNAME/local-password-manager.git
cd local-password-manager
npm test        # all tests should pass
npm start       # run the app (vault is in ./data, which is git-ignored)
```

Use a separate development vault to keep your personal vault safe:

```bash
PM_VAULT_PATH=/tmp/dev-vault.json npm start
```

## Workflow

1. Open an Issue to discuss larger changes before starting work.
2. Fork the repo and create a branch (`fix/...`, `feat/...`, `docs/...`).
3. Add or update tests for your changes, then run `npm test`.
4. Open a Pull Request with a short explanation of what changed and why.

## Important guidelines

- **No runtime dependencies.** Don't add npm packages; use Node.js built-ins.
- **Cryptography and the vault format are carefully maintained.** Changes to `src/crypto.js`, `src/vault.js`, or the file format must be discussed in an Issue first, preserve backward compatibility (old vaults must still open; include migration tests), and must not weaken existing parameters.
- **Never log secrets.** Don't log passwords or keys with `console.log`, including in debugging code that gets committed.
- **Never attach a real vault** or personal data to an Issue, PR, test, or screenshot.
- UI changes should use helpers in `src/ui.js` rather than raw ANSI codes so `NO_COLOR` and ASCII mode keep working.
- Code style: `"use strict"`, CommonJS, 2 spaces, semicolons. Keep comments focused on why something is done.
- Cross-platform changes involving files, clipboard, or terminal behavior must work on Windows, macOS, and Linux (CI tests all three).

## Reporting bugs

Include the app version, OS, `node -v`, reproduction steps, and the error message. **Never include your vault contents or passwords.** For security issues, follow [SECURITY.md](SECURITY.md).

## Maintainer notes

When committing from Windows, executable bits on shell scripts may be lost. Make sure Git records them:

```bash
git update-index --chmod=+x start.sh start.command scripts/install-linux-shortcut.sh src/index.js
```

`.gitattributes` preserves line endings: `*.cmd` = CRLF, `*.sh`/`*.command` = LF.

## License

By contributing, you agree to license your contributions under the [MIT](LICENSE) license.
