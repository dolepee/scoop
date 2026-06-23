import test from "node:test";
import assert from "node:assert/strict";
import { momentumFallbackThesis, sanitize } from "../src/thesis.mjs";

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

test("momentum fallback proposes a liquid positive mover when the model stands down", () => {
  const thesis = momentumFallbackThesis({
    movers: [
      { symbol: "CAKE", change1h: 1.2, change24h: 8, change7d: 12, volume24h: 25_000_000, heat: 13 },
    ],
    quotes: [
      { symbol: "CAKE", priceUsd: 2.5, change1h: 1.2, change24h: 8, change7d: 12, volume24h: 25_000_000, volumeChange24h: 20 },
    ],
  });
  assert.equal(thesis.action, "TRADE");
  assert.equal(thesis.symbol, "CAKE");
  assert.equal(thesis.direction, "enter");
  assert.ok(thesis.convictionBps >= 5600);
});
