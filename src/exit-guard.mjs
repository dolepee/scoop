export const EXIT_GUARD_CONFIG = {
  hardStopLossPct: -5,
  takeProfitPct: 10,
  breakevenArmPct: 3,
  breakevenFloorPct: 0.4,
  earlyTrailArmPct: 3,
  earlyTrailGivebackPct: 1.5,
  trailArmPct: 5,
  trailGivebackPct: 2.5,
  endgameTakeProfitPct: 10,
  endgameTrailArmPct: 5,
  endgameTrailGivebackPct: 2.5,
  greenMomentumFade1hPct: -1,
  dustExitFractionOfMinUseful: 0.5,
  maxQuoteWalletDivergencePct: 35,
};

export function evaluateExitGuard({ position, quotes = [], positionUsd = 0, minUsefulPositionUsd = 0, config = EXIT_GUARD_CONFIG }) {
  if (!position?.symbol) return null;
  const invalidationUsd = parseInvalidationPrice(position.invalidation);
  const hasInvalidation = Number.isFinite(invalidationUsd) && invalidationUsd > 0;
  if (!hasInvalidation && !position.complianceTrade) return null;

  const observed = observedPriceUsd({ position, quotes, positionUsd });
  if (!observed) return null;

  const usefulFloor = Number(minUsefulPositionUsd);
  const liveValue = Number(positionUsd);
  const dustFloor = usefulFloor * config.dustExitFractionOfMinUseful;
  if (Number.isFinite(usefulFloor) && usefulFloor > 0 && Number.isFinite(liveValue) && liveValue > 0 && liveValue < dustFloor) {
    return exit(position, "position_below_live_trade_min", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} live value is $${formatPrice(liveValue)}, below the $${formatPrice(usefulFloor)} minimum useful trade size; closing it so the agent can redeploy capital on the next qualified setup.`);
  }

  const entryPrice = Number(position.entryPrice);
  const change1h = Number(observed.change1h);
  if (Number.isFinite(entryPrice) && entryPrice > 0 && observed.source === "paid_quote") {
    const openReturnPct = ((observed.priceUsd - entryPrice) / entryPrice) * 100;
    const takeProfitPct = position.endgameComeback ? config.endgameTakeProfitPct : config.takeProfitPct;
    if (Number.isFinite(takeProfitPct) && takeProfitPct > 0 && openReturnPct >= takeProfitPct) {
      return exit(position, "take_profit_target_hit", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} is up ${formatPct(openReturnPct)} from entry, meeting the ${formatPct(takeProfitPct)} profit-capture target.`);
    }

    const peakPrice = Number(position.peakPriceUsd);
    const peakTrusted = isTrustedPeak(position, observed, config);
    if (peakTrusted && Number.isFinite(peakPrice) && peakPrice > entryPrice) {
      const peakReturnPct = ((peakPrice - entryPrice) / entryPrice) * 100;
      const drawdownFromPeakPct = ((observed.priceUsd - peakPrice) / peakPrice) * 100;
      if (!position.endgameComeback && peakReturnPct >= config.earlyTrailArmPct && peakReturnPct < config.trailArmPct && drawdownFromPeakPct <= -config.earlyTrailGivebackPct) {
        return exit(position, "early_profit_trail", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} was up ${formatPct(peakReturnPct)} from entry and has already given back ${formatPct(Math.abs(drawdownFromPeakPct))}; closing before a small win round-trips.`);
      }
      if (position.endgameComeback && peakReturnPct >= config.endgameTrailArmPct && drawdownFromPeakPct <= -config.endgameTrailGivebackPct) {
        return exit(position, "endgame_profit_trail", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} was up ${formatPct(peakReturnPct)} from entry in endgame mode and has given back ${formatPct(Math.abs(drawdownFromPeakPct))}; closing before a leaderboard win round-trips.`);
      }
      if (!position.endgameComeback && peakReturnPct >= config.breakevenArmPct && openReturnPct <= config.breakevenFloorPct) {
        return exit(position, "breakeven_profit_protection", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} was up ${formatPct(peakReturnPct)} from entry and has faded back to ${formatPct(openReturnPct)}; closing near breakeven before a green trade turns into a loss.`);
      }
      if (!position.endgameComeback && peakReturnPct >= config.trailArmPct && drawdownFromPeakPct <= -config.trailGivebackPct) {
        return exit(position, "trailing_profit_protection", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} armed a trailing exit after ${formatPct(peakReturnPct)} open profit and has given back ${formatPct(Math.abs(drawdownFromPeakPct))} from the peak.`);
      }
    }

    if (openReturnPct >= config.trailArmPct && Number.isFinite(change1h) && change1h <= config.greenMomentumFade1hPct) {
      return exit(position, "green_momentum_rolled_over", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} is up ${formatPct(openReturnPct)} from entry but paid quote momentum rolled to ${formatPct(change1h)} over 1h.`);
    }

    if (openReturnPct <= config.hardStopLossPct) {
      return exit(position, "hard_stop_loss", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} is down ${formatPct(openReturnPct)} from entry, hitting the hard ${formatPct(config.hardStopLossPct)} loss limit.`);
    }

    if (openReturnPct <= -3 || (openReturnPct < 0 && Number.isFinite(change1h) && change1h <= -2.5)) {
      return exit(position, "position_momentum_faded", invalidationUsdForReceipt(invalidationUsd), observed, `${position.symbol} is down ${formatPct(openReturnPct)} from entry and the paid quote shows ${formatPct(change1h)} over 1h; exiting before the hard invalidation is hit.`);
    }
  }

  if (hasInvalidation && observed.priceUsd <= invalidationUsd) {
    return exit(position, "stored_invalidation_price_breached", invalidationUsd, observed, `${position.symbol} observed price $${formatPrice(observed.priceUsd)} is at or below the stored invalidation level $${formatPrice(invalidationUsd)}.`);
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

function observedPriceUsd({ position, quotes, positionUsd, config = EXIT_GUARD_CONFIG }) {
  const quote = quotes.find((item) => String(item?.symbol ?? "").toUpperCase() === String(position.symbol).toUpperCase());
  const quotePrice = Number(quote?.priceUsd);
  const units = Number(position.units);
  const value = Number(positionUsd);
  const walletPrice = Number.isFinite(units) && units > 0 && Number.isFinite(value) && value > 0 ? value / units : null;
  if (Number.isFinite(quotePrice) && quotePrice > 0) {
    if (!walletPrice || priceDivergencePct(quotePrice, walletPrice) <= config.maxQuoteWalletDivergencePct) {
      return { priceUsd: quotePrice, change1h: Number(quote?.change1h), source: "paid_quote" };
    }
    return {
      priceUsd: walletPrice,
      change1h: null,
      source: "wallet_value",
      rejectedQuotePriceUsd: quotePrice,
      quoteDivergencePct: priceDivergencePct(quotePrice, walletPrice),
    };
  }
  if (Number.isFinite(units) && units > 0 && Number.isFinite(value) && value > 0) {
    return { priceUsd: value / units, source: "wallet_value" };
  }
  return null;
}

function isTrustedPeak(position, observed, config) {
  const peakPrice = Number(position.peakPriceUsd);
  if (!Number.isFinite(peakPrice) || peakPrice <= 0) return false;
  if (observed.source !== "wallet_value" || position.peakPriceSource !== "paid_quote") return true;
  return priceDivergencePct(peakPrice, observed.priceUsd) <= config.maxQuoteWalletDivergencePct;
}

function priceDivergencePct(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return Infinity;
  return (Math.abs(left - right) / right) * 100;
}

function formatPrice(value) {
  return Number(value).toFixed(value >= 1 ? 4 : 8).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPct(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function invalidationUsdForReceipt(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
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
