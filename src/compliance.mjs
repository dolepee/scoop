import { isEligible } from "./allowlist.mjs";
import { DEFAULT_CONFIG } from "./governor.mjs";

export const COMPLIANCE_REASON = "daily minimum, no conviction signal today";
export const COMPLIANCE_MIN_AGE_MS = 20 * 60 * 60 * 1000;

export function chooseComplianceAction({ position, thesis, movers, nowMs }) {
  if (isMatureCompliancePosition(position, nowMs)) {
    return { action: "sell", symbol: position.symbol, reason: COMPLIANCE_REASON };
  }
  if (position) return null;

  const thesisSymbol = thesis?.symbol && isEligible(thesis.symbol) ? thesis.symbol : null;
  const moverSymbol = (movers ?? []).find((mover) => isEligible(mover?.symbol))?.symbol ?? null;
  const symbol = thesisSymbol ?? moverSymbol;
  if (!symbol) return null;

  return {
    action: "buy",
    symbol,
    spendUsd: DEFAULT_CONFIG.complianceUsd,
    reason: COMPLIANCE_REASON,
  };
}

export function isMatureCompliancePosition(position, nowMs) {
  if (!position?.complianceTrade || !position.openedAt) return false;
  const openedAtMs = Date.parse(position.openedAt);
  if (!Number.isFinite(openedAtMs)) return false;
  return nowMs - openedAtMs >= COMPLIANCE_MIN_AGE_MS;
}
