import test from "node:test";
import assert from "node:assert/strict";
import { sanitize } from "../src/thesis.mjs";

test("sanitize downgrades low-conviction TRADE to NO_TRADE", () => {
  const thesis = sanitize({
    action: "TRADE",
    symbol: "CAKE",
    direction: "enter",
    convictionBps: -1,
    rationale: "weak setup",
    invalidation: "momentum fades",
  });

  assert.equal(thesis.action, "NO_TRADE");
  assert.equal(thesis.symbol, null);
  assert.equal(thesis.direction, null);
  assert.equal(thesis.convictionBps, 0);
});

test("sanitize preserves high-conviction eligible structure", () => {
  const thesis = sanitize({
    action: "TRADE",
    symbol: "cake",
    direction: "enter",
    confidence: 72,
    rationale: "momentum and volume aligned",
    invalidation: "break below support",
  });

  assert.equal(thesis.action, "TRADE");
  assert.equal(thesis.symbol, "CAKE");
  assert.equal(thesis.direction, "enter");
  assert.equal(thesis.convictionBps, 7200);
});
