"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const {
  createKeyContext, encryptVault, decryptVault, verifyPassword, wipeContext
} = require("../src/crypto");

const PW = "correct horse battery staple";
const sample = { entries: [{ name: "a", password: "p@ss" }], settings: { length: 20 } };

test("roundtrip v2", async () => {
  const ctx = await createKeyContext(PW);
  const file = encryptVault(sample, ctx);
  assert.strictEqual(file.version, 2);
  assert.strictEqual(file.kdf.N, 1 << 17);
  const out = await decryptVault(JSON.parse(JSON.stringify(file)), PW);
  assert.deepStrictEqual(out.vault, sample);
  assert.strictEqual(out.migrated, false);
});

test("rejects an incorrect password", async () => {
  const file = encryptVault(sample, await createKeyContext(PW));
  await assert.rejects(decryptVault(file, "wrong-password"), { code: "BAD_PASSWORD" });
});

test("detects modified header (KDF parameters) through AAD", async () => {
  const file = encryptVault(sample, await createKeyContext(PW));
  file.kdf.N = 1 << 16;
  await assert.rejects(decryptVault(file, PW), { code: "BAD_PASSWORD" });
});

test("rejects modified ciphertext and authTag", async () => {
  const file = encryptVault(sample, await createKeyContext(PW));
  const bad = Buffer.from(file.data, "base64"); bad[0] ^= 1;
  await assert.rejects(decryptVault({ ...file, data: bad.toString("base64") }, PW), { code: "BAD_PASSWORD" });
  // truncated authTag must be rejected as an invalid format
  const short = { ...file, cipher: { ...file.cipher, authTag: Buffer.alloc(4).toString("base64") } };
  await assert.rejects(decryptVault(short, PW), { code: "BAD_FORMAT" });
});

test("rejects excessive KDF parameters (DoS protection)", async () => {
  const file = encryptVault(sample, await createKeyContext(PW));
  file.kdf.N = 1 << 24;
  await assert.rejects(decryptVault(file, PW), { code: "BAD_FORMAT" });
});

test("uses a fresh IV for each encryption and pads ciphertext size", async () => {
  const ctx = await createKeyContext(PW);
  const a = encryptVault(sample, ctx), b = encryptVault(sample, ctx);
  assert.notStrictEqual(a.cipher.iv, b.cipher.iv);
  assert.strictEqual(Buffer.from(a.data, "base64").length % 4096, 0);
});

test("verifyPassword", async () => {
  const ctx = await createKeyContext(PW);
  assert.strictEqual(await verifyPassword(ctx, PW), true);
  assert.strictEqual(await verifyPassword(ctx, "x"), false);
  assert.strictEqual(await verifyPassword(ctx, ""), false); // different length: must not crash
  wipeContext(ctx);
});

test("Unicode normalization (NFC == NFD) in v2", async () => {
  const ctx = await createKeyContext("caf\u00e9-pass-12345");
  const file = encryptVault(sample, ctx);
  const out = await decryptVault(file, "cafe\u0301-pass-12345");
  assert.deepStrictEqual(out.vault, sample);
});

test("opens and migrates legacy v1 vaults", async () => {
  // Exact copy of the legacy v1 encryption function.
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(PW, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(sample)), c.final()]);
  const v1 = {
    version: 1,
    kdf: { algorithm: "scrypt", N: 1 << 15, r: 8, p: 1, salt: salt.toString("base64") },
    cipher: { algorithm: "aes-256-gcm", iv: iv.toString("base64"), authTag: c.getAuthTag().toString("base64") },
    data: ct.toString("base64")
  };
  const out = await decryptVault(v1, PW);
  assert.deepStrictEqual(out.vault, sample);
  assert.strictEqual(out.migrated, true);
  assert.strictEqual(out.ctx.kdf.N, 1 << 17);
  await assert.rejects(decryptVault(v1, "wrong-password"), { code: "BAD_PASSWORD" });
});
