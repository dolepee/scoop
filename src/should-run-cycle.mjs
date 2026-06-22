import { appendFileSync } from "node:fs";
import { latestReceipt } from "./receipts.mjs";

const eventName = process.env.GITHUB_EVENT_NAME || process.env.GITHUB_EVENT_NAME_FALLBACK || "";
const minIntervalMinutes = Number(process.env.SCOOP_MIN_RUN_INTERVAL_MINUTES ?? 50);
const outputPath = process.env.GITHUB_OUTPUT;

function setOutput(key, value) {
  if (outputPath) appendFileSync(outputPath, `${key}=${value}\n`);
}

function allow(reason) {
  setOutput("should_run", "true");
  setOutput("reason", reason);
  console.log(`SCOOP_SCHEDULE_GUARD allow reason=${reason}`);
}

function skip(reason, ageMinutes) {
  setOutput("should_run", "false");
  setOutput("reason", reason);
  if (ageMinutes !== undefined) setOutput("age_minutes", String(ageMinutes));
  console.log(`SCOOP_SCHEDULE_GUARD skip reason=${reason}${ageMinutes !== undefined ? ` age_minutes=${ageMinutes}` : ""}`);
}

if (eventName !== "schedule") {
  allow(`event:${eventName || "manual"}`);
  process.exit(0);
}

const latest = latestReceipt();
if (!latest?.generatedAt) {
  allow("no_receipt_head");
  process.exit(0);
}

const lastMs = Date.parse(latest.generatedAt);
if (!Number.isFinite(lastMs)) {
  allow("invalid_receipt_time");
  process.exit(0);
}

const ageMinutes = Math.floor((Date.now() - lastMs) / 60_000);
if (ageMinutes >= minIntervalMinutes) {
  allow(`receipt_age:${ageMinutes}m`);
} else {
  skip(`fresh_receipt:${ageMinutes}m<${minIntervalMinutes}m`, ageMinutes);
}
