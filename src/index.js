#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const cli = require("./cli");
const { vaultExists, createEmptyVault, saveVault, unlockVault } = require("./vault");
const { createKeyContext, verifyPassword, wipeContext } = require("./crypto");
const { generatePassword, estimateEntropyBits } = require("./generator");
const clipboard = require("./clipboard");
const ui = require("./ui");
const { version: VERSION } = require("../package.json");

const DEFAULT_SETTINGS = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true
};

const AUTO_LOCK_MS = Number(process.env.PM_AUTO_LOCK_MS) || 5 * 60 * 1000;
const CLIPBOARD_TTL_MS = 30 * 1000;
const MAX_UNLOCK_ATTEMPTS = 5;
const MAX_CONFIRM_ATTEMPTS = 3;
const MIN_MASTER_LENGTH = 12;

let rl;
let idleTimer = null;
let shuttingDown = false;

// All sensitive session data lives here; clearing it locks the vault.
const session = { vault: null, ctx: null };

class LockedError extends Error {}

const isUnlocked = () => session.vault !== null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Auto-lock                                                          */
/* ------------------------------------------------------------------ */

function armIdleTimer() {
  clearTimeout(idleTimer);
  if (!isUnlocked()) return;

  idleTimer = setTimeout(() => {
    lockSession("Vault locked due to inactivity.\n  Press Enter to unlock it again.");
  }, AUTO_LOCK_MS);
  idleTimer.unref();
}

// Lock the session immediately (without waiting for user input).
function lockSession(message) {
  clearTimeout(idleTimer);
  wipeContext(session.ctx);
  session.ctx = null;
  session.vault = null;
  clipboard.clearIfUnchanged().catch(() => {});

  cli.clearScreen();
  if (message) ui.warn(message);
}

function guard() {
  if (!isUnlocked()) throw new LockedError();
}

function vault() {
  guard();
  return session.vault;
}

// Prompt for an unlocked session: if the vault locks while
// waiting for input, the answer is discarded and the action is cancelled.
async function ask(question) {
  const answer = await cli.ask(rl, question);
  guard();
  armIdleTimer();
  return answer;
}

async function askHidden(question) {
  const answer = await cli.askHidden(rl, question);
  guard();
  armIdleTimer();
  return answer;
}

const pause = () => ask("\nPress Enter to go back...");

/* ------------------------------------------------------------------ */
/* Helper                                                             */
/* ------------------------------------------------------------------ */

function formatDate(value) {
  return new Date(value).toLocaleString("en-US");
}

function maskPassword(password) {
  return ui.SYM.mask.repeat(Math.min(password.length, 16));
}

const yes = answer => answer.trim().toLowerCase() === "y";
const no = answer => answer.trim().toLowerCase() === "n";

function checkMasterStrength(password) {
  const chars = [...password];
  if (chars.length < MIN_MASTER_LENGTH) {
    return `Master password must be at least ${MIN_MASTER_LENGTH} characters.`;
  }
  if (new Set(chars).size < 6) {
    return "Master password is too repetitive. Try using a wider mix of characters.";
  }
  return null;
}

async function promptNewMaster(askHiddenFn) {
  for (;;) {
    const first = await askHiddenFn("New master password: ");
    const problem = checkMasterStrength(first);

    if (problem) {
      ui.error(problem);
      continue;
    }

    const second = await askHiddenFn("Confirm master password: ");

    if (first !== second) {
      ui.error("Passwords don't match.");
      continue;
    }

    return first;
  }
}

async function confirmMaster() {
  for (let attempt = 1; attempt <= MAX_CONFIRM_ATTEMPTS; attempt++) {
    const input = await askHidden("Enter master password to confirm (press Enter to cancel): ");
    guard();

    if (input === "") return false;

    const ok = await verifyPassword(session.ctx, input);
    guard();
    if (ok) return true;

    if (attempt < MAX_CONFIRM_ATTEMPTS) {
      ui.error(`Wrong master password. Try again (${attempt}/${MAX_CONFIRM_ATTEMPTS}).`);
      await cli.whileMuted(() => sleep(500));
    }
  }
  return false;
}

async function persist() {
  guard();
  await saveVault(session.vault, session.ctx);
  armIdleTimer();
}

async function copyPassword(password) {
  const ok = await clipboard.copySecret(password, CLIPBOARD_TTL_MS);
  if (ok) {
    ui.success(`Password copied. Clipboard will be cleared automatically in ${CLIPBOARD_TTL_MS / 1000} seconds.`);
  } else {
    ui.warn("Clipboard isn't available on this system.");
  }
}

function normalizeVault(data) {
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  data.entries = Array.isArray(data.entries) ? data.entries : [];
  for (const entry of data.entries) {
    entry.name = String(entry.name ?? "");
    entry.username = String(entry.username ?? "");
    entry.password = String(entry.password ?? "");
  }
}

/* ------------------------------------------------------------------ */
/* Unlock / create                                                    */
/* ------------------------------------------------------------------ */

async function createNewVault() {
  ui.info("No vault found. Let's create a new master password.");
  ui.note("Tip: a long passphrase (4–5 random words) is stronger and easier to remember.");
  console.log();

  const password = await promptNewMaster(q => cli.askHidden(rl, q));

  ui.note("Deriving encryption key...");
  const ctx = await createKeyContext(password);
  const data = createEmptyVault({ ...DEFAULT_SETTINGS });
  await saveVault(data, ctx);

  session.vault = data;
  session.ctx = ctx;
  armIdleTimer();

  console.log();
  ui.success("Vault created successfully.");
  ui.warn("IMPORTANT: if you forget your master password, your vault can't be recovered.");
  await cli.ask(rl, "\nPress Enter to continue...");
}

async function unlock() {
  cli.clearScreen();
  ui.banner(VERSION);
  ui.status({ unlocked: false });
  console.log();

  if (!(await vaultExists())) {
    return createNewVault();
  }

  for (let attempt = 1; attempt <= MAX_UNLOCK_ATTEMPTS; attempt++) {
    const password = await cli.askHidden(rl, "Master password: ");

    try {
      ui.note("Unlocking vault...");
      const { vault: data, ctx, migrated } = await unlockVault(password);
      normalizeVault(data);

      session.vault = data;
      session.ctx = ctx;

      if (migrated) {
        await saveVault(data, ctx);
        ui.success("Vault upgraded to format v2 (stronger KDF, authenticated header).");
        await cli.ask(rl, "\nPress Enter to continue...");
      }

      armIdleTimer();
      return;
    } catch (err) {
      wipeContext(session.ctx);
      session.vault = null;
      session.ctx = null;

      if (err.code !== "BAD_PASSWORD") throw err; // corrupt format / I/O error

      ui.error(`${err.message} (attempt ${attempt}/${MAX_UNLOCK_ATTEMPTS})`);
      console.log();
      if (attempt < MAX_UNLOCK_ATTEMPTS) await cli.whileMuted(() => sleep(attempt * 1000));
    }
  }

  ui.error("Too many failed attempts.");
  await shutdown(1);
}

/* ------------------------------------------------------------------ */
/* Menu actions                                                       */
/* ------------------------------------------------------------------ */

async function newPassword() {
  cli.printHeader("NEW PASSWORD");

  const name = (await ask("App name / identifier: ")).trim();

  if (!name) {
    ui.error("App name can't be empty.");
    return pause();
  }

  const username = (await ask("Username / email: ")).trim();

  let password;
  try {
    password = generatePassword(vault().settings);
  } catch (err) {
    ui.error(`Couldn't generate password: ${err.message}`);
    return pause();
  }

  const bits = estimateEntropyBits(vault().settings);
  console.log();
  ui.success(`Password generated: ${password.length} characters`);
  ui.field("Strength", ui.strength(bits));

  if (yes(await ask("Show password? [y/N] "))) {
    ui.field("Password", password);
  }

  if (no(await ask("\nSave this password? [Y/n] "))) {
    ui.note("Cancelled.");
    return pause();
  }

  if (!(await confirmMaster())) {
    ui.error("Wrong master password. Password wasn't saved.");
    return pause();
  }

  const now = new Date().toISOString();

  vault().entries.push({
    id: crypto.randomUUID(),
    name,
    username,
    password,
    createdAt: now,
    updatedAt: now
  });

  await persist();
  console.log();
  ui.success("Password saved successfully.");

  if (!no(await ask("Copy password to clipboard? [Y/n] "))) {
    await copyPassword(password);
  }

  await pause();
}

const LINES_PER_ENTRY = 5;

function pageSize() {
  const rows = process.stdout.rows || 24;
  // Leave room for the header, footer, and prompt
  return Math.max(2, Math.floor((rows - 9) / LINES_PER_ENTRY));
}

function printEntry(entry, number) {
  ui.entryCard(number, entry, formatDate(entry.updatedAt));
}

/**
 * Display entries page by page so they fit on screen (the alternate screen
 * has no scrollback). If select=true, return the selected entry by number or
 * ID, or null if the selection is cancelled.
 */
async function browseEntries(title, entries, { select = false } = {}) {
  if (!entries.length) {
    cli.printHeader(title);
    ui.note("No passwords found.");
    await pause();
    return null;
  }

  const size = pageSize();
  const pages = Math.ceil(entries.length / size);
  let page = 0;

  for (;;) {
    cli.clearScreen();
    cli.printHeader(`${title}  (${entries.length} entry)`);

    const start = page * size;
    entries.slice(start, start + size).forEach((entry, i) => printEntry(entry, start + i + 1));

    const nav = [];
    if (page > 0) nav.push("[p] previous");
    if (page < pages - 1) nav.push("[n] next");
    ui.note(`Page ${page + 1}/${pages}${nav.length ? "   " + nav.join("  ") : ""}`);

    const input = (await ask(
      select ? "Select a number/ID (press Enter to cancel): " : "Press Enter to go back: "
    )).trim();

    const key = input.toLowerCase();
    if (key === "n" && page < pages - 1) { page++; continue; }
    if (key === "p" && page > 0) { page--; continue; }

    if (!select || input === "" || input === "0") return null;

    const index = Number(input);
    if (Number.isInteger(index) && index >= 1 && index <= entries.length) {
      return entries[index - 1];
    }

    const byId = entries.find(entry => entry.id === input);
    if (byId) return byId;

    ui.error("Invalid choice.");
    await pause();
  }
}

async function listPasswords() {
  await browseEntries("PASSWORD LIST", vault().entries);
}

async function searchPasswords() {
  cli.printHeader("SEARCH");

  const query = (await ask("Search: ")).trim().toLowerCase();

  const results = vault().entries.filter(entry =>
    entry.name.toLowerCase().includes(query) ||
    entry.username.toLowerCase().includes(query)
  );

  await browseEntries(`SEARCH: "${query}"`, results);
}

async function selectEntry() {
  return browseEntries("SELECT ENTRY", vault().entries, { select: true });
}

async function viewPassword() {
  cli.printHeader("VIEW PASSWORD");

  const entry = await selectEntry();
  if (!entry) return;

  ui.field("Application", entry.name);
  ui.field("Username", entry.username || "-");
  ui.field("Password", maskPassword(entry.password));
  ui.field("Created", formatDate(entry.createdAt));
  ui.field("Updated", formatDate(entry.updatedAt));

  console.log();
  ui.menuItem("1", "Show password");
  ui.menuItem("2", "Copy password");
  ui.menuItem("0", "Back");

  const choice = (await ask(ui.prompt())).trim();

  if (choice !== "1" && choice !== "2") return;

  if (!(await confirmMaster())) {
    ui.error("Wrong master password.");
    return pause();
  }

  if (choice === "1") {
    console.log();
    ui.field("Password", entry.password);
  } else {
    await copyPassword(entry.password);
  }

  await pause();
}

async function updatePassword() {
  cli.printHeader("UPDATE PASSWORD");

  const entry = await selectEntry();
  if (!entry) return;

  if (!(await confirmMaster())) {
    ui.error("Wrong master password.");
    return pause();
  }

  ui.info(`Editing: ${entry.name}`);
  console.log();

  const name = await ask(`Name [${entry.name}]: `);
  const username = await ask(`Username [${entry.username}]: `);

  if (name.trim()) entry.name = name.trim();
  if (username.trim()) entry.username = username.trim();

  let newSecret = null;

  if (yes(await ask("Generate a new password? [y/N] "))) {
    try {
      newSecret = generatePassword(vault().settings);
      entry.password = newSecret;
    } catch (err) {
      ui.error(`Couldn't generate password: ${err.message}`);
    }
  }

  entry.updatedAt = new Date().toISOString();
  await persist();

  console.log();
  ui.success("Entry updated successfully.");

  if (newSecret) {
    ui.success("New password saved.");
    if (!no(await ask("Copy new password to clipboard? [Y/n] "))) {
      await copyPassword(newSecret);
    }
  }

  await pause();
}

async function deletePassword() {
  cli.printHeader("DELETE PASSWORD");

  const entry = await selectEntry();
  if (!entry) return;

  if (!(await confirmMaster())) {
    ui.error("Wrong master password.");
    return pause();
  }

  if (!yes(await ask(`Delete "${entry.name}" permanently? [y/N] `))) {
    ui.note("Cancelled.");
    return pause();
  }

  vault().entries = vault().entries.filter(item => item.id !== entry.id);
  await persist();

  ui.success("Entry deleted successfully.");
  await pause();
}

async function changeMasterPassword() {
  cli.printHeader("CHANGE MASTER PASSWORD");

  if (!(await confirmMaster())) {
    ui.error("Wrong master password.");
    return pause();
  }

  const newPassword = await promptNewMaster(askHidden);

  ui.note("Deriving encryption key...");
  const newCtx = await createKeyContext(newPassword);
  guard();

  const oldCtx = session.ctx;
  session.ctx = newCtx;

  try {
    await persist();
  } catch (err) {
    session.ctx = oldCtx; // Save failed: keep using the old key
    wipeContext(newCtx);
    throw err;
  }

  wipeContext(oldCtx);
  ui.success("Master password changed. The vault has been re-encrypted with a new salt.");
  ui.note("Note: older backups are still encrypted with the old master password.");
  await pause();
}

function printSettings() {
  const s = vault().settings;
  const onOff = value => (value ? ui.paint("green", "ON") : ui.paint("gray", "OFF"));
  ui.field("Length", s.length);
  ui.field("Uppercase", onOff(s.uppercase));
  ui.field("Lowercase", onOff(s.lowercase));
  ui.field("Numbers", onOff(s.numbers));
  ui.field("Symbols", onOff(s.symbols));
  ui.field("Strength", ui.strength(estimateEntropyBits(s)));
}

async function settings() {
  const toggles = { "2": "uppercase", "3": "lowercase", "4": "numbers", "5": "symbols" };

  for (;;) {
    cli.printHeader("GENERATOR SETTINGS");
    printSettings();

    console.log();
    ui.menuItem("1", "Change length");
    ui.menuItem("2", "Toggle uppercase");
    ui.menuItem("3", "Toggle lowercase");
    ui.menuItem("4", "Toggle numbers");
    ui.menuItem("5", "Toggle symbols");
    ui.menuItem("6", "Generate test password");
    ui.menuItem("0", "Back");

    const choice = (await ask(`\n${ui.prompt()}`)).trim();

    if (choice === "0") return;

    if (choice === "1") {
      const value = Number(await ask("Length (8-256, recommended ≥16): "));

      if (Number.isInteger(value) && value >= 8 && value <= 256) {
        vault().settings.length = value;
        await persist();
      } else {
        ui.error("Invalid length.");
        await pause();
      }
    } else if (toggles[choice]) {
      const key = toggles[choice];
      vault().settings[key] = !vault().settings[key];
      await persist();
    } else if (choice === "6") {
      try {
        console.log();
        ui.field("Generated", generatePassword(vault().settings));
      } catch (err) {
        ui.error(err.message);
      }
      await pause();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main loop & lifecycle                                              */
/* ------------------------------------------------------------------ */

async function mainMenu() {
  for (;;) {
    try {
      if (!isUnlocked()) await unlock();

      cli.clearScreen();
      ui.banner(VERSION);
      ui.status({
        unlocked: true,
        entries: vault().entries.length,
        autoLockMin: Math.round(AUTO_LOCK_MS / 60000) || "<1"
      });
      console.log();
      ui.menuItem("1", "New Password", "generate & save a random password");
      ui.menuItem("2", "List Password");
      ui.menuItem("3", "Search");
      ui.menuItem("4", "View Password", "show / copy");
      ui.menuItem("5", "Update Password");
      ui.menuItem("6", "Delete Password");
      ui.menuItem("7", "Generator Settings");
      ui.menuItem("8", "Change Master Password");
      ui.menuItem("0", "Lock / Exit");

      const choice = (await ask(`\n${ui.prompt()}`)).trim();

      switch (choice) {
        case "1": await newPassword(); break;
        case "2": await listPasswords(); break;
        case "3": await searchPasswords(); break;
        case "4": await viewPassword(); break;
        case "5": await updatePassword(); break;
        case "6": await deletePassword(); break;
        case "7": await settings(); break;
        case "8": await changeMasterPassword(); break;
        case "0": return;
        default:
          ui.error("Invalid choice.");
          await pause();
      }
    } catch (err) {
      if (err instanceof LockedError) continue; // Session locked -> ask for the master password again
      if (err.code === "BAD_FORMAT") throw err;  // Corrupted vault: cannot continue

      console.log();
      ui.error(`Something went wrong: ${err.message}`);
      if (isUnlocked()) await pause().catch(() => {});
    }
  }
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  clearTimeout(idleTimer);

  try { await clipboard.clearIfUnchanged(); } catch { /* ignore */ }

  wipeContext(session.ctx);
  session.ctx = null;
  session.vault = null;

  cli.leaveScreen();
  ui.success("Vault locked. See you next time.");

  rl?.close();
  process.exit(code);
}

async function run() {
  rl = cli.createInterface();
  cli.enterScreen();

  process.on("exit", () => cli.leaveScreen());
  process.on("SIGTERM", () => shutdown(143));
  process.on("SIGHUP", () => shutdown(129));
  process.on("unhandledRejection", err => {
    console.error("\nFatal error:", err && err.message ? err.message : err);
    shutdown(1);
  });

  rl.on("SIGINT", () => shutdown(130));
  rl.on("close", () => shutdown(0)); // Ctrl+D / input closed

  if (cli.IS_TTY) process.stdin.on("keypress", armIdleTimer);

  try {
    await mainMenu();
    await shutdown(0);
  } catch (err) {
    console.error("\nFatal error:", err.message);
    await shutdown(1);
  }
}

run();
