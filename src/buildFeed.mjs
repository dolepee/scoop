import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const RECEIPTS_DIR = join(ROOT, "receipts");
const OUT_FILE = join(ROOT, "web", "public", "data", "feed.json");

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bool(value) {
  return typeof value === "boolean" ? value : Boolean(value);
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function readReceipts() {
  let files = [];
  try {
    files = readdirSync(RECEIPTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
  return files.map((file) => ({
    file,
    receipt: JSON.parse(readFileSync(join(RECEIPTS_DIR, file), "utf8")),
  }));
}

function chainOk(rows) {
  let prev = null;
  for (const { receipt } of rows) {
    if ((receipt.prevChecksum ?? null) !== prev) return false;
    prev = receipt.checksum ?? null;
  }
  return true;
}

function tradeSummary(receipt) {
  const execution = receipt.execution ?? {};
  if (!execution.executed) return null;
  return {
    executed: true,
    kind: execution.kind ?? null,
    txHash: execution.txHash ?? null,
    spentUsd: num(execution.spentUsd ?? execution.usd),
    units: num(execution.units ?? execution.closedUnits),
    error: str(execution.error),
  };
}

function positionSummary(position) {
  if (!position || typeof position !== "object") return null;
  return {
    symbol: str(position.symbol),
    address: str(position.address),
    units: num(position.units),
    entryPrice: num(position.entryPrice),
    costUsd: num(position.costUsd),
    openedAt: str(position.openedAt),
    complianceTrade: bool(position.complianceTrade),
    complianceReason: str(position.complianceReason),
  };
}

function paidCallSummary(call) {
  if (!call || typeof call !== "object") return null;
  return {
    url: str(call.url),
    costUsd: num(call.costUsd),
    dataSource: str(call.dataSource),
    fallbackFrom: str(call.fallbackFrom),
    responseHash: str(call.responseHash),
    skipped: str(call.skipped),
  };
}

function cycle(row) {
  const r = row.receipt;
  const counters = r.counters ?? {};
  const thesis = r.thesis ?? {};
  const governor = r.governor ?? {};
  const ruling = governor.ruling ?? {};
  const modes = r.modes ?? {};
  const position = r.position ?? null;
  const paidCalls = r.perception?.paidCalls ?? [];
  const action = thesis.action ?? (r.execution?.executed ? "TRADE" : "NO_TRADE");
  const reasons = Array.isArray(ruling.reasons) ? ruling.reasons : [];
  return {
    at: r.generatedAt ?? null,
    file: row.file,
    checksum: r.checksum ?? null,
    prevChecksum: r.prevChecksum ?? null,
    equityUsd: num(counters.equityUsd),
    usdtUsd: num(counters.usdtUsd),
    usd1Usd: num(counters.usd1Usd),
    positionUsd: num(counters.positionUsd),
    inScopeUsd: num(counters.inScopeUsd),
    inScopeWarning: bool(counters.inScopeWarning),
    floorUsd: num(counters.floorUsd ?? governor.state?.floorUsd),
    degraded: bool(counters.degraded),
    action,
    symbol: thesis.symbol ?? ruling.symbol ?? position?.symbol ?? null,
    direction: thesis.direction ?? null,
    convictionBps: num(thesis.convictionBps),
    provider: thesis.provider ?? null,
    rationale: thesis.rationale ?? null,
    invalidation: thesis.invalidation ?? null,
    governorVerdict: ruling.decision ?? null,
    governorReason: reasons.join(", ") || null,
    paid: bool(modes.paid) || paidCalls.length > 0,
    paidCallCount: paidCalls.length,
    paidCalls: paidCalls.map(paidCallSummary).filter(Boolean),
    dataSpendUsd: num(r.perception?.dataSpendUsd),
    trade: bool(modes.trade),
    tradeResult: tradeSummary(r),
    position: positionSummary(position),
  };
}

const rows = readReceipts();
const cyclesChronological = rows.map(cycle);
const cycles = [...cyclesChronological].reverse();
const first = cyclesChronological[0] ?? null;
const latest = cyclesChronological[cyclesChronological.length - 1] ?? null;
const totalDataSpendUsd = cyclesChronological.reduce((sum, item) => sum + (item.dataSpendUsd ?? 0), 0);

const feed = {
  generatedAt: latest?.at ?? null,
  summary: {
    cycleCount: cyclesChronological.length,
    firstAt: first?.at ?? null,
    lastAt: latest?.at ?? null,
    equityNow: latest?.equityUsd ?? null,
    floorUsd: latest?.floorUsd ?? null,
    equityStart: first?.equityUsd ?? null,
    chainOk: chainOk(rows),
    wallet: rows[rows.length - 1]?.receipt?.wallet ?? null,
    chain: rows[rows.length - 1]?.receipt?.chain ?? null,
    paidCycles: cyclesChronological.filter((item) => item.paid).length,
    x402PaidCycles: cyclesChronological.filter((item) =>
      item.paidCalls.some((call) => call.dataSource === "x402-paid"),
    ).length,
    totalDataSpendUsd: round(totalDataSpendUsd, 4),
    tradeTheses: cyclesChronological.filter((item) => item.action === "TRADE").length,
    armedCycles: cyclesChronological.filter((item) => item.trade).length,
    executedTrades: cyclesChronological.filter((item) => item.tradeResult?.executed).length,
    degradedCycles: cyclesChronological.filter((item) => item.degraded).length,
  },
  cycles,
};

mkdirSync(join(ROOT, "web", "public", "data"), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(feed, null, 2)}\n`);
console.log(
  `SCOOP_FEED_BUILT cycles=${feed.summary.cycleCount} chainOk=${feed.summary.chainOk} out=${OUT_FILE}`,
);
