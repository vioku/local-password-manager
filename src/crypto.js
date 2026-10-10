"use strict";

const crypto = require("crypto");

const MAGIC = "lpm-vault";
const FORMAT_VERSION = 2;

const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const PAD_BLOCK = 4096;

// scrypt: N=2^17, r=8, p=1 (128 MiB) = OWASP minimum recommendation.
const DEFAULT_KDF = Object.freeze({ N: 1 << 17, r: 8, p: 1 });

// Bounds for parameters read from the vault file, so a
// tampered file cannot force excessive memory or CPU usage.
const KDF_LIMITS = Object.freeze({
  minN: 1 << 14,
  maxN: 1 << 18,
  minR: 8,
  maxR: 16,
  maxP: 4,
  maxMemory: 512 * 1024 * 1024
});

class VaultFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "VaultFormatError";
    this.code = "BAD_FORMAT";
  }
}

class DecryptError extends Error {
  constructor() {
    super("Wrong master password, or the vault is corrupted / modified.");
    this.name = "DecryptError";
    this.code = "BAD_PASSWORD";
  }
}

function assertKdfParams({ N, r, p }) {
  const ok =
    Number.isInteger(N) && Number.isInteger(r) && Number.isInteger(p) &&
    N >= KDF_LIMITS.minN && N <= KDF_LIMITS.maxN && (N & (N - 1)) === 0 &&
    r >= KDF_LIMITS.minR && r <= KDF_LIMITS.maxR &&
    p >= 1 && p <= KDF_LIMITS.maxP &&
    128 * N * r <= KDF_LIMITS.maxMemory;

  if (!ok) throw new VaultFormatError("Invalid KDF parameters in vault.");
}

function passwordBytes(password, normalize) {
  const text = String(password);
  return Buffer.from(normalize ? text.normalize("NFKC") : text, "utf8");
}

function deriveKey(passwordBuf, salt, { N, r, p }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      passwordBuf,
      salt,
      KEY_LEN,
      { N, r, p, maxmem: 128 * N * r + 128 * r * p + (4 << 20) },
      (err, key) => {
        passwordBuf.fill(0);
        err ? reject(err) : resolve(key);
      }
    );
  });
}

function decodeFixed(value, length, label) {
  if (typeof value !== "string") throw new VaultFormatError(`Invalid ${label} field.`);
  const buf = Buffer.from(value, "base64");
  if (buf.length !== length) throw new VaultFormatError(`Invalid ${label} field.`);
  return buf;
}

// Header (version + KDF params + salt) is authenticated by GCM,
// so they cannot be changed without causing decryption to fail.
function buildAad({ N, r, p }, salt) {
  return Buffer.from(
    [MAGIC, FORMAT_VERSION, "scrypt", N, r, p, salt.toString("base64")].join("|"),
    "utf8"
  );
}

function padPlaintext(buf) {
  const size = Math.ceil((buf.length + 1) / PAD_BLOCK) * PAD_BLOCK;
  const padded = Buffer.alloc(size, 0x20); // space: ignored by JSON.parse
  buf.copy(padded);
  return padded;
}

/**
 * Create a new key context (random salt + derived key) from the master password.
 * The context stays in memory during the session, so the master password
 * is not stored, and each save does not need to re-run scrypt.
 */
async function createKeyContext(password, kdf = DEFAULT_KDF) {
  const params = { N: kdf.N, r: kdf.r, p: kdf.p };
  assertKdfParams(params);
  const salt = crypto.randomBytes(SALT_LEN);
  const key = await deriveKey(passwordBytes(password, true), salt, params);
  return { key, salt, kdf: params };
}

function wipeContext(ctx) {
  if (ctx && ctx.key) ctx.key.fill(0);
}

/** Verify the master password against the session context (constant time). */
async function verifyPassword(ctx, password) {
  const candidate = await deriveKey(passwordBytes(password, true), ctx.salt, ctx.kdf);
  try {
    return crypto.timingSafeEqual(candidate, ctx.key);
  } finally {
    candidate.fill(0);
  }
}

function encryptVault(vault, ctx) {
  const iv = crypto.randomBytes(IV_LEN); // Fresh IV on every save
  const cipher = crypto.createCipheriv("aes-256-gcm", ctx.key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(buildAad(ctx.kdf, ctx.salt));

  const plaintext = padPlaintext(Buffer.from(JSON.stringify(vault), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  plaintext.fill(0);

  return {
    format: MAGIC,
    version: FORMAT_VERSION,
    kdf: { algorithm: "scrypt", ...ctx.kdf, salt: ctx.salt.toString("base64") },
    cipher: {
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64")
    },
    data: ciphertext.toString("base64")
  };
}

function gcmDecrypt(key, iv, authTag, ciphertext, aad) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(authTag);
  if (aad) decipher.setAAD(aad);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  try {
    return JSON.parse(plaintext.toString("utf8"));
  } finally {
    plaintext.fill(0);
  }
}

function readParts(file) {
  if (!file.kdf || !file.cipher || typeof file.data !== "string") {
    throw new VaultFormatError("Invalid vault file structure.");
  }
  const params = { N: file.kdf.N, r: file.kdf.r, p: file.kdf.p };
  assertKdfParams(params);
  return {
    params,
    salt: decodeFixed(file.kdf.salt, SALT_LEN, "salt"),
    iv: decodeFixed(file.cipher.iv, IV_LEN, "iv"),
    authTag: decodeFixed(file.cipher.authTag, TAG_LEN, "authTag"),
    ciphertext: Buffer.from(file.data, "base64")
  };
}

/**
 * Decrypt a vault file. Returns { vault, ctx, migrated }.
 * Legacy v1 vaults can still be opened; the result gets a fresh key context
 * (stronger KDF, new salt) and `migrated: true` so it is re-saved immediately.
 */
async function decryptVault(file, password) {
  if (!file || typeof file !== "object") {
    throw new VaultFormatError("Invalid vault file.");
  }

  if (file.version === 1) {
    const { params, salt, iv, authTag, ciphertext } = readParts(file);
    // v1 uses raw password bytes (no unicode normalization).
    const key = await deriveKey(passwordBytes(password, false), salt, params);
    let vault;
    try {
      vault = gcmDecrypt(key, iv, authTag, ciphertext, null);
    } catch {
      throw new DecryptError();
    } finally {
      key.fill(0);
    }
    const ctx = await createKeyContext(password);
    return { vault, ctx, migrated: true };
  }

  if (file.version !== FORMAT_VERSION || file.format !== MAGIC) {
    throw new VaultFormatError("Unsupported vault version/format.");
  }

  const { params, salt, iv, authTag, ciphertext } = readParts(file);
  const key = await deriveKey(passwordBytes(password, true), salt, params);

  try {
    const vault = gcmDecrypt(key, iv, authTag, ciphertext, buildAad(params, salt));
    return { vault, ctx: { key, salt, kdf: params }, migrated: false };
  } catch {
    key.fill(0);
    throw new DecryptError();
  }
}

module.exports = {
  DEFAULT_KDF,
  VaultFormatError,
  DecryptError,
  createKeyContext,
  wipeContext,
  verifyPassword,
  encryptVault,
  decryptVault
};
