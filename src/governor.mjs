// The Ratchet: Scoop's deterministic risk governor.
//
// Built for this tournament's physics. The competition disqualifies any agent
// whose drawdown exceeds 30%, scores hour-by-hour, and requires at least one
// eligible-token trade per day. The governor therefore enforces:
//
//   1. A hard internal drawdown line well inside the DQ line. Risk budget is
//      the distance to that line; no budget, no trade.
//   2. A ratchet floor: when equity makes a new high, the floor rises so
//      banked gains are never fully given back.
//   3. Per-trade sizing from conviction multiplied by remaining risk budget,
//      capped per token and per day.
//   4. The eligible-token allowlist as a hard gate.
//   5. A compliance valve: if no thesis cleared by the configured UTC hour,
//      authorize a minimal stable rotation so the trade-per-day rule can
//      never disqualify us on a quiet day.
//
// Pure functions only. No I/O, no clock reads (time is an input), no
// randomness. Every decision returns machine-checkable reasons.

import { isEligible, PARKING_STABLES } from "./allowlist.mjs";

export const DEFAULT_CONFIG = {
  // DQ line is 30%; we never let equity get within the buffer of it.
  hardDrawdownPct: 18,
  // Fraction of a new equity high that gets locked under the ratchet floor.
  // floor = max(floor, peak * (1 - giveBackPct/100))
  giveBackPct: 10,
  // Hard per-trade position cap as % of current equity.
  maxPositionPct: 35,
  // Total new risk that may be opened within one UTC day, % of equity.
  maxDailyNewRiskPct: 50,
  // Minimum model conviction (basis points) to consider a trade at all.
  minConvictionBps: 5500,
  // From this UTC hour, with zero trades today, the compliance valve opens.
  complianceHourUtc: 21,
  // Size of the compliance rotation in USD (tiny, fee-bounded, in-scope).
  complianceUsd: 1.25,
};

export function initialState(startEquityUsd, nowMs) {
  return {
    startEquityUsd,
    peakEquityUsd: startEquityUsd,
    floorUsd: startEquityUsd * (1 - DEFAULT_CONFIG.hardDrawdownPct / 100),
    dayKey: dayKeyOf(nowMs),
    tradesToday: 0,
    newRiskTodayPct: 0,
  };
}

export function dayKeyOf(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

// Roll the day window and ratchet the floor against current equity.
// Returns a NEW state; never mutates.
export function syncState(state, equityUsd, nowMs, config = DEFAULT_CONFIG) {
  const next = { ...state };
  const dayKey = dayKeyOf(nowMs);
  if (dayKey !== next.dayKey) {
    next.dayKey = dayKey;
    next.tradesToday = 0;
    next.newRiskTodayPct = 0;
  }
  if (equityUsd > next.peakEquityUsd) {
    next.peakEquityUsd = equityUsd;
    const ratchetFloor = equityUsd * (1 - config.giveBackPct / 100);
    if (ratchetFloor > next.floorUsd) next.floorUsd = ratchetFloor;
  }
  return next;
}

// proposal: { kind: "TRADE", symbol, direction: "enter"|"exit", convictionBps, thesis }
//           or { kind: "NONE" } when the scout/model produced nothing.
// context:  { equityUsd, nowMs, openPositionPct }
export function decide(proposal, state, context, config = DEFAULT_CONFIG) {
  const reasons = [];
  const { equityUsd, nowMs } = context;
  const hourUtc = new Date(nowMs).getUTCHours();

  // Exits are always allowed: reducing risk can never be vetoed.
  if (proposal.kind === "TRADE" && proposal.direction === "exit") {
    return verdict("APPROVE", proposal.symbol, context.openPositionPct ?? 0, [
      "exit_always_allowed",
    ]);
  }

  const riskBudgetPct = Math.max(0, ((equityUsd - state.floorUsd) / equityUsd) * 100);

  if (proposal.kind === "TRADE" && proposal.direction === "enter") {
    if (!isEligible(proposal.symbol)) {
      reasons.push(`token_not_eligible:${proposal.symbol}`);
    }
    if ((proposal.convictionBps ?? 0) < config.minConvictionBps) {
      reasons.push(`conviction_below_floor:${proposal.convictionBps ?? 0}<${config.minConvictionBps}`);
    }
    if (riskBudgetPct < 4) {
      reasons.push(`risk_budget_exhausted:${riskBudgetPct.toFixed(2)}pct_to_floor`);
    }
    if (state.newRiskTodayPct >= config.maxDailyNewRiskPct) {
      reasons.push(`daily_new_risk_cap:${state.newRiskTodayPct}>=${config.maxDailyNewRiskPct}`);
    }
    if (reasons.length > 0) {
      return maybeCompliance("VETO", reasons, state, hourUtc, config);
    }

    // Size: conviction scales into the risk budget, hard-capped.
    const convictionFactor = Math.min(1, (proposal.convictionBps - config.minConvictionBps) / 4500);
    const sizedPct = Math.min(
      config.maxPositionPct,
      Math.max(5, riskBudgetPct * 0.5 * (0.5 + convictionFactor)),
      config.maxDailyNewRiskPct - state.newRiskTodayPct,
    );
    return verdict("APPROVE", proposal.symbol, round2(sizedPct), [
      `risk_budget_pct:${round2(riskBudgetPct)}`,
      `conviction_bps:${proposal.convictionBps}`,
    ]);
  }

  // No proposal cleared the scout/model.
  return maybeCompliance("STAND_DOWN", ["no_qualifying_thesis"], state, hourUtc, config);
}

function maybeCompliance(baseDecision, reasons, state, hourUtc, config) {
  if (state.tradesToday === 0 && hourUtc >= config.complianceHourUtc) {
    return {
      decision: "COMPLIANCE_TRADE",
      symbol: `${PARKING_STABLES[0]}->${PARKING_STABLES[2]}`,
      sizedPct: 0,
      complianceUsd: config.complianceUsd,
      reasons: [...reasons, "compliance_valve:zero_trades_late_day"],
    };
  }
  return { decision: baseDecision, symbol: null, sizedPct: 0, reasons };
}

function verdict(decision, symbol, sizedPct, reasons) {
  return { decision, symbol, sizedPct, reasons };
}

// Call after an executed entry to account the day's opened risk.
export function noteEntry(state, sizedPct) {
  return {
    ...state,
    tradesToday: state.tradesToday + 1,
    newRiskTodayPct: round2(state.newRiskTodayPct + sizedPct),
  };
}

export function noteTrade(state) {
  return { ...state, tradesToday: state.tradesToday + 1 };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
