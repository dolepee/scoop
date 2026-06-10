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

const NOON = Date.parse("2026-06-22T12:00:00Z");
const LATE = Date.parse("2026-06-22T21:30:00Z");

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
  state = noteEntry(state, DEFAULT_CONFIG.maxDailyNewRiskPct);
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
  state = noteEntry(state, 30);
  const nextDay = NOON + 24 * 3600 * 1000;
  state = syncState(state, 20, nextDay);
  assert.equal(state.tradesToday, 0);
  assert.equal(state.newRiskTodayPct, 0);
  assert.equal(state.dayKey, dayKeyOf(nextDay));
});

test("compliance valve opens late in the day with zero trades", () => {
  const r = decide({ kind: "NONE" }, freshState(), { equityUsd: 20, nowMs: LATE });
  assert.equal(r.decision, "COMPLIANCE_TRADE");
  assert.ok(r.complianceUsd > 0);
});

test("compliance valve stays closed once a trade exists today", () => {
  let state = freshState();
  state = noteEntry(state, 10);
  const r = decide({ kind: "NONE" }, state, { equityUsd: 20, nowMs: LATE });
  assert.equal(r.decision, "STAND_DOWN");
});

test("compliance valve stays closed before the late-day hour", () => {
  const r = decide({ kind: "NONE" }, freshState(), { equityUsd: 20, nowMs: NOON });
  assert.equal(r.decision, "STAND_DOWN");
});
