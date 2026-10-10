"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { generatePassword, estimateEntropyBits, CHARSETS } = require("../src/generator");

const all = { length: 24, uppercase: true, lowercase: true, numbers: true, symbols: true };

test("length and every enabled character set are respected", () => {
  for (let i = 0; i < 200; i++) {
    const p = generatePassword(all);
    assert.strictEqual(p.length, 24);
    for (const set of Object.values(CHARSETS)) assert.ok([...p].some(c => set.includes(c)));
  }
});

test("digits only", () => {
  assert.match(generatePassword({ length: 12, numbers: true }), /^\d{12}$/);
});

test("validation", () => {
  assert.throws(() => generatePassword({ length: 10 }));
  assert.throws(() => generatePassword({ ...all, length: 300 }));
  assert.throws(() => generatePassword({ ...all, length: 2 }));
});

test("entropy estimate", () => {
  assert.strictEqual(estimateEntropyBits({ length: 10, numbers: true }), Math.floor(10 * Math.log2(10)));
});
