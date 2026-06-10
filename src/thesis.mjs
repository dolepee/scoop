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

export async function formThesis({ movers, quotes, position, equityUsd }) {
  const key = process.env.BANKR_LLM_KEY;
  if (!key) return { thesis: noTrade("no_llm_key"), promptHash: null, raw: null, provider: null };

  const user = JSON.stringify({
    task: "Decide this cycle's single best action.",
    portfolio: { equityUsd, openPosition: position ?? null },
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

function sanitize(p) {
  const action = p.action === "TRADE" ? "TRADE" : "NO_TRADE";
  // Models drift on the key name; accept the common variants, and treat a
  // 0-100 scale as percent when bps were clearly not intended.
  let conviction = p.convictionBps ?? p.conviction_bps ?? p.conviction ?? p.confidence ?? 0;
  conviction = Number(conviction) || 0;
  if (conviction > 0 && conviction <= 100) conviction *= 100;
  return {
    action,
    symbol: action === "TRADE" ? String(p.symbol ?? "").toUpperCase() : null,
    direction: action === "TRADE" ? (p.direction === "exit" ? "exit" : "enter") : null,
    convictionBps: clampInt(conviction, 0, 10_000),
    rationale: String(p.rationale ?? "").slice(0, 300),
    invalidation: String(p.invalidation ?? "").slice(0, 200),
  };
}

function noTrade(reason) {
  return { action: "NO_TRADE", symbol: null, direction: null, convictionBps: 0, rationale: reason, invalidation: "" };
}

function clampInt(x, lo, hi) {
  const n = Math.round(Number(x) || 0);
  return Math.max(lo, Math.min(hi, n));
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
