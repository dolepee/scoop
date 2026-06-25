import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExitSignalGuard } from "../src/exit-signal-guard.mjs";

const POSITION = {
  symbol: "SLX",
  address: "0x8A063A9ff4dE28dcB87117cc759BE6cE70e09F81",
  units: 4231.876581442062,
};

test("exit signal guard allows non-exit theses", () => {
  const guard = evaluateExitSignalGuard({
    position: POSITION,
    thesis: { action: "NO_TRADE" },
  });
  assert.deepEqual(guard, { ok: true, reason: "not_an_exit" });
});

test("exit signal guard blocks a different symbol than the held position", () => {
  const guard = evaluateExitSignalGuard({
    position: POSITION,
    thesis: { action: "TRADE", symbol: "LAB", direction: "exit" },
  });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "exit_symbol_mismatch");
});

test("exit signal guard blocks paid quote collisions against wallet value", () => {
  const guard = evaluateExitSignalGuard({
    position: POSITION,
    thesis: { action: "TRADE", symbol: "SLX", direction: "exit" },
    quotes: [{ symbol: "SLX", priceUsd: 0.39995684582176166 }],
    positionUsd: 4.99,
  });
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, "exit_quote_wallet_divergence");
});

test("exit signal guard allows wallet-consistent exit signals", () => {
  const guard = evaluateExitSignalGuard({
    position: POSITION,
    thesis: { action: "TRADE", symbol: "SLX", direction: "exit" },
    quotes: [{ symbol: "SLX", priceUsd: 0.0012 }],
    positionUsd: 5.07,
  });
  assert.deepEqual(guard, { ok: true, reason: "trusted_exit_signal" });
});
