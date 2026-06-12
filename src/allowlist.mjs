// Fail-closed competition universe. The symbols come from the official
// 149-entry brief; execution eligibility requires a committed BSC address.

import { readFileSync } from "node:fs";

export const ELIGIBLE_DATA = JSON.parse(
  readFileSync(new URL("../data/eligible_tokens.json", import.meta.url), "utf8"),
);

export const ELIGIBLE_TOKENS = Object.freeze(ELIGIBLE_DATA.tokens ?? []);

const EXACT_SYMBOL = new Map();
const UPPER_SYMBOL = new Map();
const ADDRESS_SET = new Set();

for (const token of ELIGIBLE_TOKENS) {
  if (!token?.tradable || !token.address) continue;
  const symbol = normalizeSymbol(token.symbol);
  const upper = symbol.toUpperCase();
  EXACT_SYMBOL.set(symbol, token);
  UPPER_SYMBOL.set(upper, [...(UPPER_SYMBOL.get(upper) ?? []), token]);
  ADDRESS_SET.add(normalizeAddress(token.address));
}

export function getEligibleToken(symbol) {
  const exact = EXACT_SYMBOL.get(normalizeSymbol(symbol));
  if (exact) return exact;
  const matches = UPPER_SYMBOL.get(normalizeSymbol(symbol).toUpperCase()) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export function isEligible(symbol, address = null) {
  if (address) return isEligibleAddress(address);
  return Boolean(getEligibleToken(symbol));
}

export function isEligibleAddress(address) {
  return ADDRESS_SET.has(normalizeAddress(address));
}

export function eligibleSymbols() {
  return [...new Set([...EXACT_SYMBOL.keys()])];
}

export const PARKING_STABLES = ["USDT", "USDC", "USD1"].filter((symbol) => isEligible(symbol));

function normalizeSymbol(symbol) {
  return String(symbol ?? "").trim();
}

function normalizeAddress(address) {
  return String(address ?? "").trim().toLowerCase();
}
