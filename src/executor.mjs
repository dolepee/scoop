// TWAK-only execution. Tradeable symbols resolve only from the committed
// eligible-token data file; no runtime token search is allowed. Position
// bookkeeping lives in state/position.json: Scoop holds at most ONE momentum
// position at a time, parked in USDT otherwise.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEligibleToken } from "./allowlist.mjs";

const POSITION_FILE = join(process.cwd(), "state", "position.json");
export const USDT = requireEligibleToken("USDT");
export const USD1 = requireEligibleToken("USD1");

function twak(args, timeout = 120_000) {
  const fullArgs = ["twak", ...args, "--json"];
  const res = spawnSync("npx", fullArgs, { encoding: "utf8", timeout, env: process.env });
  const out = res.stdout ?? "";
  if (res.status !== 0) {
    const detail = sanitizeTwakError(`${res.stderr ?? ""}\n${out}`.trim() || `exit_${res.status}`);
    throw new Error(`twak failed: ${detail}`);
  }
  const startObj = out.indexOf("{");
  const startArr = out.indexOf("[");
  const idx = startArr >= 0 && (startArr < startObj || startObj < 0) ? startArr : startObj;
  if (idx < 0) throw new Error(`twak gave no JSON: ${out.slice(0, 120)}`);
  return JSON.parse(out.slice(idx));
}

export function resolveToken(symbol) {
  return requireEligibleToken(symbol);
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

function requireEligibleToken(symbol) {
  const token = getEligibleToken(symbol);
  if (!token?.address) throw new Error(`token_not_eligible:${symbol}`);
  return {
    symbol: token.symbol,
    address: token.address,
    decimals: token.decimals ?? 18,
    name: token.name ?? token.symbol,
  };
}

function sanitizeTwakError(message) {
  const password = process.env.TWAK_WALLET_PASSWORD;
  let text = String(message ?? "");
  if (password) text = text.split(password).join("[redacted]");
  text = text.replace(/--password\s+\S+/g, "--password [redacted]");
  return text.slice(0, 500);
}
