"use strict";

const crypto = require("crypto");

const CHARSETS = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/"
};

function randomChar(chars) {
  return chars[crypto.randomInt(chars.length)];
}

function enabledSets(settings) {
  return Object.keys(CHARSETS)
    .filter(key => settings[key])
    .map(key => CHARSETS[key]);
}

function generatePassword(settings) {
  const enabled = enabledSets(settings);

  if (enabled.length === 0) {
    throw new Error("At least one character set must be enabled.");
  }

  const length = Number(settings.length);

  if (!Number.isInteger(length) || length < enabled.length || length > 256) {
    throw new Error(`Password length must be between ${enabled.length} and 256.`);
  }

  // Make sure every enabled character set appears at least once.
  const password = enabled.map(randomChar);
  const all = enabled.join("");

  while (password.length < length) {
    password.push(randomChar(all));
  }

  // Fisher-Yates shuffle using CSPRNG.
  for (let i = password.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join("");
}

// Estimated entropy (bits) = length * log2(character pool size).
function estimateEntropyBits(settings) {
  const pool = enabledSets(settings).join("").length;
  if (pool === 0) return 0;
  return Math.floor(Number(settings.length) * Math.log2(pool));
}

module.exports = { generatePassword, estimateEntropyBits, CHARSETS };
