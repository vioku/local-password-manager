"use strict";

const crypto = require("crypto");
const { spawn } = require("child_process");

const PS = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command"];

function backends() {
  if (process.platform === "win32") {
    return [{
      set: [...PS, "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
      get: [...PS, "Get-Clipboard -Raw"],
      clear: [...PS, "Set-Clipboard -Value $null"]
    }];
  }

  if (process.platform === "darwin") {
    return [{ set: ["pbcopy"], get: ["pbpaste"] }];
  }

  const list = [];
  if (process.env.WAYLAND_DISPLAY) {
    list.push({
      set: ["wl-copy"],
      get: ["wl-paste", "--no-newline"],
      clear: ["wl-copy", "--clear"]
    });
  }
  list.push(
    { set: ["xclip", "-selection", "clipboard"], get: ["xclip", "-selection", "clipboard", "-o"] },
    { set: ["xsel", "--clipboard", "--input"], get: ["xsel", "--clipboard", "--output"] },
    { set: ["termux-clipboard-set"], get: ["termux-clipboard-get"] }
  );
  return list;
}

/** Run a command without a shell. Returns { ok, missing, stdout } */
function run(cmd, { input = "", capture = false } = {}) {
  return new Promise(resolve => {
    let stdout = "";
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, ...result });
    };

    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: ["pipe", capture ? "pipe" : "ignore", "ignore"],
      windowsHide: true
    });

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, missing: false });
    }, 5000);

    if (capture) child.stdout.on("data", d => { stdout += d; });
    child.on("error", err => finish({ ok: false, missing: err.code === "ENOENT" }));
    child.on("close", code => finish({ ok: code === 0, missing: false }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

let active = null; // backend known to work

async function setClipboard(text) {
  if (active) return (await run(active.set, { input: text })).ok;

  for (const backend of backends()) {
    const res = await run(backend.set, { input: text });
    if (res.ok) {
      active = backend;
      return true;
    }
  }
  return false;
}

async function getClipboard() {
  if (!active) return null;
  const res = await run(active.get, { capture: true });
  return res.ok ? res.stdout : null;
}

async function clearClipboard() {
  if (!active) return false;
  if (active.clear) return (await run(active.clear)).ok;
  return (await run(active.set, { input: "" })).ok;
}

const fingerprint = text =>
  crypto.createHash("sha256").update(text.replace(/[\r\n]+$/, "")).digest("hex");

let pending = null; // { hash, timer }

/** Copy a secret to the clipboard and schedule automatic cleanup. */
async function copySecret(text, ttlMs) {
  if (!(await setClipboard(text))) return false;

  if (pending) clearTimeout(pending.timer);
  const timer = setTimeout(() => { clearIfUnchanged().catch(() => {}); }, ttlMs);
  timer.unref();
  pending = { hash: fingerprint(text), timer };
  return true;
}

/**
 * Clear the clipboard only if it still contains the value we copied
 * (so we don't erase something else the user copied). If its contents can't
 * be read, clear it anyway as a safety measure.
 */
async function clearIfUnchanged() {
  if (!pending) return;
  const { hash, timer } = pending;
  clearTimeout(timer);
  pending = null;

  const current = await getClipboard();
  if (current === null || fingerprint(current) === hash) {
    await clearClipboard();
  }
}

module.exports = { copySecret, clearIfUnchanged };
