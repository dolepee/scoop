import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  dayKeyOf,
  decide,
  initialState,
  noteEntry,
  syncState,
} from "../src/governor.mjs";

const MORNING = Date.parse("2026-06-22T08:00:00Z");
const CUTOFF = Date.parse("2026-06-22T09:00:00Z");
const NOON = Date.parse("2026-06-22T12:00:00Z");
const LATE = Date.parse("2026-06-22T21:30:00Z");
const COMPLIANCE_BUY = { action: "buy", symbol: "CAKE", reason: "daily minimum, no conviction signal today" };

function freshState(equity = 20) {
  return initialState(equity, NOON);
}

test("eligible high-conviction entry is approved and sized within caps", () => {
  const state = freshState();
  const r = decide(
    { kind: "TRADE", symbol: "CAKE", direction: "enter", convictionBps: 8000 },
    state,
    { equityUsd: 20, nowMs: NOON },
  );
  assert.equal(r.decision, "APPROVE");
  assert.ok(r.sizedPct > 0 && r.sizedPct <= DEFAULT_CONFIG.maxPositionPct);
});

test("non-eligible token is vetoed", () => {
  const r = decide(
    { kind: "TRADE", symbol: "NOTREAL", direction: "enter", convictionBps: 9000 },
    freshState(),
    { equityUsd: 20, nowMs: NOON },
  );
  assert.equal(r.decision, "VETO");
  assert.ok(r.reasons.some((x) => x.startsWith("token_not_eligible")));
});

test("low conviction is vetoed", () => {
  const r = decide(
    { kind: "TRADE", symbol: "CAKE", direction: "enter", convictionBps: 3000 },
    freshState(),
    { equityUsd: 20, nowMs: NOON },
  );
  assert.equal(r.decision, "VETO");
});

test("exhausted risk budget vetoes entries (equity at the floor)", () => {
  const state = freshState(20);
  const atFloor = state.floorUsd * 1.01;
  const r = decide(
    { kind: "TRADE", symbol: "CAKE", direction: "enter", convictionBps: 9000 },
    state,
    { equityUsd: atFloor, nowMs: NOON },
  );
  assert.equal(r.decision, "VETO");
  assert.ok(r.reasons.some((x) => x.startsWith("risk_budget_exhausted")));
});

test("exits are never vetoed even at the floor", () => {
  const state = freshState(20);
  const r = decide(
    { kind: "TRADE", symbol: "CAKE", direction: "exit", convictionBps: 0 },
    state,
    { equityUsd: state.floorUsd, nowMs: NOON, openPositionPct: 22 },
  );
  assert.equal(r.decision, "APPROVE");
});

test("ratchet raises the floor on new equity highs and never lowers it", () => {
  let state = freshState(20);
  const f0 = state.floorUsd;
  state = syncState(state, 30, NOON);
  assert.ok(state.floorUsd > f0, "floor must rise after a new high");
  const f1 = state.floorUsd;
  state = syncState(state, 22, NOON);
  assert.equal(state.floorUsd, f1, "floor never lowers on drawdown");
  assert.equal(state.peakEquityUsd, 30);
});

test("floor protects banked gains within giveBackPct of the peak", () => {
  let state = freshState(20);
  state = syncState(state, 40, NOON);
  const minFloor = 40 * (1 - DEFAULT_CONFIG.giveBackPct / 100);
  assert.ok(state.floorUsd >= minFloor - 1e-9);
});

test("daily new-risk cap accumulates and blocks", () => {
  let state = freshState(20);
  state = noteEntry(state, DEFAULT_CONFIG.maxDailyNewRiskPct, NOON);
  const r = decide(
    { kind: "TRADE", symbol: "CAKE", direction: "enter", convictionBps: 9000 },
    state,
    { equityUsd: 20, nowMs: NOON },
  );
  assert.equal(r.decision, "VETO");
  assert.ok(r.reasons.some((x) => x.startsWith("daily_new_risk_cap")));
});

test("day rollover resets daily counters", () => {
  let state = freshState(20);
  state = noteEntry(state, 30, NOON);
  const nextDay = NOON + 24 * 3600 * 1000;
  state = syncState(state, 20, nextDay);
  assert.equal(state.tradesToday, 0);
  assert.equal(state.newRiskTodayPct, 0);
  assert.equal(state.dayKey, dayKeyOf(nextDay));
});

test("compliance valve opens at the UTC cutoff when armed with zero trades", () => {
  const r = decide(
    { kind: "NONE" },
    freshState(),
    { equityUsd: 20, nowMs: CUTOFF, tradeArmed: true, complianceAction: COMPLIANCE_BUY },
  );
  assert.equal(r.decision, "COMPLIANCE_BUY");
  assert.ok(r.complianceUsd > 0);
  assert.equal(r.symbol, "CAKE");
  assert.ok(r.reasons.includes("compliance_buy:zero_trades_after_cutoff"));
});

test("compliance valve stays closed once a trade exists today", () => {
  let state = freshState();
  state = noteEntry(state, 10, NOON);
  const r = decide(
    { kind: "NONE" },
    state,
    { equityUsd: 20, nowMs: LATE, tradeArmed: true, complianceAction: COMPLIANCE_BUY },
  );
  assert.equal(r.decision, "STAND_DOWN");
});

test("compliance valve stays closed before the UTC cutoff", () => {
  const r = decide(
    { kind: "NONE" },
    freshState(),
    { equityUsd: 20, nowMs: MORNING, tradeArmed: true, complianceAction: COMPLIANCE_BUY },
  );
  assert.equal(r.decision, "STAND_DOWN");
});

test("compliance valve stays closed when not armed", () => {
  const r = decide(
    { kind: "NONE" },
    freshState(),
    { equityUsd: 20, nowMs: LATE, tradeArmed: false, complianceAction: COMPLIANCE_BUY },
  );
  assert.equal(r.decision, "STAND_DOWN");
});

test("compliance valve stays closed in degraded mode", () => {
  const r = decide(
    { kind: "NONE" },
    freshState(),
    { equityUsd: 20, nowMs: LATE, tradeArmed: true, degraded: true, complianceAction: COMPLIANCE_BUY },
  );
  assert.equal(r.decision, "STAND_DOWN");
});

test("compliance never overrides a conviction trade approval", () => {
  const r = decide(
    { kind: "TRADE", symbol: "CAKE", direction: "enter", convictionBps: 9000 },
    freshState(),
    { equityUsd: 20, nowMs: LATE, tradeArmed: true, complianceAction: COMPLIANCE_BUY },
  );
  assert.equal(r.decision, "APPROVE");
});

test("compliance buy is still gated by the governor floor", () => {
  const state = freshState(20);
  const r = decide(
    { kind: "NONE" },
    state,
    {
      equityUsd: state.floorUsd * 1.001,
      nowMs: LATE,
      tradeArmed: true,
      complianceAction: COMPLIANCE_BUY,
    },
  );
  assert.equal(r.decision, "STAND_DOWN");
  assert.ok(r.reasons.some((reason) => reason.startsWith("compliance_risk_budget_exhausted")));
});

test("compliance buy fits rebaselined funded-equity room without loosening the floor", () => {
  const state = initialState(15.01, NOON);
  const r = decide(
    { kind: "NONE" },
    state,
    {
      equityUsd: 15.01,
      nowMs: NOON,
      tradeArmed: true,
      complianceAction: COMPLIANCE_BUY,
    },
  );
  assert.equal(r.decision, "COMPLIANCE_BUY");
  assert.equal(r.complianceUsd, 1.25);
  assert.ok(r.sizedPct > 0);
  assert.equal(state.floorUsd, 12.308200000000001);
});

test("micro compliance buy can use a small risk budget without loosening the floor", () => {
  const state = {
    startEquityUsd: 15.01,
    peakEquityUsd: 15.04,
    floorUsd: 13.536,
    dayKey: "2026-06-22",
    tradesToday: 0,
    newRiskTodayPct: 0,
    lastTradeAt: "2026-06-19T13:18:59.797Z",
  };
  const r = decide(
    { kind: "NONE" },
    state,
    {
      equityUsd: 13.8,
      nowMs: NOON,
      tradeArmed: true,
      complianceAction: COMPLIANCE_BUY,
    },
  );
  assert.equal(r.decision, "COMPLIANCE_BUY");
  assert.equal(r.complianceUsd, 1.25);
  assert.ok(r.sizedPct > 9 && r.sizedPct < 10);
  assert.equal(state.floorUsd, 13.536);
});

test("compliance buy fits after the wallet is topped up without loosening the ratchet", () => {
  let state = {
    startEquityUsd: 15.01,
    peakEquityUsd: 15.04,
    floorUsd: 13.536,
    dayKey: "2026-06-22",
    tradesToday: 0,
    newRiskTodayPct: 0,
    lastTradeAt: "2026-06-19T13:18:59.797Z",
  };
  state = syncState(state, 24, NOON);
  const r = decide(
    { kind: "NONE" },
    state,
    {
      equityUsd: 24,
      nowMs: NOON,
      tradeArmed: true,
      complianceAction: COMPLIANCE_BUY,
    },
  );
  assert.equal(r.decision, "COMPLIANCE_BUY");
  assert.equal(r.complianceUsd, 1.25);
  assert.ok(r.sizedPct > 5 && r.sizedPct < 6);
  assert.ok(r.reasons.includes("compliance_buy:zero_trades_after_cutoff"));
});

test("entry sizing uses stop-risk room instead of treating full notional as lost", () => {
  const state = {
    startEquityUsd: 15.01,
    peakEquityUsd: 24.02,
    floorUsd: 21.618,
    dayKey: "2026-06-23",
    tradesToday: 0,
    newRiskTodayPct: 0,
    lastTradeAt: null,
  };
  const r = decide(
    { kind: "TRADE", symbol: "CAKE", direction: "enter", convictionBps: 7200 },
    state,
    { equityUsd: 23.87, nowMs: NOON, tradeArmed: true },
  );
  assert.equal(r.decision, "APPROVE");
  assert.ok(r.sizedPct >= 25, `expected meaningful deployment, got ${r.sizedPct}`);
  assert.ok(r.reasons.includes("stop_risk_pct:8"));
});

test("recovery entries are capped by dollar notional and actual stop distance", () => {
  const state = {
    startEquityUsd: 15.01,
    peakEquityUsd: 24.02,
    floorUsd: 21.618,
    dayKey: "2026-06-24",
    tradesToday: 0,
    newRiskTodayPct: 0,
    lastTradeAt: null,
  };
  const r = decide(
    { kind: "TRADE", symbol: "CAKE", direction: "enter", convictionBps: 7600 },
    state,
    {
      equityUsd: 22.57,
      nowMs: NOON,
      tradeArmed: true,
      recoveryMode: true,
      entryStopDistancePct: 4,
    },
  );
  assert.equal(r.decision, "APPROVE");
  assert.ok(r.sizedPct <= 33.24, `expected recovery cap near $7.50, got ${r.sizedPct}%`);
  assert.ok(r.reasons.includes("stop_risk_pct:4"));
  assert.ok(r.reasons.includes("recovery_cap_usd:7.5"));
});
