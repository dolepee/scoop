// One-off daily-gate repair path for the tournament leaderboard.
// It is intentionally narrow: stable-to-stable only, trade mode must be armed,
// and it writes a normal chained receipt for auditability.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { balanceOf, loadPosition, resolveToken, swap, USDT, USD1 } from "./executor.mjs";
import { writeReceipt, latestReceipt } from "./receipts.mjs";

const WALLET = "0x5927a9662588f5609154488111E8ee7f4075513C";
const STABLE_SYMBOLS = new Set(["USDT", "USDC", "USD1"]);
const STATE_FILE = join(process.cwd(), "state", "governor-state.json");

function stable(symbol) {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (!STABLE_SYMBOLS.has(normalized)) {
    throw new Error(`stable_symbol_required:${symbol}`);
  }
  return resolveToken(normalized);
}

function amountInput(sourceBalance = null) {
  const raw = String(process.env.SCOOP_STABLE_AMOUNT ?? "5").trim();
  const amountText = raw.toLowerCase() === "all"
    ? String(sourceBalance?.total ?? sourceBalance?.available ?? "0")
    : raw;
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid_stable_amount");
  if (amount > 10) throw new Error("stable_amount_cap:10");
  return { amount, amountText };
}

function usd(balance) {
  return Number(balance?.totalUsd ?? 0) || 0;
}

function units(balance) {
  return Number(balance?.total ?? balance?.available ?? 0) || 0;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function readState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function balanceSnapshot(position) {
  const usdt = balanceOf(USDT.address);
  const usdcToken = resolveToken("USDC");
  const usdc = balanceOf(usdcToken.address);
  const usd1 = balanceOf(USD1.address);
  const positionBalance = position?.address ? balanceOf(position.address) : null;
  const positionUsd = usd(positionBalance);
  const usdtUsd = usd(usdt);
  const usdcUsd = usd(usdc);
  const usd1Usd = usd(usd1);
  const equityUsd = round2(usdtUsd + usdcUsd + usd1Usd + positionUsd);
  return {
    usdt,
    usdc,
    usd1,
    positionBalance,
    counters: {
      equityUsd,
      usdtUsd: round2(usdtUsd),
      usdcUsd: round2(usdcUsd),
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
    throw new Error("SCOOP_TRADE must be 1 for manual stable compliance");
  }

  const from = stable(process.env.SCOOP_STABLE_FROM ?? "USDT");
  const to = stable(process.env.SCOOP_STABLE_TO ?? "USDC");
  if (from.address.toLowerCase() === to.address.toLowerCase()) {
    throw new Error("stable_from_to_must_differ");
  }

  const slippagePct = Number(process.env.SCOOP_STABLE_SLIPPAGE_PCT ?? 0.8);
  if (!Number.isFinite(slippagePct) || slippagePct <= 0 || slippagePct > 2) {
    throw new Error("invalid_stable_slippage");
  }

  const generatedAt = new Date().toISOString();
  const position = loadPosition();
  const before = balanceSnapshot(position);
  const sourceBalance = from.symbol === "USDT" ? before.usdt : from.symbol === "USDC" ? before.usdc : before.usd1;
  const { amount, amountText } = amountInput(sourceBalance);
  if (units(sourceBalance) < amount) {
    throw new Error(`insufficient_${from.symbol.toLowerCase()}:${units(sourceBalance)}<${amount}`);
  }

  const result = swap({
    amount: amountText,
    from: from.address,
    to: to.address,
    slippagePct,
  });
  const after = balanceSnapshot(position);
  const state = readState();
  const prev = latestReceipt();

  const { file } = writeReceipt({
    generatedAt,
    agent: "Scoop",
    wallet: WALLET,
    chain: "bsc",
    modes: {
      paid: false,
      trade: true,
      manualStableCompliance: true,
    },
    perception: {
      dataSource: "manual-stable-compliance",
      paidCalls: [],
      dataSpendUsd: 0,
      marketContext: [],
      marketRegime: { regime: "manual_stable_consolidation" },
      moversTop: [],
      quotes: [],
    },
    thesis: {
      action: "TRADE",
      symbol: `${from.symbol}->${to.symbol}`,
      direction: "stable_compliance",
      convictionBps: 0,
      rationale: "Manual stable-to-stable consolidation without adding directional exposure.",
      invalidation: "N/A",
      provider: "manual:stable-compliance",
      rawHash: null,
      rawPreview: null,
    },
    governor: {
      state,
      ruling: {
        decision: "MANUAL_STABLE_COMPLIANCE",
        symbol: to.symbol,
        sizedPct: before.counters.equityUsd > 0 ? round2((amount / before.counters.equityUsd) * 100) : 0,
        reasons: [
          "stable_consolidation",
          "stable_to_stable_only",
          `${from.symbol}_to_${to.symbol}`,
        ],
      },
      recoveryMode: true,
      entryGuard: { ok: true, reason: "not_directional_entry" },
      dexGuard: { ok: true, reason: "stable_to_stable_manual" },
      exitSignalGuard: { ok: true, reason: "not_an_exit" },
    },
    position,
    execution: {
      executed: true,
      kind: "manual_stable_compliance",
      txHash: result.txHash,
      tokenIn: from.symbol,
      tokenInAddress: from.address,
      tokenOut: to.symbol,
      tokenOutAddress: to.address,
      amountIn: amount,
      slippagePct,
      provider: result.provider,
    },
    counters: {
      ...after.counters,
      floorUsd: state.floorUsd ?? prev?.counters?.floorUsd ?? null,
      before: before.counters,
    },
  });

  console.log(`SCOOP_MANUAL_STABLE_COMPLIANCE tx=${result.txHash} receipt=${file}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
