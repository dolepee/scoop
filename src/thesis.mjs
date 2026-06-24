// The thesis layer. A cheap structured-output model turns the scout's paid
// observations into at most ONE proposal per cycle. The model never holds
// authority: whatever it returns goes through the deterministic governor,
// and the full prompt + raw response are hashed into the receipt.

const BANKR_URL = "https://llm.bankr.bot/v1/chat/completions";
const MODEL = process.env.SCOOP_LLM_MODEL ?? "deepseek-v3.2";

const SYSTEM = [
  "You are Scoop, a disciplined crypto trading analyst in a one-week BSC spot contest.",
  "Rules you must respect:",
  "- Long-only spot. Universe = the eligible symbols provided. Parking asset is USDT.",
  "- Default is NO_TRADE. Propose a trade only on clear momentum or story strength with volume support.",
  "- Output STRICT JSON, nothing else: {\"action\":\"TRADE\"|\"NO_TRADE\",\"symbol\":string|null,\"direction\":\"enter\"|\"exit\"|null,\"convictionBps\":number,\"rationale\":string,\"invalidation\":string}",
  "- convictionBps: an INTEGER from 0 to 10000 (basis points of confidence). Never negative, never null. 5500 is the execution floor: if your honest conviction is below 5500, set action to NO_TRADE instead of inventing a number. A strong setup is 6500-8500; reserve >9000 for exceptional confluence.",
  "- rationale: one sentence, cite the specific numbers that convinced you.",
  "- invalidation: the concrete condition that would make this wrong (price level or signal reversal).",
].join("\n");

export async function formThesis({ movers, quotes, marketContext = [], marketRegime = null, position, equityUsd }) {
  const key = process.env.BANKR_LLM_KEY;
  if (!key) return { thesis: noTrade("no_llm_key"), promptHash: null, raw: null, provider: null };

  const user = JSON.stringify({
    task: "Decide this cycle's single best action.",
    portfolio: { equityUsd, openPosition: position ?? null },
    marketContext,
    marketRegime,
    eligibleMoversTop: movers.slice(0, 12),
    shortlistQuotes: quotes,
  });

  const body = {
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
  };

  const res = await fetch(BANKR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    return { thesis: noTrade(`llm_http_${res.status}`), promptHash: hashOf(user), raw: null, provider: `bankr:${MODEL}` };
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
  } catch {
    return { thesis: noTrade("llm_unparseable"), promptHash: hashOf(user), raw: text.slice(0, 400), provider: `bankr:${MODEL}` };
  }
  const thesis = sanitize(parsed);
  return { thesis, promptHash: hashOf(user), raw: text.slice(0, 1200), provider: `bankr:${MODEL}` };
}

export function sanitize(p) {
  let action = p.action === "TRADE" ? "TRADE" : "NO_TRADE";
  // Models drift on the key name; accept the common variants, and treat a
  // 0-100 scale as percent when bps were clearly not intended.
  let conviction = p.convictionBps ?? p.conviction_bps ?? p.conviction ?? p.confidence ?? 0;
  conviction = Number(conviction) || 0;
  if (conviction > 0 && conviction <= 100) conviction *= 100;
  const convictionBps = clampInt(conviction, 0, 10_000);
  if (action === "TRADE" && convictionBps < 5_500) action = "NO_TRADE";
  return {
    action,
    symbol: action === "TRADE" ? String(p.symbol ?? "").toUpperCase() : null,
    direction: action === "TRADE" ? (p.direction === "exit" ? "exit" : "enter") : null,
    convictionBps,
    rationale: String(p.rationale ?? "").slice(0, 300),
    invalidation: String(p.invalidation ?? "").slice(0, 200),
  };
}

export function momentumFallbackThesis({ movers = [], quotes = [] }) {
  const quoteBySymbol = new Map(quotes.map((q) => [String(q.symbol ?? "").toUpperCase(), q]));
  const candidates = movers
    .slice(0, 10)
    .map((mover) => {
      const symbol = String(mover.symbol ?? "").toUpperCase();
      const quote = quoteBySymbol.get(symbol) ?? {};
      const priceUsd = Number(quote.priceUsd ?? mover.priceUsd);
      const change1h = Number(quote.change1h ?? mover.change1h);
      const change24h = Number(quote.change24h ?? mover.change24h);
      const change7d = Number(quote.change7d ?? mover.change7d);
      const volume24h = Number(quote.volume24h ?? mover.volume24h);
      const volumeChange24h = Number(quote.volumeChange24h ?? 0);
      const heat = Number(mover.heat ?? (change1h * 3 + change24h + change7d * 0.15));
      const overextensionPenalty = Math.max(0, change24h - 45) * 0.45;
      const score = change1h * 5 + change24h * 0.45 + Math.max(0, volumeChange24h) * 0.035 + heat * 0.15 - overextensionPenalty;
      return { symbol, priceUsd, change1h, change24h, change7d, volume24h, volumeChange24h, score };
    })
    .filter((c) =>
      c.symbol &&
      Number.isFinite(c.priceUsd) && c.priceUsd > 0 &&
      Number.isFinite(c.change1h) && c.change1h >= 0.35 &&
      Number.isFinite(c.change24h) && c.change24h >= 3 &&
      Number.isFinite(c.volume24h) && c.volume24h >= 5_000_000,
    )
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 4) return null;
  const convictionBps = clampInt(5600 + best.score * 80, 5600, 7600);
  const invalidation = best.priceUsd * 0.94;
  return {
    action: "TRADE",
    symbol: best.symbol,
    direction: "enter",
    convictionBps,
    rationale: `Deterministic momentum fallback: ${best.symbol} has ${fmt(best.change1h)}% 1h, ${fmt(best.change24h)}% 24h, and $${fmt(best.volume24h / 1_000_000)}M volume while no LLM setup cleared.`,
    invalidation: `Exit if ${best.symbol} trades below $${formatPrice(invalidation)} or 1h momentum turns negative.`,
    fallback: "deterministic_momentum",
  };
}

function noTrade(reason) {
  return { action: "NO_TRADE", symbol: null, direction: null, convictionBps: 0, rationale: reason, invalidation: "" };
}

function clampInt(x, lo, hi) {
  const n = Math.round(Number(x) || 0);
  return Math.max(lo, Math.min(hi, n));
}

function fmt(value) {
  return Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPrice(value) {
  return Number(value).toFixed(value >= 1 ? 4 : 8).replace(/0+$/, "").replace(/\.$/, "");
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashOf(text) {
  // Synchronous convenience wrapper is overkill; receipts hash the full
  // perception separately. Store a short stable marker here.
  return `len:${text.length}`;
}
export { sha256Hex };
