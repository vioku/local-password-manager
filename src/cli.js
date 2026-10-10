"use strict";

const readline = require("readline");
const { Writable } = require("stream");

const IS_TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const USE_ALT_SCREEN = IS_TTY && !process.env.PM_NO_ALT_SCREEN;

let muted = false;
let inAltScreen = false;

/**
 * readline reads input through a muted `output` stream. This prevents
 * readline's built-in echo from showing passwords; the only thing
 * shown is the `*` mask rendered below (no more duplicate characters).
 * historySize: 0 keeps passwords out of history (Up arrow).
 */
function createInterface() {
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    }
  });
  output.isTTY = IS_TTY;
  Object.defineProperty(output, "columns", { get: () => process.stdout.columns });
  process.stdout.on("resize", () => output.emit("resize"));

  return readline.createInterface({
    input: process.stdin,
    output,
    terminal: IS_TTY,
    historySize: 0
  });
}

// Run a function with terminal echo muted (e.g. while waiting after a failed login).
async function whileMuted(fn) {
  const previous = muted;
  muted = true;
  try { return await fn(); } finally { muted = previous; }
}

// Align prompts with the rest of the UI (2-space indent).
function indentQuestion(question) {
  return question.replace(/^(\n*)(?! {2})/, "$1  ");
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(indentQuestion(question), resolve));
}

function askHidden(rl, question) {
  return new Promise(resolve => {
    question = indentQuestion(question);
    process.stdout.write(question);

    if (!IS_TTY) {
      rl.question("", resolve);
      return;
    }

    let done = false;
    const render = () => {
      if (done) return;
      const stars = "*".repeat([...rl.line].length);
      process.stdout.write(`\r\x1b[2K${question}${stars}`);
    };

    muted = true;
    process.stdin.on("keypress", render);

    rl.question("", answer => {
      done = true;
      muted = false;
      process.stdin.off("keypress", render);
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

// Alternate screen keeps sensitive screens out of terminal scrollback.
function enterScreen() {
  if (USE_ALT_SCREEN && !inAltScreen) {
    process.stdout.write("\x1b[?1049h");
    inAltScreen = true;
  }
}

function leaveScreen() {
  if (inAltScreen) {
    process.stdout.write("\x1b[?1049l\x1b[?25h");
    inAltScreen = false;
  }
}

function clearScreen() {
  if (IS_TTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

function printHeader(title) {
  require("./ui").header(title);
}

module.exports = {
  IS_TTY,
  createInterface,
  ask,
  askHidden,
  whileMuted,
  enterScreen,
  leaveScreen,
  clearScreen,
  printHeader
};
