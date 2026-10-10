"use strict";

/**
 * UI layer: ANSI colors, boxes, icons, and an ASCII fallback.
 * - Colors are disabled automatically for non-terminal output, TERM=dumb, or NO_COLOR.
 * - ASCII mode is automatic in older Windows consoles (cmd.exe/regular PowerShell).
 *   Force it with PM_ASCII=1 (ASCII) or PM_ASCII=0 (Unicode).
 */

const IS_TTY = Boolean(process.stdout.isTTY);
const COLOR = IS_TTY && !("NO_COLOR" in process.env) && process.env.TERM !== "dumb";

const legacyWindowsConsole =
  process.platform === "win32" &&
  !process.env.WT_SESSION &&
  !process.env.TERM_PROGRAM &&
  process.env.ConEmuANSI !== "ON";

const ASCII = process.env.PM_ASCII === "1" ||
  (legacyWindowsConsole && process.env.PM_ASCII !== "0");

const SYM = ASCII
  ? { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", dot: "*", ok: "+", err: "x",
      warn: "!", info: "i", full: "#", empty: "-", arrow: ">", pm: "~", mask: "*", lock: "[#]", open: "[o]" }
  : { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", dot: "•", ok: "✔", err: "✖",
      warn: "▲", info: "●", full: "█", empty: "░", arrow: "❯", pm: "±", mask: "•", lock: "🔒", open: "🔓" };

// Double-width emoji breaks box alignment; use simple symbols only.
SYM.lock = ASCII ? "[#]" : "◆";
SYM.open = ASCII ? "[o]" : "◇";

const CODES = {
  reset: 0, bold: 1, dim: 2,
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90
};

function paint(style, text) {
  if (!COLOR) return String(text);
  const codes = [].concat(style).map(name => CODES[name]).join(";");
  return `\x1b[${codes}m${text}\x1b[0m`;
}

const strip = text => String(text).replace(/\x1b\[[0-9;]*m/g, "");
const visibleLength = text => [...strip(text)].length;

function width() {
  const cols = process.stdout.columns || 80;
  return Math.max(36, Math.min(56, cols - 4));
}

const IND = "  ";
const out = line => console.log(`${IND}${line}`);

function pad(text, size) {
  return text + " ".repeat(Math.max(0, size - visibleLength(text)));
}

function box(lines, w = width()) {
  const inner = w - 2;
  console.log(`${IND}${paint("cyan", SYM.tl + SYM.h.repeat(inner) + SYM.tr)}`);
  for (const line of lines) {
    console.log(`${IND}${paint("cyan", SYM.v)}${pad(" " + line, inner)}${paint("cyan", SYM.v)}`);
  }
  console.log(`${IND}${paint("cyan", SYM.bl + SYM.h.repeat(inner) + SYM.br)}`);
}

function banner(version = "") {
  const w = width();
  const title = paint(["bold", "cyan"], "LOCAL PASSWORD MANAGER");
  const ver = version ? paint("gray", `v${version}`) : "";
  const gap = Math.max(1, w - 2 - 1 - visibleLength(title) - visibleLength(ver) - 1);
  console.log();
  box([
    `${title}${" ".repeat(gap)}${ver}`,
    paint("gray", "Local password vault, encrypted with AES-256-GCM")
  ], w);
}

function status({ unlocked, entries, autoLockMin }) {
  const state = unlocked
    ? paint("green", `${SYM.open} Unlocked`)
    : paint("yellow", `${SYM.lock} Locked`);
  const parts = [state];
  if (entries !== undefined) parts.push(paint("gray", `Entries: ${entries}`));
  if (autoLockMin) parts.push(paint("gray", `Auto-lock: ${autoLockMin} min`));
  console.log();
  out(parts.join(paint("gray", `  ${SYM.dot}  `)));
}

function header(title) {
  console.log();
  out(paint(["bold", "cyan"], title));
  out(paint("gray", SYM.h.repeat(Math.min(width() - 2, Math.max(12, visibleLength(title) + 4)))));
  console.log();
}

function menuItem(key, label, hint = "") {
  const k = paint(["bold", "cyan"], `[${key}]`);
  const h = hint ? paint("gray", `  ${hint}`) : "";
  out(` ${k} ${label}${h}`);
}

function success(message) { out(`${paint("green", SYM.ok)} ${message}`); }
function error(message) { out(`${paint("red", SYM.err)} ${paint("red", message)}`); }
function warn(message) { out(`${paint("yellow", SYM.warn)} ${message}`); }
function info(message) { out(`${paint("blue", SYM.info)} ${message}`); }
function note(message) { out(paint("gray", message)); }
function plain(message = "") { out(message); }

function field(label, value) {
  out(`${paint("gray", pad(label, 12))} ${value}`);
}

function entryCard(number, entry, date) {
  out(`${paint(["bold", "cyan"], `[${number}]`)} ${paint("bold", entry.name)}`);
  out(`    ${paint("gray", "Username")}  ${entry.username || "-"}`);
  out(`    ${paint("gray", "ID")}        ${paint("gray", entry.id)}`);
  out(`    ${paint("gray", "Updated")}   ${date}`);
  console.log();
}

function strength(bits) {
  const levels = [
    { min: 100, label: "Very strong", color: "green" },
    { min: 80, label: "Strong", color: "green" },
    { min: 60, label: "Fair", color: "yellow" },
    { min: 0, label: "Weak", color: "red" }
  ];
  const level = levels.find(l => bits >= l.min);
  const filled = Math.max(1, Math.min(10, Math.round(bits / 13)));
  const bar = SYM.full.repeat(filled) + SYM.empty.repeat(10 - filled);
  return `${paint(level.color, bar)} ${bits} bit ${paint(level.color, `(${level.label})`)}`;
}

const prompt = () => `${IND}${paint(["bold", "cyan"], SYM.arrow)} `;

module.exports = {
  SYM, paint, strip, width, box, banner, status, header, menuItem,
  success, error, warn, info, note, plain, field, entryCard, strength, prompt, IND
};
