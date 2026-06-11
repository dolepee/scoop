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
    dataSpendUsd: num(r.perception?.dataSpendUsd),
    trade: bool(modes.trade),
    tradeResult: tradeSummary(r),
  };
}

const rows = readReceipts();
const cyclesChronological = rows.map(cycle);
const cycles = [...cyclesChronological].reverse();
const first = cyclesChronological[0] ?? null;
const latest = cyclesChronological[cyclesChronological.length - 1] ?? null;

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
  },
  cycles,
};

mkdirSync(join(ROOT, "web", "public", "data"), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(feed, null, 2)}\n`);
console.log(
  `SCOOP_FEED_BUILT cycles=${feed.summary.cycleCount} chainOk=${feed.summary.chainOk} out=${OUT_FILE}`,
);
