// The Scout: Scoop's paid perception layer.
//
// CMC's Agent Hub exposes an x402-gated MCP server. The JSON-RPC handshake
// and tools/list are free; every tools/call is paid per request ($0.01,
// settled on BNB Smart Chain from the agent's own wallet, gasless eip3009).
// Scoop routes every paid call through `twak x402 request`, so the SAME
// self-custody key that trades also pays for the data: costed perception.
//
// Budget discipline: each cycle gets a hard data budget. The scout decides
// what is worth buying this cycle (narratives first, then news/TA on the
// single best candidate) and stops when the budget is spent. Every call is
// recorded with its cost and a response hash for the receipt chain.

import { execFileSync } from "node:child_process";
import { sha256, canonical } from "./receipts.mjs";

const MCP_URL = "https://mcp.coinmarketcap.com/x402/mcp";
// $0.01 with 18 decimals (USD1 on BSC). Atomic cap per call.
const MAX_PAYMENT_ATOMIC = "10000000000000000";
export const COST_PER_CALL_USD = 0.01;

let rpcId = 100;

function mcpEnvelope(method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params });
}

// Free, unauthenticated MCP call (initialize / tools list).
export async function mcpFree(method, params = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: mcpEnvelope(method, params),
    signal: AbortSignal.timeout(20_000),
  });
  return parseMcpBody(await res.text());
}

// Paid MCP tool call through twak's x402 client. The payment authorization
// is signed locally by the agent wallet; we pin the route to BSC.
export function callToolPaid(name, args, { dataBudget }) {
  if (dataBudget.spentUsd + COST_PER_CALL_USD > dataBudget.capUsd) {
    return { skipped: true, reason: "data_budget_exhausted", tool: name };
  }
  const body = mcpEnvelope("tools/call", { name, arguments: args });
  const out = execFileSync(
    "npx",
    [
      "twak", "x402", "request", MCP_URL,
      "--method", "POST",
      "--body", body,
      "--prefer-network", "bsc",
      "--max-payment", MAX_PAYMENT_ATOMIC,
      "--json",
    ],
    { encoding: "utf8", timeout: 90_000, env: process.env },
  );
  const parsed = parseTwakX402(out);
  dataBudget.spentUsd += COST_PER_CALL_USD;
  dataBudget.calls += 1;
  return {
    tool: name,
    args,
    costUsd: COST_PER_CALL_USD,
    payment: parsed.payment ?? null,
    responseHash: sha256(canonical(parsed.result ?? parsed.raw ?? "")),
    result: parsed.result,
  };
}

// The cycle's shopping run. Narratives give the market's story ranking;
// news + technicals are bought only for the strongest candidate so spend
// stays proportional to opportunity.
export function buyScoops(candidateSymbols, dataBudget) {
  const basket = [];
  basket.push(safeCall("trending_crypto_narratives", {}, dataBudget));
  const primary = candidateSymbols[0];
  if (primary) {
    basket.push(safeCall("get_crypto_latest_news", { symbol: primary }, dataBudget));
    basket.push(safeCall("get_crypto_technical_analysis", { symbol: primary }, dataBudget));
  }
  basket.push(safeCall("get_global_crypto_derivatives_metrics", {}, dataBudget));
  return basket.filter(Boolean);
}

function safeCall(name, args, dataBudget) {
  try {
    return callToolPaid(name, args, { dataBudget });
  } catch (error) {
    return { tool: name, error: String(error.message).slice(0, 160) };
  }
}

function parseMcpBody(text) {
  // Streamable-HTTP MCP servers may answer JSON or SSE. Take the last data
  // frame when it is a stream.
  const frames = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  const payload = frames.length > 0 ? frames[frames.length - 1] : text;
  return JSON.parse(payload);
}

function parseTwakX402(out) {
  const start = out.indexOf("{");
  if (start < 0) return { raw: out.slice(0, 300) };
  try {
    const d = JSON.parse(out.slice(start));
    // twak wraps the upstream body; the MCP envelope sits inside. Be
    // tolerant about the exact wrapper shape and surface what we find.
    const bodyText = typeof d.body === "string" ? d.body : null;
    const inner = bodyText ? parseMcpBody(bodyText) : d;
    return { result: inner.result ?? inner, payment: d.payment ?? d.x402 ?? null };
  } catch {
    return { raw: out.slice(0, 300) };
  }
}

export function newDataBudget(capUsd) {
  return { capUsd, spentUsd: 0, calls: 0 };
}
