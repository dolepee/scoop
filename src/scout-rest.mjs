// Paid perception over CMC's REST x402 endpoints (the validated rail).
// Two purchases per standard cycle, budget-capped:
//
//   1. listings/latest sorted by 24h change: the market-wide movers board.
//      Scoop filters it to the competition's eligible tokens, which is the
//      scanner: where is the heat, in the universe we are allowed to trade.
//   2. quotes/latest for the top candidates: precise 1h/24h/7d momentum and
//      volume for the shortlist the thesis layer will reason over.
//
// Every call is paid ($0.01 USDT on BSC via Permit2) by the same
// self-custody wallet that trades, recorded with cost + response hash.

import { execFileSync } from "node:child_process";
import { sha256, canonical } from "./receipts.mjs";
import { isEligible } from "./allowlist.mjs";

const BASE = "https://pro-api.coinmarketcap.com/x402";
const MAX_PAYMENT_ATOMIC = "10000000000000000"; // $0.01 (18dp USDT on BSC)
const USDT = "0x55d398326f99059fF775485246999027B3197955";
export const COST_PER_CALL_USD = 0.01;

export function newDataBudget(capUsd) {
  return { capUsd, spentUsd: 0, calls: 0 };
}

// The x402 REST responses return `quote` as an array of currency entries
// (not the keyed object the classic API uses). Tolerate both.
function usdQuote(c) {
  if (Array.isArray(c?.quote)) return c.quote.find((q) => q?.symbol === "USD") ?? c.quote[0] ?? {};
  return c?.quote?.USD ?? {};
}

function paidGet(url, budget) {
  if (budget.spentUsd + COST_PER_CALL_USD > budget.capUsd) {
    return { skipped: true, reason: "data_budget_exhausted", url };
  }
  try {
    const out = execFileSync(
      "npx",
      [
        "twak", "x402", "request", url,
        "--prefer-network", "bsc",
        "--prefer-method", "permit2-exact",
        "--prefer-asset", USDT,
        "--max-payment", MAX_PAYMENT_ATOMIC,
        "--yes", "--auto-approve", "--json",
      ],
      { encoding: "utf8", timeout: 90_000, env: process.env },
    );
    budget.spentUsd = Math.round((budget.spentUsd + COST_PER_CALL_USD) * 100) / 100;
    budget.calls += 1;
    const start = out.indexOf("{");
    const payload = JSON.parse(out.slice(start));
    return { url, costUsd: COST_PER_CALL_USD, dataSource: "x402-paid", responseHash: sha256(canonical(payload)), payload };
  } catch (error) {
    return freeFallbackGet(url, error);
  }
}

function freeFallbackGet(url, error) {
  if (!process.env.CMC_API_KEY) throw error;
  const fallbackUrl = url.replace("/x402", "");
  const out = execFileSync(
    "curl",
    ["--fail", "--silent", "--show-error", "--header", `X-CMC_PRO_API_KEY: ${process.env.CMC_API_KEY}`, fallbackUrl],
    { encoding: "utf8", timeout: 90_000 },
  );
  const payload = JSON.parse(out);
  return {
    url: fallbackUrl,
    costUsd: 0,
    dataSource: "free-fallback",
    fallbackFrom: "x402-paid",
    responseHash: sha256(canonical(payload)),
    payload,
  };
}

// Movers board. Raw "top gainers" are micro-caps that never pass the
// eligibility filter, so instead: pull the top of the market by volume and
// rank momentum WITHIN the tradable universe. One paid call either way.
export function buyMovers(budget, { limit = 200 } = {}) {
  const url = `${BASE}/v3/cryptocurrency/listings/latest?limit=${limit}&sort=volume_24h&sort_dir=desc&convert=USD`;
  const call = paidGet(url, budget);
  if (call.skipped || !call.payload?.data) return { call, movers: [], universe: { received: 0, eligible: 0 } };
  const received = call.payload.data.length;
  const eligibleRows = call.payload.data.filter((c) => isEligible(c.symbol));
  const movers = eligibleRows
    .map((c) => {
      const q = usdQuote(c);
      return {
        symbol: c.symbol,
        name: c.name,
        change1h: q.percent_change_1h ?? null,
        change24h: q.percent_change_24h ?? null,
        change7d: q.percent_change_7d ?? null,
        volume24h: q.volume_24h ?? null,
        marketCap: q.market_cap ?? null,
        priceUsd: q.price ?? null,
      };
    })
    // Liquidity floor: thin tokens are untradable at sane slippage on BSC.
    .filter((c) => (c.volume24h ?? 0) > 2_000_000)
    // Stables are parking, not momentum candidates.
    .filter((c) => !["USDT", "USDC", "USD1", "DAI", "TUSD", "FDUSD", "USDD", "FRAX", "USDE", "USDF", "XUSD", "EURI", "FRXUSD", "LISUSD", "DUSD", "STABLE"].includes(c.symbol.toUpperCase()))
    // Heat score: recent change dominates, day trend supports, week fades.
    .map((c) => ({
      ...c,
      heat: Math.round(((c.change1h ?? 0) * 3 + (c.change24h ?? 0) * 1 + (c.change7d ?? 0) * 0.15) * 100) / 100,
    }))
    .sort((a, b) => b.heat - a.heat);
  return { call, movers, universe: { received, eligible: eligibleRows.length, candidates: movers.length } };
}

// Precise quotes for the shortlist (single paid call, comma symbols).
export function buyQuotes(symbols, budget) {
  if (symbols.length === 0) return { call: { skipped: true, reason: "no_symbols" }, quotes: [] };
  const url = `${BASE}/v3/cryptocurrency/quotes/latest?symbol=${symbols.slice(0, 8).join(",")}&convert=USD`;
  const call = paidGet(url, budget);
  if (call.skipped || !call.payload?.data) return { call, quotes: [] };
  // data may be a symbol-keyed object or a plain array of coin entries.
  const rows = Array.isArray(call.payload.data)
    ? call.payload.data.map((c) => [c?.symbol, c])
    : Object.entries(call.payload.data);
  // Symbols can collide across token ids; keep the highest-volume entry.
  const bySymbol = new Map();
  for (const [sym, entries] of rows) {
    const c = Array.isArray(entries) ? entries[0] : entries;
    if (!c || !sym) continue;
    const q = usdQuote(c);
    const row = {
      symbol: sym,
      priceUsd: q.price ?? null,
      change1h: q.percent_change_1h ?? null,
      change24h: q.percent_change_24h ?? null,
      change7d: q.percent_change_7d ?? null,
      volume24h: q.volume_24h ?? null,
      volumeChange24h: q.volume_change_24h ?? null,
    };
    const prev = bySymbol.get(sym);
    if (!prev || (row.volume24h ?? 0) > (prev.volume24h ?? 0)) bySymbol.set(sym, row);
  }
  return { call, quotes: [...bySymbol.values()] };
}

export function describeCalls(calls) {
  return calls
    .filter(Boolean)
    .map((c) => (c.skipped
      ? { skipped: c.reason, url: c.url }
      : {
        url: c.url,
        costUsd: c.costUsd,
        dataSource: c.dataSource,
        fallbackFrom: c.fallbackFrom,
        responseHash: c.responseHash,
      }));
}
