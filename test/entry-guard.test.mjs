import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEntryGuard } from "../src/entry-guard.mjs";

const GOOD_THESIS = {
  action: "TRADE",
  symbol: "CAKE",
  direction: "enter",
  convictionBps: 7000,
  invalidation: "Exit if CAKE trades below $9.60",
};

const GOOD_QUOTE = {
  symbol: "CAKE",
  priceUsd: 10,
  change1h: 1.2,
  change24h: 8,
  volume24h: 25_000_000,
};

test("entry guard rejects a long stop at or above entry", () => {
  const guard = evaluateEntryGuard({
    thesis: {
      ...GOOD_THESIS,
      invalidation: "Price falls below $10.10",
    },
    quotes: [GOOD_QUOTE],
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "invalid_long_stop_not_below_entry");
});

test("entry guard rejects unparseable stops", () => {
  const guard = evaluateEntryGuard({
    thesis: {
      ...GOOD_THESIS,
      invalidation: "Exit if vibes change",
    },
    quotes: [GOOD_QUOTE],
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "entry_stop_unparseable");
});

test("entry guard rejects too-wide stops in recovery mode", () => {
  const guard = evaluateEntryGuard({
    thesis: {
      ...GOOD_THESIS,
      invalidation: "Exit if CAKE trades below $9.30",
    },
    quotes: [GOOD_QUOTE],
    recoveryMode: true,
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "recovery_stop_too_wide_for_2r");
});

test("entry guard rejects weak recovery momentum", () => {
  const guard = evaluateEntryGuard({
    thesis: GOOD_THESIS,
    quotes: [{ ...GOOD_QUOTE, change1h: 0.1 }],
    recoveryMode: true,
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "recovery_1h_momentum_too_weak");
});

test("entry guard accepts a liquid 2.5R recovery setup", () => {
  const guard = evaluateEntryGuard({
    thesis: GOOD_THESIS,
    quotes: [GOOD_QUOTE],
    recoveryMode: true,
  });

  assert.equal(guard.ok, true);
  assert.equal(guard.symbol, "CAKE");
  assert.equal(guard.entryPriceUsd, 10);
  assert.equal(guard.stopUsd, 9.6);
  assert.ok(guard.stopDistancePct > 3.9 && guard.stopDistancePct < 4.1);
});

test("entry guard rejects recovery setups below 2.5R", () => {
  const guard = evaluateEntryGuard({
    thesis: {
      ...GOOD_THESIS,
      invalidation: "Exit if CAKE trades below $9.51",
    },
    quotes: [GOOD_QUOTE],
    recoveryMode: true,
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "recovery_reward_risk_below_floor");
});
