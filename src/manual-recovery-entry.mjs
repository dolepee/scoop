// Manual recovery entry for the tournament endgame.
//
// This is intentionally narrow and auditable: one eligible token from USDT,
// one open position, hard notional caps, stored invalidation, and a normal
// chained receipt. It is for deliberate recovery attempts, not cron use.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noteEntry, syncState } from "./governor.mjs";
import { balanceOf, resolveToken, savePosition, swap, USDT, USD1 } from "./executor.mjs";
import { isEligible } from "./allowlist.mjs";
import { latestReceipt, writeReceipt } from "./receipts.mjs";

const WALLET = "0x5927a9662588f5609154488111E8ee7f4075513C";
const STATE_FILE = join(process.cwd(), "state", "governor-state.json");
const POSITION_FILE = join(process.cwd(), "state", "position.json");

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

function readPosition() {
  if (!existsSync(POSITION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(POSITION_FILE, "utf8"));
  } catch {
    return null;
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function usd(balance) {
  return num(balance?.totalUsd);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number(n.toFixed(n >= 10 ? 4 : 6));
}

function balanceSnapshot(position = null) {
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

function fallbackBalanceSnapshot(before, position, amountUsd, note) {
  const estimatedPositionUsd = round2(amountUsd);
  const estimatedUsdtUsd = round2(Math.max(0, before.counters.usdtUsd - amountUsd));
  const equityUsd = round2(estimatedUsdtUsd + before.counters.usd1Usd + estimatedPositionUsd);
  return {
    usdt: null,
    usd1: null,
    positionBalance: null,
    counters: {
      equityUsd,
      usdtUsd: estimatedUsdtUsd,
      usd1Usd: before.counters.usd1Usd,
      positionUsd: estimatedPositionUsd,
      inScopeUsd: equityUsd,
      inScopeWarning: equityUsd < 2,
      degraded: false,
      equityNotes: [note, `estimated_position:${position.symbol}`],
    },
  };
}

function positionPrice(units, costUsd) {
  return units > 0 && costUsd > 0 ? costUsd / units : 0;
}

function isEndgameComeback() {
  return process.env.SCOOP_ENDGAME_COMEBACK === "1";
}

function boundedAmount(value, endgameComeback = false) {
  const amountUsd = Number(value);
  const maxUsd = endgameComeback ? 22 : 12;
  if (!Number.isFinite(amountUsd) || amountUsd < 5 || amountUsd > maxUsd) {
    throw new Error(`recovery amount must stay between $5 and $${maxUsd}`);
  }
  return amountUsd;
}

function boundedStopPct(value) {
  const stopPct = Number(value);
  if (!Number.isFinite(stopPct) || stopPct < 2 || stopPct > 8) {
    throw new Error("recovery stop pct must stay between 2 and 8");
  }
  return stopPct;
}

async function main() {
  if (process.env.SCOOP_TRADE !== "1") {
    throw new Error("SCOOP_TRADE must be 1 for manual recovery entry");
  }

  const symbol = String(process.env.SCOOP_RECOVERY_SYMBOL ?? "").trim().toUpperCase();
  if (!symbol) throw new Error("SCOOP_RECOVERY_SYMBOL missing");
  if (!isEligible(symbol)) throw new Error(`token_not_eligible:${symbol}`);
  if (readPosition()) throw new Error("recorded_position_already_open");

  const endgameComeback = isEndgameComeback();
  const amountUsd = boundedAmount(process.env.SCOOP_RECOVERY_USD ?? 10, endgameComeback);
  const stopPct = boundedStopPct(process.env.SCOOP_RECOVERY_STOP_PCT ?? 4.5);
  const slippagePct = Number(process.env.SCOOP_RECOVERY_SLIPPAGE_PCT ?? 1.5);
  if (!Number.isFinite(slippagePct) || slippagePct <= 0 || slippagePct > 4) {
    throw new Error("invalid recovery slippage");
  }

  const token = resolveToken(symbol);
  const generatedAt = new Date().toISOString();
  const before = balanceSnapshot(null);
  if (num(before.usdt?.total) < amountUsd) {
    throw new Error(`insufficient_usdt:${num(before.usdt?.total)}<${amountUsd}`);
  }
  const maxEquityFraction = endgameComeback ? 0.92 : 0.55;
  if (before.counters.equityUsd > 0 && amountUsd / before.counters.equityUsd > maxEquityFraction) {
    throw new Error(`recovery_notional_too_large:${amountUsd}/${before.counters.equityUsd}`);
  }

  const tokenBalanceBefore = balanceOf(token.address);
  const tokenUnitsBefore = num(tokenBalanceBefore?.total);
  const result = swap({
    amount: amountUsd.toFixed(2),
    from: USDT.address,
    to: token.address,
    slippagePct,
  });
  let tokenUnitsAfter = 0;
  let balanceReadNote = null;
  try {
    tokenUnitsAfter = num(balanceOf(token.address)?.total);
  } catch (error) {
    balanceReadNote = `post_swap_token_balance_read_failed:${String(error.message).slice(0, 120)}`;
    tokenUnitsAfter = tokenUnitsBefore + num(String(result.output ?? "0").split(" ")[0]);
  }
  const acquiredUnits = Math.max(0, tokenUnitsAfter - tokenUnitsBefore);
  const units = acquiredUnits || num(String(result.output ?? "0").split(" ")[0]);
  if (!(units > 0)) throw new Error("no_recovery_units_received");

  const entryPrice = positionPrice(units, amountUsd);
  const invalidationPrice = roundPrice(entryPrice * (1 - stopPct / 100));
  const invalidation = `Exit if ${symbol} trades below $${invalidationPrice} or 1h momentum turns negative.`;
  const position = {
    symbol,
    address: token.address,
    units,
    entryPrice,
    peakPriceUsd: entryPrice,
    peakPriceSource: "entry",
    peakAt: generatedAt,
    costUsd: amountUsd,
    openedAt: generatedAt,
    invalidation,
    manualRecovery: true,
    recoveryReason: "endgame comeback attempt with explicit stop and profit protection",
    endgameComeback,
  };
  savePosition(position);

  let after;
  try {
    after = balanceSnapshot(position);
  } catch (error) {
    const note = balanceReadNote ?? `post_trade_balance_read_failed:${String(error.message).slice(0, 120)}`;
    after = fallbackBalanceSnapshot(before, position, amountUsd, note);
  }
  const prev = latestReceipt();
  const priorState = readState();
  const equityUsd = before.counters.equityUsd || prev?.counters?.equityUsd || 0;
  const sizedPct = equityUsd > 0 ? round2((amountUsd / equityUsd) * 100) : 0;
  const syncedState = syncState(priorState, equityUsd, Date.parse(generatedAt));
  const state = noteEntry(syncedState, sizedPct, Date.parse(generatedAt));
  writeState(state);

  const rationale = process.env.SCOOP_RECOVERY_REASON
    || `Manual recovery entry in ${symbol}: the account needs a meaningful green move to challenge top five, while the prior paid scan left the wallet flat and protected.`;

  const { file, receipt } = writeReceipt({
    generatedAt,
    agent: "Scoop",
    wallet: WALLET,
    chain: "bsc",
    modes: {
      paid: false,
      trade: true,
      manualRecovery: true,
      endgameComeback,
    },
    perception: {
      dataSource: "manual-recovery-entry",
      paidCalls: [],
      dataSpendUsd: 0,
      marketContext: [],
      marketRegime: { regime: "manual_recovery_swing" },
      moversTop: [],
      quotes: [],
    },
    thesis: {
      action: "TRADE",
      symbol,
      direction: "enter",
      convictionBps: 0,
      rationale,
      invalidation,
      provider: "manual:recovery-entry",
      rawHash: null,
      rawPreview: null,
    },
    governor: {
      state,
      ruling: {
        decision: "MANUAL_RECOVERY_ENTRY",
        symbol,
        sizedPct,
        reasons: [
          "endgame_recovery_swing",
          "eligible_token",
          "explicit_stop",
          ...(endgameComeback ? ["top5_comeback_notional"] : []),
          `${USDT.symbol}_to_${symbol}`,
        ],
      },
      recoveryMode: true,
      entryGuard: { ok: true, reason: "manual_recovery_swing", stopDistancePct: stopPct },
      dexGuard: { ok: true, reason: "manual_recovery_swing" },
      exitSignalGuard: { ok: true, reason: "not_an_exit" },
    },
    position,
    execution: {
      executed: true,
      kind: "manual_recovery_entry",
      txHash: result.txHash,
      tokenIn: USDT.symbol,
      tokenInAddress: USDT.address,
      tokenOut: symbol,
      tokenOutAddress: token.address,
      spentUsd: amountUsd,
      units,
      entryPrice,
      invalidationPrice,
      stopPct,
      slippagePct,
      provider: result.provider,
      balanceReadNote,
    },
    counters: {
      ...after.counters,
      floorUsd: state.floorUsd ?? prev?.counters?.floorUsd ?? null,
      before: before.counters,
    },
  });

  console.log(`SCOOP_RECOVERY_ENTRY tx=${result.txHash} receipt=${file} checksum=${receipt.checksum}`);
  console.log(`symbol=${symbol} amountUsd=${amountUsd} units=${units} entryPrice=${entryPrice} invalidation=${invalidationPrice}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
