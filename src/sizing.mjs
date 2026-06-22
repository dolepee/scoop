export function executableUsdAmount({ targetUsd, maxUsd, minUsd }) {
  if (!Number.isFinite(targetUsd) || !Number.isFinite(maxUsd) || !Number.isFinite(minUsd)) return null;
  if (maxUsd + 1e-9 < minUsd) return null;
  const floored = Math.max(targetUsd, minUsd);
  const rounded = Math.ceil((floored - 1e-9) * 100) / 100;
  if (rounded > maxUsd + 1e-9) return null;
  return rounded;
}
