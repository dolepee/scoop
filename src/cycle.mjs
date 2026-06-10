// One Scoop cycle: perceive (paid) -> think -> govern -> execute -> receipt.
//
// Safety model, controlled by env:
//   SCOOP_PAID=1   allow x402 spend (paid perception). Default: free only.
//   SCOOP_TRADE=1  allow real swaps. Default: decisions are logged, not executed.
// Cron runs perceive+think+govern for days before the first real trade is
// enabled; every stage of that ramp leaves the same chained receipts.

import { execFileSync } from "node:child_process";
import { decide, DEFAULT_CONFIG, initialState, noteEntry, noteTrade, syncState } from "./governor.mjs";
import { writeReceipt, latestReceipt, sha256, canonical } from "./receipts.mjs";
import { buyMovers, buyQuotes, newDataBudget, describeCalls } from "./scout-rest.mjs";
import { formThesis } from "./thesis.mjs";
import { loadPosition, savePosition, resolveToken, swap, USDT, USD1 } from "./executor.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PAID = process.env.SCOOP_PAID === "1";
const TRADE = process.env.SCOOP_TRADE === "1";
const DATA_CAP_USD = Number(process.env.SCOOP_DATA_CAP_USD ?? 0.05);
const STATE_FILE = join(process.cwd(), "state", "governor-state.json");
const WALLET = "0x5927a9662588f5609154488111E8ee7f4075513C";

function twakJson(args, timeout = 90_000) {
  const out = execFileSync("npx", ["twak", ...args, "--json"], { encoding: "utf8", timeout, env: process.env });
  const i = Math.min(...[out.indexOf("{"), out.indexOf("[")].filter((x) => x >= 0));
  return JSON.parse(out.slice(i));
}

function tokenBalance(address) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const b = twakJson(["balance", "--chain", "bsc", "--address", WALLET, "--token", address]);
      const v = Number(b.totalUsd ?? 0) || Number(b.total ?? 0) || 0;
      if (v > 0 || attempt === 2) return v;
    } catch {
      // retry
    }
  }
  return null; // signals a failed read; caller carries forward
}

function priceUsd(symbol) {
  try {
    return Number(twakJson(["price", symbol]).priceUsd) || 0;
  } catch {
    return 0;
  }
}

async function main() {
  const nowMs = Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const budget = newDataBudget(PAID ? DATA_CAP_USD : 0);
  const position = loadPosition();

  // ---- Perceive ---------------------------------------------------------
  let movers = [];
  let quotes = [];
  const paidCalls = [];
  if (PAID) {
    const m = buyMovers(budget);
    paidCalls.push(m.call);
    movers = m.movers;
    const shortlist = [...new Set([
      ...movers.slice(0, 4).map((x) => x.symbol),
      ...(position ? [position.symbol] : []),
    ])];
    const q = buyQuotes(shortlist, budget);
    paidCalls.push(q.call);
    quotes = q.quotes;
  }

  // ---- Equity ------------------------------------------------------------
  // A flaky balance read must never zero the governor's view of equity:
  // failed components carry forward from the previous receipt and the cycle
  // is marked degraded, which forbids trading until reads are healthy.
  const prev = latestReceipt();
  let degraded = false;
  const carry = (fresh, prevValue, label, notes) => {
    if (fresh !== null && fresh !== undefined) return fresh;
    degraded = true;
    notes.push(`balance_read_failed:${label}`);
    return prevValue ?? 0;
  };
  const equityNotes = [];
  const usdtUsd = carry(tokenBalance(USDT.address), prev?.counters?.usdtUsd, "USDT", equityNotes);
  const usd1Usd = carry(tokenBalance(USD1.address), prev?.counters?.usd1Usd, "USD1", equityNotes);
  let positionUsd = 0;
  if (position) {
    const p = priceUsd(position.symbol);
    positionUsd = p > 0 ? p * position.units : prev?.counters?.positionUsd ?? position.costUsd ?? 0;
    if (p <= 0) {
      degraded = true;
      equityNotes.push(`price_read_failed:${position.symbol}`);
    }
  }
  const equityUsd = Math.round((usdtUsd + usd1Usd + positionUsd) * 100) / 100;

  // ---- Think -------------------------------------------------------------
  const { thesis, provider, raw } = PAID
    ? await formThesis({ movers, quotes, position, equityUsd })
    : { thesis: { action: "NO_TRADE", convictionBps: 0, rationale: "free_mode" }, provider: null, raw: null };

  const proposal = thesis.action === "TRADE"
    ? { kind: "TRADE", symbol: thesis.symbol, direction: thesis.direction, convictionBps: thesis.convictionBps }
    : { kind: "NONE" };

  // ---- Govern ------------------------------------------------------------
  let state = existsSync(STATE_FILE)
    ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
    : initialState(equityUsd, nowMs);
  if (!degraded) state = syncState(state, equityUsd, nowMs);
  const ruling = degraded
    ? { decision: "STAND_DOWN", symbol: null, sizedPct: 0, reasons: ["equity_degraded", ...equityNotes] }
    : decide(proposal, state, { equityUsd, nowMs, openPositionPct: position ? (positionUsd / equityUsd) * 100 : 0 });

  // ---- Execute -----------------------------------------------------------
  let execution = { executed: false, mode: TRADE ? "armed" : "observe" };
  if (TRADE && ruling.decision === "APPROVE") {
    try {
      if (proposal.direction === "enter") {
        if (position) throw new Error("position_already_open");
        const token = resolveToken(proposal.symbol);
        const spendUsd = Math.min((ruling.sizedPct / 100) * equityUsd, usdtUsd * 0.98);
        const res = swap({ amount: spendUsd.toFixed(2), from: USDT.address, to: token.address });
        const entryPrice = priceUsd(proposal.symbol);
        const units = Number(String(res.output ?? "0").split(" ")[0]) || (entryPrice > 0 ? spendUsd / entryPrice : 0);
        savePosition({ symbol: proposal.symbol, address: token.address, units, entryPrice, costUsd: spendUsd, openedAt: generatedAt, invalidation: thesis.invalidation });
        state = noteEntry(state, ruling.sizedPct);
        execution = { executed: true, kind: "enter", txHash: res.txHash, spentUsd: spendUsd, units };
      } else {
        if (!position) throw new Error("no_position_to_exit");
        const res = swap({ amount: String(position.units), from: position.address, to: USDT.address });
        savePosition(null);
        state = noteTrade(state);
        execution = { executed: true, kind: "exit", txHash: res.txHash, closedUnits: position.units };
      }
    } catch (error) {
      execution = { executed: false, error: String(error.message).slice(0, 200) };
    }
  } else if (TRADE && ruling.decision === "COMPLIANCE_TRADE") {
    try {
      const res = swap({ amount: String(DEFAULT_CONFIG.complianceUsd), from: USDT.address, to: USD1.address });
      state = noteTrade(state);
      execution = { executed: true, kind: "compliance_rotation", txHash: res.txHash, usd: DEFAULT_CONFIG.complianceUsd };
    } catch (error) {
      execution = { executed: false, error: String(error.message).slice(0, 200) };
    }
  }
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

  // ---- Receipt ------------------------------------------------------------
  const { receipt, file } = writeReceipt({
    generatedAt,
    agent: "Scoop",
    wallet: WALLET,
    chain: "bsc",
    modes: { paid: PAID, trade: TRADE },
    perception: {
      paidCalls: describeCalls(paidCalls),
      dataSpendUsd: budget.spentUsd,
      moversTop: movers.slice(0, 6),
      quotes,
    },
    thesis: { ...thesis, provider, rawHash: raw ? sha256(canonical(raw)) : null, rawPreview: raw ? String(raw).slice(0, 280) : null },
    governor: { state: { ...state }, ruling },
    position: loadPosition(),
    execution,
    counters: { equityUsd, usdtUsd, usd1Usd, positionUsd, floorUsd: state.floorUsd, degraded, equityNotes },
  });

  console.log("SCOOP_CYCLE_COMPLETE");
  console.log(`modes=paid:${PAID},trade:${TRADE}`);
  console.log(`equityUsd=${equityUsd} dataSpend=$${budget.spentUsd}`);
  console.log(`thesis=${thesis.action}${thesis.symbol ? ":" + thesis.symbol : ""} conviction=${thesis.convictionBps}`);
  console.log(`decision=${ruling.decision} reasons=${ruling.reasons.join("|")}`);
  console.log(`receipt=${file}`);
  console.log(`checksum=${receipt.checksum}`);
}

await main();
