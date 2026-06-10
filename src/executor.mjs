// TWAK-only execution. Resolves eligible symbols to BSC contract addresses
// via twak search (cached), then quotes and executes swaps with the locally
// stored key. Position bookkeeping lives in state/position.json: Scoop holds
// at most ONE momentum position at a time, parked in USDT otherwise.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_FILE = join(process.cwd(), "state", "token-cache.json");
const POSITION_FILE = join(process.cwd(), "state", "position.json");
export const USDT = { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 };
export const USD1 = { symbol: "USD1", address: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", decimals: 18 };

function twak(args, timeout = 120_000) {
  const out = execFileSync("npx", ["twak", ...args, "--json"], { encoding: "utf8", timeout, env: process.env });
  const startObj = out.indexOf("{");
  const startArr = out.indexOf("[");
  const idx = startArr >= 0 && (startArr < startObj || startObj < 0) ? startArr : startObj;
  if (idx < 0) throw new Error(`twak gave no JSON: ${out.slice(0, 120)}`);
  return JSON.parse(out.slice(idx));
}

export function resolveToken(symbol) {
  const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
  const key = symbol.toUpperCase();
  if (cache[key]) return cache[key];
  const results = twak(["search", symbol]);
  const list = Array.isArray(results) ? results : results.results ?? [];
  const hit = list.find((t) => t.chain === "bsc" && String(t.symbol).toUpperCase() === key);
  if (!hit) throw new Error(`no BSC contract for ${symbol}`);
  const token = { symbol: key, address: hit.address, decimals: hit.decimals ?? 18, name: hit.name };
  cache[key] = token;
  writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
  return token;
}

export function loadPosition() {
  return existsSync(POSITION_FILE) ? JSON.parse(readFileSync(POSITION_FILE, "utf8")) : null;
}

export function savePosition(position) {
  writeFileSync(POSITION_FILE, `${JSON.stringify(position, null, 2)}\n`);
}

export function balanceOf(addressOrNative) {
  const args = ["balance", "--chain", "bsc", "--address", "0x5927a9662588f5609154488111E8ee7f4075513C"];
  if (addressOrNative) args.push("--token", addressOrNative);
  return twak(args);
}

// amount is in source-token units as a string (twak takes human units).
export function swap({ amount, from, to, slippagePct = 1.5 }) {
  const password = process.env.TWAK_WALLET_PASSWORD;
  if (!password) throw new Error("TWAK_WALLET_PASSWORD missing");
  const res = twak([
    "swap", String(amount), from, to,
    "--chain", "bsc",
    "--slippage", String(slippagePct),
    "--password", password,
  ], 240_000);
  if (res.error) throw new Error(`swap failed: ${res.error}`);
  return { txHash: res.hash ?? res.txHash, output: res.output, provider: res.provider ?? null };
}

export function quote({ amount, from, to }) {
  const res = twak(["swap", String(amount), from, to, "--chain", "bsc", "--quote-only"]);
  if (res.error) throw new Error(`quote failed: ${res.error}`);
  return res;
}
