import test from "node:test";
import assert from "node:assert/strict";
import { executableUsdAmount } from "../src/sizing.mjs";

test("executable amount lifts rounded boundary values to the minimum", () => {
  assert.equal(executableUsdAmount({ targetUsd: 1.999, maxUsd: 20, minUsd: 2 }), 2);
});

test("executable amount rounds up to cents before sending to the swapper", () => {
  assert.equal(executableUsdAmount({ targetUsd: 2.001, maxUsd: 20, minUsd: 2 }), 2.01);
});

test("executable amount fails closed when available USDT cannot clear the minimum", () => {
  assert.equal(executableUsdAmount({ targetUsd: 2.5, maxUsd: 1.95, minUsd: 2 }), null);
});

test("executable amount preserves larger strategy sizes with cent precision", () => {
  assert.equal(executableUsdAmount({ targetUsd: 9.876, maxUsd: 20, minUsd: 2 }), 9.88);
});
