export const MARKET_CONTEXT_SYMBOLS = ["BTC", "BNB"];

export const MARKET_REGIME_CONFIG = {
  btcRiskOff1hPct: -0.35,
  btcRiskOff24hPct: -1,
  bnbRiskOff1hPct: -0.25,
  bnbRiskOff24hPct: -1,
};

export function splitMarketContext(quotes = []) {
  const contextSet = new Set(MARKET_CONTEXT_SYMBOLS);
  const marketContext = [];
  const tradeQuotes = [];
  for (const quote of quotes) {
    const symbol = String(quote?.symbol ?? "").toUpperCase();
    if (contextSet.has(symbol)) marketContext.push(quote);
    else tradeQuotes.push(quote);
  }
  return { marketContext, tradeQuotes };
}

export function withMarketContext(symbols = []) {
  return [...new Set([...symbols, ...MARKET_CONTEXT_SYMBOLS].map((symbol) => String(symbol).toUpperCase()).filter(Boolean))];
}

export function evaluateMarketRegime({ marketContext = [], config = MARKET_REGIME_CONFIG } = {}) {
  const btc = findQuote(marketContext, "BTC");
  const bnb = findQuote(marketContext, "BNB");
  const btcRiskOff = isRiskOffQuote(btc, config.btcRiskOff1hPct, config.btcRiskOff24hPct);
  const bnbRiskOff = isRiskOffQuote(bnb, config.bnbRiskOff1hPct, config.bnbRiskOff24hPct);
  const riskOff = btcRiskOff || bnbRiskOff;
  return {
    state: riskOff ? "risk_off" : "neutral",
    riskOff,
    reasons: [
      ...(btcRiskOff ? [`btc_down:${fmt(btc.change1h)}h1/${fmt(btc.change24h)}d1`] : []),
      ...(bnbRiskOff ? [`bnb_down:${fmt(bnb.change1h)}h1/${fmt(bnb.change24h)}d1`] : []),
      ...(!btc && !bnb ? ["market_context_unavailable"] : []),
    ],
    btc: compactQuote(btc),
    bnb: compactQuote(bnb),
  };
}

function findQuote(quotes, symbol) {
  return quotes.find((quote) => String(quote?.symbol ?? "").toUpperCase() === symbol) ?? null;
}

function isRiskOffQuote(quote, min1h, min24h) {
  if (!quote) return false;
  const change1h = Number(quote.change1h);
  const change24h = Number(quote.change24h);
  return Number.isFinite(change1h) && Number.isFinite(change24h) && change1h <= min1h && change24h <= min24h;
}

function compactQuote(quote) {
  if (!quote) return null;
  return {
    symbol: String(quote.symbol ?? "").toUpperCase(),
    priceUsd: finiteOrNull(quote.priceUsd),
    change1h: finiteOrNull(quote.change1h),
    change24h: finiteOrNull(quote.change24h),
    change7d: finiteOrNull(quote.change7d),
  };
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value) {
  return Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
