export function evaluateExitGuard({ position, quotes = [], positionUsd = 0, minUsefulPositionUsd = 0 }) {
  if (!position?.symbol || !position?.invalidation) return null;
  const invalidationUsd = parseInvalidationPrice(position.invalidation);
  if (!Number.isFinite(invalidationUsd) || invalidationUsd <= 0) return null;

  const observed = observedPriceUsd({ position, quotes, positionUsd });
  if (!observed) return null;

  const usefulFloor = Number(minUsefulPositionUsd);
  const liveValue = Number(positionUsd);
  if (Number.isFinite(usefulFloor) && usefulFloor > 0 && Number.isFinite(liveValue) && liveValue > 0 && liveValue < usefulFloor) {
    return exit(position, "position_below_live_trade_min", invalidationUsd, observed, `${position.symbol} live value is $${formatPrice(liveValue)}, below the $${formatPrice(usefulFloor)} minimum useful trade size; closing it so the agent can redeploy capital on the next qualified setup.`);
  }

  if (observed.priceUsd <= invalidationUsd) {
    return exit(position, "stored_invalidation_price_breached", invalidationUsd, observed, `${position.symbol} observed price $${formatPrice(observed.priceUsd)} is at or below the stored invalidation level $${formatPrice(invalidationUsd)}.`);
  }

  const entryPrice = Number(position.entryPrice);
  const change1h = Number(observed.change1h);
  if (Number.isFinite(entryPrice) && entryPrice > 0 && observed.source === "paid_quote") {
    const openReturnPct = ((observed.priceUsd - entryPrice) / entryPrice) * 100;
    if (openReturnPct <= -3 || (openReturnPct < 0 && Number.isFinite(change1h) && change1h <= -2.5)) {
      return exit(position, "position_momentum_faded", invalidationUsd, observed, `${position.symbol} is down ${formatPct(openReturnPct)} from entry and the paid quote shows ${formatPct(change1h)} over 1h; exiting before the hard invalidation is hit.`);
    }
  }

  return null;
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
  if (Number.isFinite(quotePrice) && quotePrice > 0) return { priceUsd: quotePrice, change1h: Number(quote?.change1h), source: "paid_quote" };

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

function formatPct(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function exit(position, reason, invalidationUsd, observed, rationale) {
  return {
    action: "FORCE_EXIT",
    symbol: position.symbol,
    direction: "exit",
    reason,
    invalidationUsd,
    priceUsd: observed.priceUsd,
    priceSource: observed.source,
    rationale,
  };
}
