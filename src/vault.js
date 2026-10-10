"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { encryptVault, decryptVault, VaultFormatError } = require("./crypto");

// Set PM_VAULT_PATH to change the vault location (useful for backups and tests).
const VAULT_PATH = process.env.PM_VAULT_PATH
  ? path.resolve(process.env.PM_VAULT_PATH)
  : path.join(__dirname, "..", "data", "vault.json");
const DATA_DIR = path.dirname(VAULT_PATH);

// Digest of the vault file the last time this process read or wrote it
// (null = file does not exist). Used to detect changes made by another process.
let knownDigest = null;

function digest(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function createEmptyVault(settings) {
  const now = new Date().toISOString();
  return { version: 1, createdAt: now, updatedAt: now, settings, entries: [] };
}

async function readRaw() {
  try {
    return await fs.readFile(VAULT_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function vaultExists() {
  return (await readRaw()) !== null;
}

async function unlockVault(masterPassword) {
  const raw = await readRaw();
  if (raw === null) throw new VaultFormatError("Vault file not found.");

  knownDigest = digest(raw);

  let file;
  try {
    file = JSON.parse(raw);
  } catch {
    throw new VaultFormatError("Vault file is corrupted (not valid JSON).");
  }

  return decryptVault(file, masterPassword);
}

async function fsyncDir() {
  if (process.platform === "win32") return;
  try {
    const dir = await fs.open(DATA_DIR, "r");
    try { await dir.sync(); } finally { await dir.close(); }
  } catch { /* best effort */ }
}

async function saveVault(vault, ctx) {
  const current = await readRaw();
  const currentDigest = current === null ? null : digest(current);

  if (currentDigest !== knownDigest) {
    throw new Error(
      "The vault file has changed on disk since it was opened (another instance may be running). " +
      "Save cancelled to avoid overwriting data. Exit and restart the app."
    );
  }

  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

  vault.updatedAt = new Date().toISOString();
  const text = JSON.stringify(encryptVault(vault, ctx), null, 2) + "\n";

  // Atomic write: temp file -> fsync -> rename.
  const tempPath = `${VAULT_PATH}.${process.pid}.tmp`;
  const handle = await fs.open(tempPath, "w", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(tempPath, VAULT_PATH);
  } catch (err) {
    await fs.rm(tempPath, { force: true });
    throw err;
  }

  if (process.platform !== "win32") {
    await fs.chmod(VAULT_PATH, 0o600).catch(() => {});
  }
  await fsyncDir();

  knownDigest = digest(text);
}

module.exports = {
  VAULT_PATH,
  vaultExists,
  createEmptyVault,
  saveVault,
  unlockVault
};
