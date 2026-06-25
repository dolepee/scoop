export const EXIT_SIGNAL_GUARD_CONFIG = {
  maxQuoteWalletDivergencePct: 35,
};

export function evaluateExitSignalGuard({
  position,
  thesis,
  quotes = [],
  positionUsd = 0,
  config = EXIT_SIGNAL_GUARD_CONFIG,
} = {}) {
  if (!(thesis?.action === "TRADE" && thesis?.direction === "exit")) {
    return { ok: true, reason: "not_an_exit" };
  }
  if (!position?.symbol || !position?.address || Number(position?.units) <= 0) {
    return { ok: false, reason: "no_position_to_exit" };
  }
  const thesisSymbol = String(thesis.symbol ?? "").toUpperCase();
  const positionSymbol = String(position.symbol ?? "").toUpperCase();
  if (thesisSymbol && thesisSymbol !== positionSymbol) {
    return { ok: false, reason: "exit_symbol_mismatch", thesisSymbol, positionSymbol };
  }

  const quote = quotes.find((item) => String(item?.symbol ?? "").toUpperCase() === positionSymbol);
  const quotePrice = Number(quote?.priceUsd);
  const units = Number(position.units);
  const value = Number(positionUsd);
  const walletPrice = Number.isFinite(units) && units > 0 && Number.isFinite(value) && value > 0 ? value / units : null;
  if (Number.isFinite(quotePrice) && quotePrice > 0 && walletPrice) {
    const divergencePct = priceDivergencePct(quotePrice, walletPrice);
    if (divergencePct > config.maxQuoteWalletDivergencePct) {
      return {
        ok: false,
        reason: "exit_quote_wallet_divergence",
        quotePriceUsd: quotePrice,
        walletPriceUsd: walletPrice,
        divergencePct: round2(divergencePct),
      };
    }
  }
  return { ok: true, reason: "trusted_exit_signal" };
}

function priceDivergencePct(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return Infinity;
  return (Math.abs(left - right) / right) * 100;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
