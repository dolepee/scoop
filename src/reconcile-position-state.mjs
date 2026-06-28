// Reconcile stale local position state against the live wallet.
//
// This does not trade. It only clears state/position.json when the recorded
// position no longer exists on-chain except for dust, then writes a chained
// receipt so the correction is auditable.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { balanceOf, loadPosition, savePosition, USDT, USD1 } from "./executor.mjs";
import { latestReceipt, writeReceipt } from "./receipts.mjs";

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
  const generatedAt = new Date().toISOString();
  const position = loadPosition();
  if (!position?.symbol || !position?.address) {
    throw new Error("no_recorded_position");
  }

  const before = balanceSnapshot(position);
  const liveUnits = units(before.positionBalance);
  const recordedUnits = num(position.units);
  const costUsd = num(position.costUsd);
  const positionUsd = before.counters.positionUsd;
  const dustUsdCeiling = Number(process.env.SCOOP_RECONCILE_DUST_USD ?? 0.5);
  const maxUnitFraction = Number(process.env.SCOOP_RECONCILE_MAX_UNIT_FRACTION ?? 0.01);
  const liveUnitFraction = recordedUnits > 0 ? liveUnits / recordedUnits : 0;

  if (!(positionUsd <= dustUsdCeiling && liveUnitFraction <= maxUnitFraction)) {
    throw new Error(`position_not_dust: liveUsd=${positionUsd} liveUnitFraction=${liveUnitFraction}`);
  }

  savePosition(null);
  const after = balanceSnapshot(null);
  const state = readState();
  const prev = latestReceipt();
  const realizedPnlUsd = costUsd > 0 ? round2(positionUsd - costUsd) : null;
  const realizedPnlPct = costUsd > 0 ? round2(((positionUsd - costUsd) / costUsd) * 100) : null;

  const { file, receipt } = writeReceipt({
    generatedAt,
    agent: "Scoop",
    wallet: WALLET,
    chain: "bsc",
    modes: {
      paid: false,
      trade: false,
      stateReconciliation: true,
    },
    perception: {
      dataSource: "live-wallet-reconciliation",
      paidCalls: [],
      dataSpendUsd: 0,
      marketContext: [],
      marketRegime: { regime: "state_reconciliation" },
      moversTop: [],
      quotes: [],
    },
    thesis: {
      action: "NONE",
      symbol: position.symbol,
      direction: "stand_down",
      convictionBps: 0,
      rationale: `Cleared stale ${position.symbol} state after live wallet showed only dust remained, preventing the next cycle from acting on a nonexistent position.`,
      invalidation: position.invalidation ?? "N/A",
      provider: "deterministic:wallet-reconciliation",
      rawHash: null,
      rawPreview: null,
    },
    governor: {
      state,
      ruling: {
        decision: "STATE_RECONCILED",
        symbol: position.symbol,
        sizedPct: 0,
        reasons: [
          "recorded_position_missing_onchain",
          "live_balance_below_dust_threshold",
          "cleared_local_position_state",
        ],
      },
      recoveryMode: true,
      entryGuard: { ok: true, reason: "not_an_entry" },
      dexGuard: { ok: true, reason: "no_trade" },
      exitSignalGuard: { ok: true, reason: "state_reconciliation_only" },
    },
    position: null,
    execution: {
      executed: false,
      kind: "state_reconciliation",
      txHash: null,
      token: position.symbol,
      tokenAddress: position.address,
      recordedUnits,
      liveUnits,
      liveUnitFraction,
      recordedCostUsd: costUsd,
      livePositionUsd: positionUsd,
      realizedPnlUsd,
      realizedPnlPct,
      note: "No swap was sent. This receipt only aligns local state with live wallet balances.",
    },
    counters: {
      ...after.counters,
      floorUsd: state.floorUsd ?? prev?.counters?.floorUsd ?? null,
      before: before.counters,
    },
  });

  console.log(`SCOOP_STATE_RECONCILED receipt=${file} checksum=${receipt.checksum}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
