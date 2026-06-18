import test from "node:test";
import assert from "node:assert/strict";
import { getEligibleToken, isEligible, isEligibleAddress } from "../src/allowlist.mjs";

test("unique symbols resolve to committed eligible tokens", () => {
  const cake = getEligibleToken("CAKE");
  assert.equal(cake?.symbol, "CAKE");
  assert.ok(isEligible("CAKE"));
  assert.ok(isEligibleAddress(cake.address));
});

test("ambiguous symbols fail closed instead of selecting an arbitrary token", () => {
  assert.equal(getEligibleToken("USDF"), null);
  assert.equal(isEligible("USDF"), false);
});

test("duplicate same-address symbols still resolve once deduped", () => {
  const slx = getEligibleToken("SLX");
  assert.equal(slx?.symbol, "SLX");
  assert.ok(isEligible("SLX"));
});
