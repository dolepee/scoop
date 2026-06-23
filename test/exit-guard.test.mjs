import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExitGuard, parseInvalidationPrice } from "../src/exit-guard.mjs";

const LAB_POSITION = {
  symbol: "LAB",
  units: 0.11726733869194601,
  costUsd: 2,
  entryPrice: 17.055047230617856,
  invalidation: "Price closes below $16.00, indicating the uptrend has broken.",
};

test("parses a directional dollar invalidation level", () => {
  assert.equal(parseInvalidationPrice(LAB_POSITION.invalidation), 16);
});

test("forces exit when the paid quote breaches the stored invalidation", () => {
  const guard = evaluateExitGuard({
    position: LAB_POSITION,
    quotes: [{ symbol: "LAB", priceUsd: 15.99 }],
    positionUsd: 1.9,
  });
  assert.equal(guard.action, "FORCE_EXIT");
  assert.equal(guard.symbol, "LAB");
  assert.equal(guard.direction, "exit");
  assert.equal(guard.invalidationUsd, 16);
  assert.equal(guard.priceUsd, 15.99);
  assert.equal(guard.priceSource, "paid_quote");
});

test("does not force exit while the thesis level still holds", () => {
  const guard = evaluateExitGuard({
    position: LAB_POSITION,
    quotes: [{ symbol: "LAB", priceUsd: 16.90, change1h: 0.1 }],
    positionUsd: 1.9,
  });
  assert.equal(guard, null);
});

test("forces exit when a carried position is below the useful live-trade minimum", () => {
  const guard = evaluateExitGuard({
    position: LAB_POSITION,
    quotes: [{ symbol: "LAB", priceUsd: 16.90, change1h: 0.1 }],
    positionUsd: 1.9,
    minUsefulPositionUsd: 5,
  });
  assert.equal(guard.action, "FORCE_EXIT");
  assert.equal(guard.reason, "position_below_live_trade_min");
});

test("forces exit before invalidation when open loss and 1h momentum fade", () => {
  const guard = evaluateExitGuard({
    position: LAB_POSITION,
    quotes: [{ symbol: "LAB", priceUsd: 16.41, change1h: -3.12 }],
    positionUsd: 1.9,
  });
  assert.equal(guard.action, "FORCE_EXIT");
  assert.equal(guard.reason, "position_momentum_faded");
  assert.equal(guard.priceSource, "paid_quote");
});

test("falls back to wallet value when the paid quote is unavailable", () => {
  const guard = evaluateExitGuard({
    position: LAB_POSITION,
    quotes: [],
    positionUsd: 1.85,
  });
  assert.equal(guard.action, "FORCE_EXIT");
  assert.equal(guard.priceSource, "wallet_value");
});
