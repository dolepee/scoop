import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDexPairGuard } from "../src/dex-guard.mjs";

const HEALTHY_PAIR = {
  chainId: "bsc",
  dexId: "pancakeswap",
  pairAddress: "0xpair",
  priceUsd: "10",
  liquidity: { usd: 250_000 },
  volume: { h1: 20_000 },
  priceChange: { h1: 1.2 },
};

test("dex guard blocks thin BSC liquidity", () => {
  const guard = evaluateDexPairGuard({
    pair: { ...HEALTHY_PAIR, liquidity: { usd: 13_000 } },
    paidPriceUsd: 10,
    recoveryMode: true,
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "dex_liquidity_too_thin");
});

test("dex guard blocks thin 1h DEX flow", () => {
  const guard = evaluateDexPairGuard({
    pair: { ...HEALTHY_PAIR, volume: { h1: 100 } },
    paidPriceUsd: 10,
    recoveryMode: true,
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "dex_h1_volume_too_thin");
});

test("dex guard blocks paid quote and DEX price divergence", () => {
  const guard = evaluateDexPairGuard({
    pair: { ...HEALTHY_PAIR, priceUsd: "9.50" },
    paidPriceUsd: 10,
    recoveryMode: true,
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "dex_paid_price_diverged");
});

test("dex guard blocks negative recovery momentum", () => {
  const guard = evaluateDexPairGuard({
    pair: { ...HEALTHY_PAIR, priceChange: { h1: -3.1 } },
    paidPriceUsd: 10,
    recoveryMode: true,
  });

  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "dex_recovery_momentum_negative");
});

test("dex guard accepts liquid aligned recovery pair", () => {
  const guard = evaluateDexPairGuard({
    pair: HEALTHY_PAIR,
    paidPriceUsd: 10.1,
    recoveryMode: true,
  });

  assert.equal(guard.ok, true);
  assert.equal(guard.priceUsd, 10);
  assert.equal(guard.liquidityUsd, 250_000);
});
