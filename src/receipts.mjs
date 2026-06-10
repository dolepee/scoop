// Chained, checksummed cycle receipts. Every cycle writes one receipt that
// links: the data Scoop paid for (x402 payment proof + response hashes), the
// signal summary, the governor's decision with reasons, any execution result
// (tx hash), and the running spend/PnL counters. Each receipt embeds the
// previous receipt's checksum, so the history is tamper-evident, and the
// directory is committed to git, so the repo timestamps every decision
// before the market grades it.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RECEIPTS_DIR = join(process.cwd(), "receipts");

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function latestReceipt() {
  let files = [];
  try {
    files = readdirSync(RECEIPTS_DIR).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  return JSON.parse(readFileSync(join(RECEIPTS_DIR, files[files.length - 1]), "utf8"));
}

export function writeReceipt(body) {
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  const prev = latestReceipt();
  const receipt = {
    version: "scoop.receipt.v1",
    ...body,
    prevChecksum: prev?.checksum ?? null,
  };
  receipt.checksum = sha256(canonical({ ...receipt, checksum: undefined }));
  const stamp = receipt.generatedAt.replace(/[:.]/g, "").replace("T", "-").slice(0, 17);
  const file = join(RECEIPTS_DIR, `${stamp}-${receipt.checksum.slice(0, 10)}.json`);
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, file };
}

export function verifyChain() {
  let files = [];
  try {
    files = readdirSync(RECEIPTS_DIR).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { valid: true, count: 0 };
  }
  let prevChecksum = null;
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(RECEIPTS_DIR, f), "utf8"));
    const expected = sha256(canonical({ ...r, checksum: undefined }));
    if (r.checksum !== expected) return { valid: false, count: files.length, broken: f, why: "checksum_mismatch" };
    if (r.prevChecksum !== prevChecksum) return { valid: false, count: files.length, broken: f, why: "chain_break" };
    prevChecksum = r.checksum;
  }
  return { valid: true, count: files.length, head: prevChecksum };
}
