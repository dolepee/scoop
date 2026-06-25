// Manual risk-off close for the current recorded position.
// This is deliberately narrow: it can only sell state/position.json back to USDT
// and records the action as a normal chained receipt.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noteTrade } from "./governor.mjs";
import { balanceOf, loadPosition, savePosition, swap, USDT, USD1 } from "./executor.mjs";
import { writeReceipt, latestReceipt } from "./receipts.mjs";

const WALLET = "0x5927a9662588f5609154488111E8ee7f4075513C";
const STATE_FILE = join(process.cwd(), "state", "governor-state.json");

function readState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function usd(balance) {
  return num(balance?.totalUsd);
}

function units(balance) {
  return num(balance?.total ?? balance?.available);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatTokenAmount(value) {
  return Number(value).toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

function closeableUnits(position, liveUnits) {
  const recorded = Number(position.units) || 0;
  const base = liveUnits > 0 ? Math.min(liveUnits, recorded || liveUnits) : recorded;
  return base > 0 ? base * 0.999 : 0;
}

function balanceSnapshot(position) {
  const usdt = balanceOf(USDT.address);
  const usd1 = balanceOf(USD1.address);
  const positionBalance = position?.address ? balanceOf(position.address) : null;
  const usdtUsd = usd(usdt);
  const usd1Usd = usd(usd1);
  const positionUsd = usd(positionBalance);
  const equityUsd = round2(usdtUsd + usd1Usd + positionUsd);
  return {
    usdt,
    usd1,
    positionBalance,
    counters: {
      equityUsd,
      usdtUsd: round2(usdtUsd),
      usd1Usd: round2(usd1Usd),
      positionUsd: round2(positionUsd),
      inScopeUsd: equityUsd,
      inScopeWarning: equityUsd < 2,
      degraded: false,
      equityNotes: [],
    },
  };
}

async function main() {
  if (process.env.SCOOP_TRADE !== "1") {
    throw new Error("SCOOP_TRADE must be 1 for manual close");
  }

  const generatedAt = new Date().toISOString();
  const position = loadPosition();
  if (!position?.symbol || !position?.address) throw new Error("no_recorded_position_to_close");

  const before = balanceSnapshot(position);
  const liveUnits = units(before.positionBalance);
  const closeUnits = closeableUnits(position, liveUnits);
  if (closeUnits <= 0) throw new Error("no_live_units_to_close");

  const slippagePct = Number(process.env.SCOOP_CLOSE_SLIPPAGE_PCT ?? 5);
  if (!Number.isFinite(slippagePct) || slippagePct <= 0 || slippagePct > 10) {
    throw new Error("invalid_close_slippage");
  }

  const result = swap({
    amount: formatTokenAmount(closeUnits),
    from: position.address,
    to: USDT.address,
    slippagePct,
  });

  savePosition(null);
  const after = balanceSnapshot(null);
  const prev = latestReceipt();
  const state = noteTrade(readState(), Date.parse(generatedAt));
  writeState(state);

  const costUsd = num(position.costUsd);
  const beforeValueUsd = before.counters.positionUsd;
  const realizedPnlUsd = costUsd > 0 ? round2(beforeValueUsd - costUsd) : null;
  const realizedPnlPct = costUsd > 0 ? round2(((beforeValueUsd - costUsd) / costUsd) * 100) : null;

  const { file } = writeReceipt({
    generatedAt,
    agent: "Scoop",
    wallet: WALLET,
    chain: "bsc",
    modes: {
      paid: false,
      trade: true,
      manualClose: true,
    },
    perception: {
      dataSource: "manual-close-position",
      paidCalls: [],
      dataSpendUsd: 0,
      marketContext: [],
      marketRegime: { regime: "manual_risk_off_close" },
      moversTop: [],
      quotes: [],
    },
    thesis: {
      action: "TRADE",
      symbol: position.symbol,
      direction: "exit",
      convictionBps: 10000,
      rationale: `Manual risk-off close of ${position.symbol} back to USDT to avoid further drawdown near the tournament DQ line.`,
      invalidation: position.invalidation ?? "N/A",
      provider: "manual:close-position",
      rawHash: null,
      rawPreview: null,
    },
    governor: {
      state,
      ruling: {
        decision: "MANUAL_CLOSE",
        symbol: position.symbol,
        sizedPct: before.counters.equityUsd > 0 ? round2((beforeValueUsd / before.counters.equityUsd) * 100) : 0,
        reasons: [
          "manual_risk_off_close",
          "near_drawdown_gate",
          `${position.symbol}_to_USDT`,
        ],
      },
      recoveryMode: true,
      entryGuard: { ok: true, reason: "not_an_entry" },
      dexGuard: { ok: true, reason: "manual_exit" },
      exitSignalGuard: { ok: true, reason: "manual_exit" },
    },
    position: null,
    execution: {
      executed: true,
      kind: "manual_close",
      txHash: result.txHash,
      tokenIn: position.symbol,
      tokenInAddress: position.address,
      tokenOut: USDT.symbol,
      tokenOutAddress: USDT.address,
      closedUnits: closeUnits,
      slippagePct,
      provider: result.provider,
      beforePositionUsd: beforeValueUsd,
      costUsd,
      realizedPnlUsd,
      realizedPnlPct,
    },
    counters: {
      ...after.counters,
      floorUsd: state.floorUsd ?? prev?.counters?.floorUsd ?? null,
      before: before.counters,
    },
  });

  console.log(`SCOOP_MANUAL_CLOSE tx=${result.txHash} receipt=${file}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
