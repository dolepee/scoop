export function scheduleDecision({
  forceRun = false,
  eventName = "",
  latestGeneratedAt = null,
  latestTradeArmed = true,
  tradeArmed = false,
  nowMs = Date.now(),
  minIntervalMinutes = 50,
  openPosition = false,
  openPositionIntervalMinutes = 10,
} = {}) {
  if (forceRun) return allow(`force:${eventName || "manual"}`);

  if (!latestGeneratedAt) return allow("no_receipt_head");

  const lastMs = Date.parse(latestGeneratedAt);
  if (!Number.isFinite(lastMs)) return allow("invalid_receipt_time");

  const ageMinutes = Math.floor((nowMs - lastMs) / 60_000);
  if (eventName === "schedule" && tradeArmed && !latestTradeArmed && !openPosition) {
    return allow(`armed_schedule_after_observe:${ageMinutes}m`, ageMinutes);
  }
  if (openPosition) {
    if (ageMinutes >= openPositionIntervalMinutes) {
      return allow(`open_position_age:${ageMinutes}m`, ageMinutes);
    }
    return skip(`fresh_open_position:${ageMinutes}m<${openPositionIntervalMinutes}m`, ageMinutes);
  }

  if (ageMinutes >= minIntervalMinutes) {
    return allow(`receipt_age:${ageMinutes}m`, ageMinutes);
  }
  return skip(`fresh_receipt:${ageMinutes}m<${minIntervalMinutes}m`, ageMinutes);
}

function allow(reason, ageMinutes = undefined) {
  return { shouldRun: true, reason, ageMinutes };
}

function skip(reason, ageMinutes = undefined) {
  return { shouldRun: false, reason, ageMinutes };
}
