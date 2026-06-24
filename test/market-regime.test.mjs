import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarketRegime, splitMarketContext, withMarketContext } from "../src/market-regime.mjs";

test("market context symbols are added without duplicating trade symbols", () => {
  assert.deepEqual(withMarketContext(["CAKE", "BTC", "AXS"]), ["CAKE", "BTC", "AXS", "BNB"]);
});

test("market context is split away from trade candidates", () => {
  const { marketContext, tradeQuotes } = splitMarketContext([
    { symbol: "CAKE" },
    { symbol: "BTC" },
    { symbol: "BNB" },
  ]);
  assert.deepEqual(tradeQuotes.map((quote) => quote.symbol), ["CAKE"]);
  assert.deepEqual(marketContext.map((quote) => quote.symbol), ["BTC", "BNB"]);
});

test("risk-off regime is detected when BTC and BNB are weak", () => {
  const regime = evaluateMarketRegime({
    marketContext: [
      { symbol: "BTC", priceUsd: 100000, change1h: -0.8, change24h: -2.1 },
      { symbol: "BNB", priceUsd: 900, change1h: -0.6, change24h: -1.4 },
    ],
  });
  assert.equal(regime.riskOff, true);
  assert.equal(regime.state, "risk_off");
  assert.ok(regime.reasons.some((reason) => reason.startsWith("btc_down")));
});

test("neutral regime leaves normal entries available", () => {
  const regime = evaluateMarketRegime({
    marketContext: [
      { symbol: "BTC", priceUsd: 100000, change1h: 0.1, change24h: -0.2 },
      { symbol: "BNB", priceUsd: 900, change1h: 0.2, change24h: 0.4 },
    ],
  });
  assert.equal(regime.riskOff, false);
  assert.equal(regime.state, "neutral");
});
