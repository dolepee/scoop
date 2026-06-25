import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { latestReceipt } from "./receipts.mjs";
import { scheduleDecision } from "./schedule-guard.mjs";

const eventName = process.env.GITHUB_EVENT_NAME || process.env.GITHUB_EVENT_NAME_FALLBACK || "";
const forceRun = String(process.env.SCOOP_FORCE_RUN || "").trim() === "1";
const tradeArmed = String(process.env.SCOOP_TRADE || "").trim() === "1";
const minIntervalMinutes = Number(process.env.SCOOP_MIN_RUN_INTERVAL_MINUTES ?? 50);
const openPositionIntervalMinutes = Number(process.env.SCOOP_OPEN_POSITION_INTERVAL_MINUTES ?? 10);
const outputPath = process.env.GITHUB_OUTPUT;

function setOutput(key, value) {
  if (outputPath) appendFileSync(outputPath, `${key}=${value}\n`);
}

const latest = latestReceipt();
const decision = scheduleDecision({
  forceRun,
  eventName,
  latestGeneratedAt: latest?.generatedAt,
  latestTradeArmed: latest?.modes?.trade === true,
  tradeArmed,
  minIntervalMinutes,
  openPosition: hasOpenPosition(),
  openPositionIntervalMinutes,
});

setOutput("should_run", String(decision.shouldRun));
setOutput("reason", decision.reason);
if (decision.ageMinutes !== undefined) setOutput("age_minutes", String(decision.ageMinutes));
console.log(`SCOOP_SCHEDULE_GUARD ${decision.shouldRun ? "allow" : "skip"} reason=${decision.reason}${decision.ageMinutes !== undefined ? ` age_minutes=${decision.ageMinutes}` : ""}`);

function hasOpenPosition() {
  const path = new URL("../state/position.json", import.meta.url);
  if (!existsSync(path)) return false;
  try {
    const position = JSON.parse(readFileSync(path, "utf8"));
    return Boolean(position?.symbol && position?.address && Number(position?.units) > 0);
  } catch {
    return false;
  }
}
