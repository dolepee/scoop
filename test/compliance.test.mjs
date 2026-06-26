import test from "node:test";
import assert from "node:assert/strict";
import { chooseComplianceAction, COMPLIANCE_REASON } from "../src/compliance.mjs";

const NOW = Date.parse("2026-06-22T21:30:00Z");

test("compliance chooses the thesis symbol when it is eligible", () => {
  const action = chooseComplianceAction({
    position: null,
    thesis: { symbol: "CAKE" },
    movers: [{ symbol: "FLOKI" }],
    nowMs: NOW,
  });
  assert.equal(action.action, "buy");
  assert.equal(action.symbol, "CAKE");
  assert.equal(action.reason, COMPLIANCE_REASON);
});

test("compliance falls back to the conservative eligible basket before heat-ranked movers", () => {
  const action = chooseComplianceAction({
    position: null,
    thesis: { symbol: "NOTREAL" },
    movers: [{ symbol: "NOTREAL" }, { symbol: "FLOKI" }],
    nowMs: NOW,
  });
  assert.equal(action.action, "buy");
  assert.equal(action.symbol, "CAKE");
});

test("compliance sells yesterday's tiny position after the age window", () => {
  const action = chooseComplianceAction({
    position: {
      symbol: "CAKE",
      complianceTrade: true,
      openedAt: new Date(NOW - 21 * 60 * 60 * 1000).toISOString(),
    },
    thesis: { symbol: "CAKE" },
    movers: [{ symbol: "CAKE" }],
    nowMs: NOW,
  });
  assert.deepEqual(action, { action: "sell", symbol: "CAKE", reason: COMPLIANCE_REASON });
});

test("compliance does not churn a fresh compliance position", () => {
  const action = chooseComplianceAction({
    position: {
      symbol: "CAKE",
      complianceTrade: true,
      openedAt: new Date(NOW - 4 * 60 * 60 * 1000).toISOString(),
    },
    thesis: { symbol: "CAKE" },
    movers: [{ symbol: "CAKE" }],
    nowMs: NOW,
  });
  assert.equal(action, null);
});

test("compliance does not stack on an existing non-compliance position", () => {
  const action = chooseComplianceAction({
    position: { symbol: "CAKE", openedAt: new Date(NOW - 30 * 60 * 60 * 1000).toISOString() },
    thesis: { symbol: "CAKE" },
    movers: [{ symbol: "CAKE" }],
    nowMs: NOW,
  });
  assert.equal(action, null);
});
