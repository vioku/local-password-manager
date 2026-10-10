"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-"));
process.env.PM_VAULT_PATH = path.join(dir, "sub", "vault.json");

const { vaultExists, createEmptyVault, saveVault, unlockVault } = require("../src/vault");
const { createKeyContext } = require("../src/crypto");

test("saves and opens vault, sets file permissions, leaves no temp files or plaintext", async () => {
  assert.strictEqual(await vaultExists(), false);
  const ctx = await createKeyContext("master-password-123");
  const v = createEmptyVault({ length: 20 });
  v.entries.push({ name: "github", username: "me", password: "SECRET-PLAINTEXT-XYZ" });
  await saveVault(v, ctx);

  const file = process.env.PM_VAULT_PATH;
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("SECRET-PLAINTEXT-XYZ") && !raw.includes("github"));
  if (process.platform !== "win32") assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ["vault.json"]);

  const out = await unlockVault("master-password-123");
  assert.strictEqual(out.vault.entries[0].password, "SECRET-PLAINTEXT-XYZ");
  await saveVault(out.vault, out.ctx); // re-save after open: must succeed
});

test("rejects writes if the file was changed by another process", async () => {
  const { vault, ctx } = await unlockVault("master-password-123");
  fs.appendFileSync(process.env.PM_VAULT_PATH, " ");
  await assert.rejects(saveVault(vault, ctx), /changed on disk/);
});

test("corrupted file -> BAD_FORMAT", async () => {
  fs.writeFileSync(process.env.PM_VAULT_PATH, "{ not json");
  await assert.rejects(unlockVault("x"), { code: "BAD_FORMAT" });
});
