import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExitGuard, parseInvalidationPrice } from "../src/exit-guard.mjs";

const LAB_POSITION = {
  symbol: "LAB",
  units: 0.11726733869194601,
  costUsd: 2,
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
    quotes: [{ symbol: "LAB", priceUsd: 16.01 }],
    positionUsd: 1.9,
  });
  assert.equal(guard, null);
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
