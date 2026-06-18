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
  EXACT_SYMBOL.set(symbol, addUniqueByAddress(EXACT_SYMBOL.get(symbol) ?? [], token));
  UPPER_SYMBOL.set(upper, addUniqueByAddress(UPPER_SYMBOL.get(upper) ?? [], token));
  ADDRESS_SET.add(normalizeAddress(token.address));
}

export function getEligibleToken(symbol) {
  const normalized = normalizeSymbol(symbol);
  const matches = UPPER_SYMBOL.get(normalized.toUpperCase()) ?? [];
  if (matches.length !== 1) return null;
  const exact = EXACT_SYMBOL.get(normalized) ?? [];
  if (exact.length > 1) return null;
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

function addUniqueByAddress(tokens, token) {
  const address = normalizeAddress(token.address);
  return tokens.some((item) => normalizeAddress(item.address) === address)
    ? tokens
    : [...tokens, token];
}
