import { parseInvalidationPrice } from "./exit-guard.mjs";

export const ENTRY_GUARD_CONFIG = {
  minStopDistancePct: 2,
  maxStopDistancePct: 8,
  recoveryMaxStopDistancePct: 5,
  recoveryMinConvictionBps: 6200,
  recoveryMinChange1hPct: 0.5,
  recoveryMinChange24hPct: 4,
  recoveryMinVolume24h: 10_000_000,
  recoveryTakeProfitPct: 12,
  recoveryMinRewardRisk: 2.5,
};

export function evaluateEntryGuard({ thesis, quotes = [], movers = [], recoveryMode = false, config = ENTRY_GUARD_CONFIG }) {
  if (thesis?.action !== "TRADE" || thesis?.direction !== "enter") {
    return { ok: true, reason: "not_an_entry" };
  }

  const symbol = String(thesis.symbol ?? "").toUpperCase();
  const observed = observedEntryMarket({ symbol, quotes, movers });
  if (!observed?.priceUsd) {
    return block("entry_price_unavailable", { symbol });
  }

  const stopUsd = parseInvalidationPrice(thesis.invalidation);
  if (!Number.isFinite(stopUsd) || stopUsd <= 0) {
    return block("entry_stop_unparseable", { symbol, entryPriceUsd: observed.priceUsd });
  }

  if (stopUsd >= observed.priceUsd) {
    return block("invalid_long_stop_not_below_entry", {
      symbol,
      entryPriceUsd: observed.priceUsd,
      stopUsd,
    });
  }

  const stopDistancePct = ((observed.priceUsd - stopUsd) / observed.priceUsd) * 100;
  if (stopDistancePct < config.minStopDistancePct) {
    return block("entry_stop_too_tight", {
      symbol,
      entryPriceUsd: observed.priceUsd,
      stopUsd,
      stopDistancePct,
    });
  }
  if (stopDistancePct > config.maxStopDistancePct) {
    return block("entry_stop_too_wide", {
      symbol,
      entryPriceUsd: observed.priceUsd,
      stopUsd,
      stopDistancePct,
    });
  }

  if (recoveryMode) {
    if ((thesis.convictionBps ?? 0) < config.recoveryMinConvictionBps) {
      return block("recovery_conviction_below_floor", {
        symbol,
        convictionBps: thesis.convictionBps ?? 0,
        requiredBps: config.recoveryMinConvictionBps,
      });
    }
    if (stopDistancePct > config.recoveryMaxStopDistancePct) {
      return block("recovery_stop_too_wide_for_2r", {
        symbol,
        stopDistancePct,
        maxStopDistancePct: config.recoveryMaxStopDistancePct,
      });
    }
    const rewardRisk = config.recoveryTakeProfitPct / stopDistancePct;
    if (rewardRisk < config.recoveryMinRewardRisk) {
      return block("recovery_reward_risk_below_floor", {
        symbol,
        stopDistancePct,
        takeProfitPct: config.recoveryTakeProfitPct,
        requiredRewardRisk: config.recoveryMinRewardRisk,
        rewardRisk,
      });
    }
    if ((observed.change1h ?? -Infinity) < config.recoveryMinChange1hPct) {
      return block("recovery_1h_momentum_too_weak", {
        symbol,
        change1h: observed.change1h ?? null,
        requiredPct: config.recoveryMinChange1hPct,
      });
    }
    if ((observed.change24h ?? -Infinity) < config.recoveryMinChange24hPct) {
      return block("recovery_24h_momentum_too_weak", {
        symbol,
        change24h: observed.change24h ?? null,
        requiredPct: config.recoveryMinChange24hPct,
      });
    }
    if ((observed.volume24h ?? 0) < config.recoveryMinVolume24h) {
      return block("recovery_volume_too_thin", {
        symbol,
        volume24h: observed.volume24h ?? null,
        requiredUsd: config.recoveryMinVolume24h,
      });
    }
  }

  return {
    ok: true,
    symbol,
    entryPriceUsd: observed.priceUsd,
    stopUsd,
    stopDistancePct,
    recoveryMode,
    source: observed.source,
  };
}

export function observedEntryMarket({ symbol, quotes = [], movers = [] }) {
  const wanted = String(symbol ?? "").toUpperCase();
  const quote = quotes.find((item) => String(item?.symbol ?? "").toUpperCase() === wanted);
  const mover = movers.find((item) => String(item?.symbol ?? "").toUpperCase() === wanted);
  const merged = { ...(mover ?? {}), ...(quote ?? {}) };
  const priceUsd = Number(merged.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return {
    symbol: wanted,
    priceUsd,
    change1h: finiteOrNull(merged.change1h),
    change24h: finiteOrNull(merged.change24h),
    change7d: finiteOrNull(merged.change7d),
    volume24h: finiteOrNull(merged.volume24h),
    source: quote ? "paid_quote" : "movers_board",
  };
}

function block(reason, details = {}) {
  return { ok: false, reason, ...details };
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
