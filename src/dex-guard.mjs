export const DEX_GUARD_CONFIG = {
  minLiquidityUsd: 100_000,
  minH1VolumeUsd: 5_000,
  maxPaidDexDivergencePct: 3,
  recoveryMinH1ChangePct: -2,
};

export async function evaluateDexGuard({ token, paidPriceUsd, recoveryMode = false, config = DEX_GUARD_CONFIG }) {
  if (!token?.address) return block("dex_token_missing");
  try {
    const pair = await fetchBestBscPair(token.address);
    return evaluateDexPairGuard({ pair, paidPriceUsd, recoveryMode, config });
  } catch (error) {
    return block("dex_guard_unavailable", { error: String(error?.message ?? error).slice(0, 160) });
  }
}

export function evaluateDexPairGuard({ pair, paidPriceUsd, recoveryMode = false, config = DEX_GUARD_CONFIG }) {
  if (!pair) return block("dex_pair_missing");

  const priceUsd = Number(pair.priceUsd);
  const liquidityUsd = Number(pair.liquidity?.usd ?? 0);
  const h1VolumeUsd = Number(pair.volume?.h1 ?? 0);
  const h1ChangePct = Number(pair.priceChange?.h1 ?? 0);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return block("dex_price_missing");
  if (liquidityUsd < config.minLiquidityUsd) {
    return block("dex_liquidity_too_thin", { priceUsd, liquidityUsd, minLiquidityUsd: config.minLiquidityUsd });
  }
  if (h1VolumeUsd < config.minH1VolumeUsd) {
    return block("dex_h1_volume_too_thin", { priceUsd, h1VolumeUsd, minH1VolumeUsd: config.minH1VolumeUsd });
  }

  const paid = Number(paidPriceUsd);
  if (Number.isFinite(paid) && paid > 0) {
    const divergencePct = Math.abs((priceUsd - paid) / paid) * 100;
    if (divergencePct > config.maxPaidDexDivergencePct) {
      return block("dex_paid_price_diverged", {
        priceUsd,
        paidPriceUsd: paid,
        divergencePct,
        maxDivergencePct: config.maxPaidDexDivergencePct,
      });
    }
  }

  if (recoveryMode && h1ChangePct < config.recoveryMinH1ChangePct) {
    return block("dex_recovery_momentum_negative", {
      priceUsd,
      h1ChangePct,
      minH1ChangePct: config.recoveryMinH1ChangePct,
    });
  }

  return {
    ok: true,
    priceUsd,
    liquidityUsd,
    h1VolumeUsd,
    h1ChangePct,
    pairAddress: pair.pairAddress ?? null,
    dexId: pair.dexId ?? null,
  };
}

async function fetchBestBscPair(address) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`dex_http_${res.status}`);
  const json = await res.json();
  const pairs = (json.pairs ?? [])
    .filter((pair) => pair?.chainId === "bsc")
    .sort((a, b) => Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
  return pairs[0] ?? null;
}

function block(reason, details = {}) {
  return { ok: false, reason, ...details };
}
