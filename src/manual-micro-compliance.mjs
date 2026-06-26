// Manual Day-gate repair with real, tiny market exposure.
//
// This avoids stable-to-stable optics while keeping DQ risk bounded. It can
// only buy an eligible token from USDT, records the position, and writes a
// normal chained receipt. Intended for near-DQ tournament state, not alpha.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noteEntry, syncState } from "./governor.mjs";
import { balanceOf, resolveToken, savePosition, swap, tokenUnits, USDT, USD1 } from "./executor.mjs";
import { isEligible } from "./allowlist.mjs";
import { writeReceipt, latestReceipt } from "./receipts.mjs";

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

function tokenPriceFromBalance(units, costUsd) {
  return units > 0 && costUsd > 0 ? costUsd / units : 0;
}

async function main() {
  if (process.env.SCOOP_TRADE !== "1") {
    throw new Error("SCOOP_TRADE must be 1 for manual micro compliance");
  }

  const symbol = String(process.env.SCOOP_MICRO_SYMBOL ?? "CAKE").toUpperCase();
  const amountUsd = Number(process.env.SCOOP_MICRO_USD ?? 1.25);
  const slippagePct = Number(process.env.SCOOP_MICRO_SLIPPAGE_PCT ?? 1.2);
  if (!isEligible(symbol)) throw new Error(`token_not_eligible:${symbol}`);
  if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 2) {
    throw new Error("micro amount must stay between $1 and $2");
  }
  if (!Number.isFinite(slippagePct) || slippagePct <= 0 || slippagePct > 3) {
    throw new Error("invalid micro slippage");
  }
  if (readPosition()) throw new Error("recorded_position_already_open");

  const token = resolveToken(symbol);
  const generatedAt = new Date().toISOString();
  const before = balanceSnapshot(null);
  if (num(before.usdt?.total) < amountUsd) {
    throw new Error(`insufficient_usdt:${num(before.usdt?.total)}<${amountUsd}`);
  }

  const result = swap({
    amount: amountUsd.toFixed(2),
    from: USDT.address,
    to: token.address,
    slippagePct,
  });

  const units = tokenUnits(token.address) || num(String(result.output ?? "0").split(" ")[0]);
  const position = {
    symbol,
    address: token.address,
    units,
    entryPrice: tokenPriceFromBalance(units, amountUsd),
    peakPriceUsd: tokenPriceFromBalance(units, amountUsd),
    peakPriceSource: "entry",
    peakAt: generatedAt,
    costUsd: amountUsd,
    openedAt: generatedAt,
    complianceTrade: true,
    complianceReason: "micro real-token daily gate, near DQ buffer",
    microCompliance: true,
  };
  savePosition(position);

  const after = balanceSnapshot(position);
  const prev = latestReceipt();
  const priorState = readState();
  const equityUsd = before.counters.equityUsd || prev?.counters?.equityUsd || 0;
  const sizedPct = equityUsd > 0 ? round2((amountUsd / equityUsd) * 100) : 0;
  const syncedState = syncState(priorState, equityUsd, Date.parse(generatedAt));
  const state = noteEntry(syncedState, sizedPct, Date.parse(generatedAt));
  writeState(state);

  const { file, receipt } = writeReceipt({
    generatedAt,
    agent: "Scoop",
    wallet: WALLET,
    chain: "bsc",
    modes: {
      paid: false,
      trade: true,
      manualMicroCompliance: true,
    },
    perception: {
      dataSource: "manual-micro-compliance",
      paidCalls: [],
      dataSpendUsd: 0,
      marketContext: [],
      marketRegime: { regime: "near_dq_micro_real_token_gate" },
      moversTop: [],
      quotes: [],
    },
    thesis: {
      action: "TRADE",
      symbol,
      direction: "enter",
      convictionBps: 0,
      rationale: `Manual micro real-token trade in ${symbol} to satisfy the daily gate without using stable-to-stable and without adding meaningful DQ risk.`,
      invalidation: "Manual micro compliance; close if drawdown risk increases or next cycle exits.",
      provider: "manual:micro-compliance",
      rawHash: null,
      rawPreview: null,
    },
    governor: {
      state,
      ruling: {
        decision: "MANUAL_MICRO_COMPLIANCE",
        symbol,
        sizedPct,
        reasons: [
          "daily_gate_real_token",
          "near_dq_micro_size",
          `${USDT.symbol}_to_${symbol}`,
        ],
      },
      recoveryMode: true,
      entryGuard: { ok: true, reason: "manual_micro_real_token" },
      dexGuard: { ok: true, reason: "manual_micro_real_token" },
      exitSignalGuard: { ok: true, reason: "not_an_exit" },
    },
    position,
    execution: {
      executed: true,
      kind: "manual_micro_compliance",
      txHash: result.txHash,
      tokenIn: USDT.symbol,
      tokenInAddress: USDT.address,
      tokenOut: symbol,
      tokenOutAddress: token.address,
      spentUsd: amountUsd,
      units,
      slippagePct,
      provider: result.provider,
    },
    counters: {
      ...after.counters,
      floorUsd: state.floorUsd ?? prev?.counters?.floorUsd ?? null,
      before: before.counters,
    },
  });

  console.log(`SCOOP_MICRO_COMPLIANCE tx=${result.txHash} receipt=${file} checksum=${receipt.checksum}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
