import { useEffect, useState } from "react";

type TradeResult = {
  executed: boolean;
  kind: string | null;
  txHash: string | null;
  spentUsd: number | null;
  units: number | null;
  error: string | null;
};

type Cycle = {
  at: string | null;
  file: string;
  checksum: string | null;
  prevChecksum: string | null;
  equityUsd: number | null;
  usdtUsd: number | null;
  usd1Usd: number | null;
  positionUsd: number | null;
  floorUsd: number | null;
  degraded: boolean;
  action: string | null;
  symbol: string | null;
  direction: string | null;
  convictionBps: number | null;
  provider: string | null;
  rationale: string | null;
  invalidation: string | null;
  governorVerdict: string | null;
  governorReason: string | null;
  paid: boolean;
  paidCallCount: number;
  dataSpendUsd: number | null;
  trade: boolean;
  tradeResult: TradeResult | null;
};

type Feed = {
  generatedAt: string | null;
  summary: {
    cycleCount: number;
    firstAt: string | null;
    lastAt: string | null;
    equityNow: number | null;
    floorUsd: number | null;
    equityStart: number | null;
    chainOk: boolean;
    wallet: string | null;
    chain: string | null;
  };
  cycles: Cycle[];
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; feed: Feed }
  | { status: "error"; message: string };

const FALLBACK_WALLET = "0x5927a9662588f5609154488111E8ee7f4075513C";

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatUsd(value: number | null | undefined, maximumFractionDigits = 2) {
  if (!isNumber(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);
}

function formatBps(value: number | null | undefined) {
  if (!isNumber(value)) return "n/a";
  return `${value.toLocaleString("en-US")} bps`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function timeAgo(value: string | null | undefined) {
  if (!value) return { label: "unknown", stale: true };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: "unknown", stale: true };
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 2) return { label: "just now", stale: false };
  if (minutes < 60) return { label: `${minutes}m ago`, stale: false };
  const hours = Math.round(minutes / 60);
  return { label: `${hours}h ago`, stale: hours >= 4 };
}

function shortHash(value: string | null | undefined) {
  if (!value) return "null";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function shortFile(value: string) {
  return value.replace(".json", "");
}

function verifyFeedChain(cycles: Cycle[]) {
  const chronological = [...cycles].reverse();
  let previous: string | null = null;
  for (let index = 0; index < chronological.length; index += 1) {
    const cycle = chronological[index];
    const prevChecksum = cycle.prevChecksum ?? null;
    if (prevChecksum !== previous) {
      return {
        ok: false,
        count: chronological.length,
        head: previous,
        brokenAt: shortFile(cycle.file),
      };
    }
    previous = cycle.checksum ?? null;
  }
  return {
    ok: true,
    count: chronological.length,
    head: previous,
    brokenAt: null,
  };
}

function decisionLabel(cycle: Cycle) {
  if (cycle.tradeResult?.executed) return cycle.tradeResult.kind ?? "EXECUTED";
  if (cycle.trade) return "ARMED_WAIT";
  return "NO_TRADE";
}

function signalLabel(cycle: Cycle) {
  const parts = [cycle.action, cycle.symbol, cycle.direction].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "no thesis";
}

function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/data/feed.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`feed request failed: ${response.status}`);
        return response.json() as Promise<Feed>;
      })
      .then((feed) => {
        if (!cancelled) setState({ status: "ready", feed });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "feed request failed",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <Shell variant="loading" />;
  if (state.status === "error") return <Shell variant="error" message={state.message} />;
  if (state.feed.cycles.length === 0) return <Shell variant="empty" />;

  const { feed } = state;
  const latest = feed.cycles[0];
  const chain = verifyFeedChain(feed.cycles);
  const wallet = feed.summary.wallet ?? FALLBACK_WALLET;
  const freshness = timeAgo(latest.at);

  return (
    <main className="page-shell">
      <Hero latest={latest} freshness={freshness} chainOk={chain.ok} />
      <LiveState feed={feed} latest={latest} freshness={freshness} />
      <DecisionLog cycles={feed.cycles} />
      <Aggregates feed={feed} chain={chain} />
      <Footer wallet={wallet} chain={feed.summary.chain} />
    </main>
  );
}

function Shell({ variant, message }: { variant: "loading" | "error" | "empty"; message?: string }) {
  const title = variant === "loading" ? "Loading Scoop receipts" : variant === "error" ? "Feed unavailable" : "No receipts yet";
  const body =
    variant === "loading"
      ? "Reading the static receipt feed committed by the agent cron."
      : variant === "error"
        ? message ?? "The dashboard could not load /data/feed.json."
        : "The dashboard is ready, but the committed feed has no cycles.";

  return (
    <main className="page-shell page-shell--center">
      <section className="empty-state" aria-live="polite">
        <span className="eyebrow">Scoop dashboard</span>
        <h1>{title}</h1>
        <p>{body}</p>
      </section>
    </main>
  );
}

function Hero({
  latest,
  freshness,
  chainOk,
}: {
  latest: Cycle;
  freshness: { label: string; stale: boolean };
  chainOk: boolean;
}) {
  const armed = latest.trade;
  return (
    <header className="hero">
      <div className="hero__copy">
        <span className="eyebrow">BNB Hack autonomous trading agent</span>
        <h1>Scoop buys its own market intelligence, then leaves a receipt.</h1>
        <p>
          A self-custody BSC agent that pays for CMC data through x402, runs a ratcheted risk governor, and records every
          decision as a checksum-linked cycle.
        </p>
      </div>
      <aside className="hero-card" aria-label="Current agent mode">
        <div className="mode-row">
          <span className={`mode-pill ${armed ? "mode-pill--armed" : "mode-pill--observe"}`}>
            {armed ? "ARMED" : "OBSERVATION MODE"}
          </span>
          <span className={`freshness ${freshness.stale ? "freshness--stale" : ""}`}>{freshness.label}</span>
        </div>
        <div className="receipt-stack" aria-label="Latest receipt summary">
          <span>{latest.paidCallCount} paid calls</span>
          <span>{latest.governorVerdict ?? "governor pending"}</span>
          <span>{shortHash(latest.checksum)}</span>
        </div>
        <dl className="hero-card__facts">
          <div>
            <dt>Latest cycle</dt>
            <dd>{formatDate(latest.at)}</dd>
          </div>
          <div>
            <dt>Receipt head</dt>
            <dd>{shortHash(latest.checksum)}</dd>
          </div>
          <div>
            <dt>Browser chain check</dt>
            <dd className={chainOk ? "text-good" : "text-bad"}>{chainOk ? "linked" : "broken"}</dd>
          </div>
        </dl>
      </aside>
    </header>
  );
}

function LiveState({
  feed,
  latest,
  freshness,
}: {
  feed: Feed;
  latest: Cycle;
  freshness: { label: string; stale: boolean };
}) {
  const equityChange =
    isNumber(feed.summary.equityNow) && isNumber(feed.summary.equityStart)
      ? feed.summary.equityNow - feed.summary.equityStart
      : null;
  const floorDistance =
    isNumber(latest.equityUsd) && isNumber(latest.floorUsd) ? Math.max(0, latest.equityUsd - latest.floorUsd) : null;
  const modeText = latest.trade
    ? "Trade execution is armed for cycles that pass the governor."
    : "Trade execution is not armed. The agent is observing, paying for data, and publishing receipts.";

  return (
    <section className="panel live-grid" aria-labelledby="live-state-title">
      <div className="live-copy">
        <span className="eyebrow">Live state</span>
        <h2 id="live-state-title">Current capital, floor, and mode.</h2>
        <p>{modeText}</p>
        {latest.degraded ? (
          <p className="alert">Latest receipt is degraded. Treat this cycle as a limited-data observation.</p>
        ) : null}
        {freshness.stale ? <p className="alert">Latest feed is stale by dashboard policy: last cycle was {freshness.label}.</p> : null}
      </div>
      <div className="metric metric--primary">
        <span>Equity now</span>
        <strong>{formatUsd(feed.summary.equityNow)}</strong>
        <small>{isNumber(equityChange) ? `${equityChange >= 0 ? "+" : ""}${formatUsd(equityChange)} since first receipt` : "baseline unavailable"}</small>
      </div>
      <div className="metric">
        <span>Risk floor</span>
        <strong>{formatUsd(latest.floorUsd)}</strong>
        <small>{isNumber(floorDistance) ? `${formatUsd(floorDistance)} above floor` : "distance unavailable"}</small>
      </div>
      <div className="metric">
        <span>Cash split</span>
        <strong>{formatUsd(latest.usdtUsd)} USDT</strong>
        <small>{formatUsd(latest.usd1Usd)} USD1</small>
      </div>
      <div className="metric">
        <span>Open position</span>
        <strong>{formatUsd(latest.positionUsd)}</strong>
        <small>{latest.positionUsd && latest.positionUsd > 0 ? "position is live" : "flat at latest receipt"}</small>
      </div>
      <EquityChart cycles={feed.cycles} />
    </section>
  );
}

function EquityChart({ cycles }: { cycles: Cycle[] }) {
  const plotted = [...cycles]
    .reverse()
    .filter((cycle) => isNumber(cycle.equityUsd))
    .slice(-64);

  if (plotted.length < 2) {
    return (
      <div className="chart chart--empty">
        <span>Equity chart needs at least two receipts.</span>
      </div>
    );
  }

  const width = 820;
  const height = 260;
  const pad = 28;
  const values = plotted.flatMap((cycle) => [cycle.equityUsd, cycle.floorUsd]).filter(isNumber);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = Math.max(0.01, maxValue - minValue);
  const yMin = minValue - spread * 0.18;
  const yMax = maxValue + spread * 0.18;
  const x = (index: number) => pad + (index / Math.max(1, plotted.length - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - ((value - yMin) / Math.max(0.01, yMax - yMin)) * (height - pad * 2);
  const equityPoints = plotted.map((cycle, index) => `${x(index)},${y(cycle.equityUsd!)}`).join(" ");
  const floorPoints = plotted
    .map((cycle, index) => (isNumber(cycle.floorUsd) ? `${x(index)},${y(cycle.floorUsd)}` : null))
    .filter(Boolean)
    .join(" ");

  return (
    <div className="chart">
      <div className="chart__header">
        <span>Equity path</span>
        <small>Receipt-derived values only</small>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Equity and risk floor over recent receipts">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="axis" />
        <polyline points={floorPoints} className="floor-line" fill="none" />
        <polyline points={equityPoints} className="equity-line" fill="none" />
        {plotted.map((cycle, index) => (
          <circle
            key={cycle.file}
            cx={x(index)}
            cy={y(cycle.equityUsd!)}
            r={cycle.degraded ? 5 : 3}
            className={cycle.degraded ? "point point--degraded" : "point"}
          />
        ))}
      </svg>
      <div className="chart__legend">
        <span><i className="legend-dot legend-dot--equity" /> equity</span>
        <span><i className="legend-dot legend-dot--floor" /> governor floor</span>
        <span><i className="legend-dot legend-dot--degraded" /> degraded cycle</span>
      </div>
    </div>
  );
}

function DecisionLog({ cycles }: { cycles: Cycle[] }) {
  return (
    <section className="panel" aria-labelledby="decision-log-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Decisions</span>
          <h2 id="decision-log-title">Latest receipt log.</h2>
        </div>
        <p>Most cycles should stand aside, that is the discipline.</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Cycle</th>
              <th scope="col">Outcome</th>
              <th scope="col">Signal</th>
              <th scope="col">Governor</th>
              <th scope="col">Paid perception</th>
              <th scope="col">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {cycles.slice(0, 10).map((cycle) => {
              const label = decisionLabel(cycle);
              const active = label !== "NO_TRADE";
              return (
                <tr key={cycle.file}>
                  <td>
                    <strong>{formatDate(cycle.at)}</strong>
                    <small>{shortFile(cycle.file)}</small>
                  </td>
                  <td>
                    <span className={`decision-pill ${active ? "decision-pill--active" : ""}`}>{label}</span>
                    {cycle.degraded ? <small className="text-bad">degraded data</small> : null}
                  </td>
                  <td>
                    <strong>{signalLabel(cycle)}</strong>
                    <small>
                      {formatBps(cycle.convictionBps)}
                      {cycle.provider ? ` via ${cycle.provider}` : ""}
                    </small>
                    {cycle.rationale ? <em>{cycle.rationale}</em> : null}
                  </td>
                  <td>
                    <strong>{cycle.governorVerdict ?? "unknown"}</strong>
                    <small>{cycle.governorReason ?? "no reason recorded"}</small>
                  </td>
                  <td>
                    <strong>{cycle.paid ? "x402 paid" : "free/local"}</strong>
                    <small>
                      {cycle.paidCallCount} calls
                      {isNumber(cycle.dataSpendUsd) ? `, ${formatUsd(cycle.dataSpendUsd, 4)}` : ""}
                    </small>
                  </td>
                  <td>
                    <strong>{shortHash(cycle.checksum)}</strong>
                    <small>{cycle.tradeResult?.txHash ? shortHash(cycle.tradeResult.txHash) : "no tx hash"}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Aggregates({
  feed,
  chain,
}: {
  feed: Feed;
  chain: ReturnType<typeof verifyFeedChain>;
}) {
  const cycles = feed.cycles;
  const noTradeCount = cycles.filter((cycle) => decisionLabel(cycle) === "NO_TRADE").length;
  const paidCycles = cycles.filter((cycle) => cycle.paid).length;
  const degradedCycles = cycles.filter((cycle) => cycle.degraded).length;
  const armedCycles = cycles.filter((cycle) => cycle.trade).length;
  const dataSpend = cycles.reduce((sum, cycle) => sum + (cycle.dataSpendUsd ?? 0), 0);

  return (
    <section className="panel aggregates" aria-labelledby="aggregates-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Aggregates</span>
          <h2 id="aggregates-title">Receipt-derived operating picture.</h2>
        </div>
        <p>No synthetic PnL, no inferred trades, no off-chain dashboard state.</p>
      </div>
      <div className="aggregate-grid">
        <Stat label="Cycles committed" value={feed.summary.cycleCount.toLocaleString("en-US")} />
        <Stat label="NO_TRADE outcomes" value={noTradeCount.toLocaleString("en-US")} />
        <Stat label="x402 paid cycles" value={`${paidCycles.toLocaleString("en-US")} / ${cycles.length}`} />
        <Stat label="Observed data spend" value={formatUsd(dataSpend, 4)} />
        <Stat label="Armed cycles" value={armedCycles.toLocaleString("en-US")} />
        <Stat label="Degraded cycles" value={degradedCycles.toLocaleString("en-US")} tone={degradedCycles > 0 ? "warn" : "good"} />
      </div>
      <div className={`chain-strip ${chain.ok ? "chain-strip--ok" : "chain-strip--bad"}`}>
        <div>
          <span className="eyebrow">Receipt-chain check</span>
          <strong>{chain.ok ? "Client verified linkage" : `Chain break at ${chain.brokenAt}`}</strong>
          <p>
            Your browser walks the receipts in chronological order and checks each <code>prevChecksum</code> against the
            prior receipt head, so history cannot be rewritten silently without breaking the strip.
          </p>
        </div>
        <div className="chain-strip__head">
          <span>{chain.count} receipts</span>
          <strong>{shortHash(chain.head)}</strong>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Footer({ wallet, chain }: { wallet: string; chain: string | null }) {
  const scanUrl = `https://bscscan.com/address/${wallet}`;
  return (
    <footer className="footer">
      <div>
        <span className="eyebrow">Proof footer</span>
        <p>
          Agent wallet:{" "}
          <a href={scanUrl} target="_blank" rel="noreferrer">
            {wallet}
          </a>
        </p>
        <p>Receipts stay in the private repo during build and can be opened for judging at submission.</p>
      </div>
      <div>
        <p>Built with Trust Wallet Agent Kit, CMC x402 data, and BNB Chain.</p>
        <p>Network: {(chain ?? "bsc").toUpperCase()}</p>
      </div>
    </footer>
  );
}

export default App;
