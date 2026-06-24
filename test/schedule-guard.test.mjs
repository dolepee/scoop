import test from "node:test";
import assert from "node:assert/strict";
import { scheduleDecision } from "../src/schedule-guard.mjs";

const NOW = Date.parse("2026-06-24T12:30:00Z");

test("normal discovery waits for the standard interval", () => {
  const decision = scheduleDecision({
    latestGeneratedAt: "2026-06-24T12:00:00Z",
    nowMs: NOW,
    minIntervalMinutes: 50,
    openPosition: false,
  });

  assert.equal(decision.shouldRun, false);
  assert.equal(decision.reason, "fresh_receipt:30m<50m");
});

test("normal discovery runs after the standard interval", () => {
  const decision = scheduleDecision({
    latestGeneratedAt: "2026-06-24T11:30:00Z",
    nowMs: NOW,
    minIntervalMinutes: 50,
    openPosition: false,
  });

  assert.equal(decision.shouldRun, true);
  assert.equal(decision.reason, "receipt_age:60m");
});

test("open positions bypass the slow discovery cadence for protection", () => {
  const decision = scheduleDecision({
    latestGeneratedAt: "2026-06-24T12:15:00Z",
    nowMs: NOW,
    minIntervalMinutes: 50,
    openPosition: true,
    openPositionIntervalMinutes: 10,
  });

  assert.equal(decision.shouldRun, true);
  assert.equal(decision.reason, "open_position_age:15m");
});

test("open positions still skip very fresh receipts", () => {
  const decision = scheduleDecision({
    latestGeneratedAt: "2026-06-24T12:25:00Z",
    nowMs: NOW,
    minIntervalMinutes: 50,
    openPosition: true,
    openPositionIntervalMinutes: 10,
  });

  assert.equal(decision.shouldRun, false);
  assert.equal(decision.reason, "fresh_open_position:5m<10m");
});
