export function evaluateExitGuard({ position, quotes = [], positionUsd = 0 }) {
  if (!position?.symbol || !position?.invalidation) return null;
  const invalidationUsd = parseInvalidationPrice(position.invalidation);
  if (!Number.isFinite(invalidationUsd) || invalidationUsd <= 0) return null;

  const observed = observedPriceUsd({ position, quotes, positionUsd });
  if (!observed || observed.priceUsd > invalidationUsd) return null;

  return {
    action: "FORCE_EXIT",
    symbol: position.symbol,
    direction: "exit",
    reason: "stored_invalidation_price_breached",
    invalidationUsd,
    priceUsd: observed.priceUsd,
    priceSource: observed.source,
    rationale: `${position.symbol} observed price $${formatPrice(observed.priceUsd)} is at or below the stored invalidation level $${formatPrice(invalidationUsd)}.`,
  };
}

export function parseInvalidationPrice(invalidation) {
  const text = String(invalidation ?? "");
  const directional = text.match(/\b(?:below|under|beneath|breaks?\s+below|closes?\s+below|falls?\s+below)\b[^\d$-]*\$?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (directional) return Number(directional[1]);

  const dollar = text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  return dollar ? Number(dollar[1]) : null;
}

function observedPriceUsd({ position, quotes, positionUsd }) {
  const quote = quotes.find((item) => String(item?.symbol ?? "").toUpperCase() === String(position.symbol).toUpperCase());
  const quotePrice = Number(quote?.priceUsd);
  if (Number.isFinite(quotePrice) && quotePrice > 0) return { priceUsd: quotePrice, source: "paid_quote" };

  const units = Number(position.units);
  const value = Number(positionUsd);
  if (Number.isFinite(units) && units > 0 && Number.isFinite(value) && value > 0) {
    return { priceUsd: value / units, source: "wallet_value" };
  }
  return null;
}

function formatPrice(value) {
  return Number(value).toFixed(value >= 1 ? 4 : 8).replace(/0+$/, "").replace(/\.$/, "");
}
