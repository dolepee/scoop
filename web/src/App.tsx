import { useEffect, useState } from "react";

type TradeResult = {
  executed: boolean;
  kind: string | null;
  txHash: string | null;
  spentUsd: number | null;
  units: number | null;
  error: string | null;
};

type PaidCall = {
  url: string | null;
  costUsd: number | null;
  dataSource: string | null;
  fallbackFrom: string | null;
  responseHash: string | null;
  skipped: string | null;
};

type PositionSummary = {
  symbol: string | null;
  address: string | null;
  units: number | null;
  entryPrice: number | null;
  costUsd: number | null;
  openedAt: string | null;
  complianceTrade: boolean;
  complianceReason: string | null;
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
  inScopeUsd: number | null;
  inScopeWarning: boolean;
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
  paidCalls?: PaidCall[];
  dataSpendUsd: number | null;
  trade: boolean;
  tradeResult: TradeResult | null;
  position: PositionSummary | null;
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
    peakEquityUsd?: number | null;
    firstReceiptEquityUsd?: number | null;
    chainOk: boolean;
    wallet: string | null;
    chain: string | null;
    paidCycles?: number;
    x402PaidCycles?: number;
    totalDataSpendUsd?: number;
    tradeTheses?: number;
    armedCycles?: number;
    executedTrades?: number;
    degradedCycles?: number;
  };
  cycles: Cycle[];
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; feed: Feed }
  | { status: "error"; message: string };

type FeedStats = {
  latest: Cycle;
  chain: ReturnType<typeof verifyFeedChain>;
  wallet: string;
  freshness: { label: string; stale: boolean };
  paidCycles: number;
  x402PaidCycles: number;
  noTradeCycles: number;
  tradeTheses: number;
  armedCycles: number;
  executedTrades: number;
  degradedCycles: number;
  dataSpendUsd: number;
  equityChangeUsd: number | null;
  equityChangePct: number | null;
  floorDistanceUsd: number | null;
  riskFloorUsd: number | null;
  latestExecutedTrade: Cycle | null;
  currentPosition: PositionSummary | null;
  positionMaturesAt: string | null;
};

type CmcShowcaseStats = {
  totalCalls: number;
  paidCalls: number;
  fallbackCalls: number;
  uniqueEndpointCount: number;
  latestEndpoint: string;
  latestResponseHash: string | null;
};

const FALLBACK_WALLET = "0x5927a9662588f5609154488111E8ee7f4075513C";
const REPO_URL = "https://github.com/dolepee/scoop";
const REGISTRATION_TX = "0x5877f701e471da2ed41b6e0fabcac1c820a8daf8bf4fd5f59538e48709dd73cb";
const COMPLIANCE_HOLD_MS = 20 * 60 * 60 * 1000;

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

function formatInteger(value: number | null | undefined) {
  if (!isNumber(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPct(value: number | null | undefined) {
  if (!isNumber(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
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

function formatUtc(value: string | null | undefined) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function timeAgo(value: string | null | undefined) {
  if (!value) return { label: "unknown", stale: true };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: "unknown", stale: true };
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 2) return { label: "just now", stale: false };
  if (minutes < 60) return { label: `${minutes} min ago`, stale: false };
  const hours = Math.round(minutes / 60);
  return { label: `${hours} hr ago`, stale: hours >= 4 };
}

function shortHash(value: string | null | undefined) {
  if (!value) return "null";
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function shortFile(value: string) {
  return value.replace(".json", "");
}

function bscTxUrl(hash: string) {
  return `https://bscscan.com/tx/${hash}`;
}

function bscAddressUrl(address: string) {
  return `https://bscscan.com/address/${address}`;
}

function bscTokenUrl(address: string) {
  return `https://bscscan.com/token/${address}`;
}

function receiptUrl(file: string) {
  return `${REPO_URL}/blob/master/receipts/${file}`;
}

function endpointLabel(url: string | null | undefined) {
  if (!url) return "no endpoint";
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/x402/, "CMC x402");
  } catch {
    return url.replace("https://pro-api.coinmarketcap.com/x402", "CMC x402");
  }
}

function computeCmcShowcase(feed: Feed): CmcShowcaseStats {
  const calls = feed.cycles.flatMap((cycle) => cycle.paidCalls ?? []);
  const paidCalls = calls.filter((call) => call.dataSource === "x402-paid");
  const endpointKeys = new Set(calls.map((call) => endpointLabel(call.url)).filter((value) => value !== "no endpoint"));
  const latestPaidCall = feed.cycles
    .flatMap((cycle) => cycle.paidCalls ?? [])
    .find((call) => call.dataSource === "x402-paid" && call.url);

  return {
    totalCalls: calls.length,
    paidCalls: paidCalls.length,
    fallbackCalls: calls.filter((call) => call.fallbackFrom || call.dataSource !== "x402-paid").length,
    uniqueEndpointCount: endpointKeys.size,
    latestEndpoint: endpointLabel(latestPaidCall?.url),
    latestResponseHash: latestPaidCall?.responseHash ?? null,
  };
}

function verifyFeedChain(cycles: Cycle[]) {
  const chronological = [...cycles].reverse();
  let previous: string | null = null;
  for (const cycle of chronological) {
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

function terminalDecisionLabel(cycle: Cycle) {
  const label = decisionLabel(cycle);
  if (label === "compliance_sell") return "Compliance sell";
  if (label === "compliance_buy") return "Compliance buy";
  if (label === "NO_TRADE") return "No trade";
  if (label === "ARMED_WAIT") return "Armed wait";
  if (cycle.tradeResult?.executed) return "Trade executed";
  return toDisplayPhrase(label);
}

function terminalReason(value: string | null | undefined) {
  if (!value) return "Governor state recorded in receipt.";
  return value
    .split(",")
    .map((part) => toDisplayPhrase(part.trim()).replace(/\s*:\s*/g, ": "))
    .filter(Boolean)
    .join(" · ");
}

function toDisplayPhrase(value: string) {
  return value.replace(/_/g, " ").replace(/\s+/g, " ");
}

function signalLabel(cycle: Cycle) {
  const parts = [cycle.action, cycle.action === "TRADE" ? cycle.symbol : null, cycle.direction].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "no thesis";
}

function positionLabel(stats: FeedStats) {
  const position = stats.currentPosition;
  if (!position?.symbol) return "Flat";
  return `${position.symbol} ${formatUsd(stats.latest.positionUsd)}`;
}

function positionDetail(stats: FeedStats) {
  const position = stats.currentPosition;
  if (!position?.symbol) return "No open token position in the latest receipt.";
  if (stats.positionMaturesAt) return `Compliance sell gate ${formatUtc(stats.positionMaturesAt)}.`;
  return `Opened ${formatDate(position.openedAt)}.`;
}

function computeStats(feed: Feed): FeedStats {
  const latest = feed.cycles[0];
  const chain = verifyFeedChain(feed.cycles);
  const wallet = feed.summary.wallet ?? FALLBACK_WALLET;
  const latestExecutedTrade = feed.cycles.find((cycle) => cycle.tradeResult?.executed) ?? null;
  const currentPosition = latest.position ?? null;
  const positionOpenedAt = Date.parse(currentPosition?.openedAt ?? "");
  const positionMaturesAt =
    currentPosition?.complianceTrade && Number.isFinite(positionOpenedAt)
      ? new Date(positionOpenedAt + COMPLIANCE_HOLD_MS).toISOString()
      : null;
  const equityChangeUsd =
    isNumber(feed.summary.equityNow) && isNumber(feed.summary.equityStart)
      ? feed.summary.equityNow - feed.summary.equityStart
      : null;
  const equityChangePct =
    isNumber(equityChangeUsd) && isNumber(feed.summary.equityStart) && feed.summary.equityStart !== 0
      ? (equityChangeUsd / feed.summary.equityStart) * 100
      : null;
  const riskFloorUsd = feed.summary.floorUsd ?? latest.floorUsd ?? null;
  const floorDistanceUsd =
    isNumber(latest.equityUsd) && isNumber(riskFloorUsd) ? Math.max(0, latest.equityUsd - riskFloorUsd) : null;

  return {
    latest,
    chain,
    wallet,
    freshness: timeAgo(latest.at),
    paidCycles: feed.summary.paidCycles ?? feed.cycles.filter((cycle) => cycle.paid).length,
    x402PaidCycles:
      feed.summary.x402PaidCycles ??
      feed.cycles.filter((cycle) => (cycle.paidCalls ?? []).some((call) => call.dataSource === "x402-paid")).length,
    noTradeCycles: feed.cycles.filter((cycle) => decisionLabel(cycle) === "NO_TRADE").length,
    tradeTheses: feed.summary.tradeTheses ?? feed.cycles.filter((cycle) => cycle.action === "TRADE").length,
    armedCycles: feed.summary.armedCycles ?? feed.cycles.filter((cycle) => cycle.trade).length,
    executedTrades: feed.summary.executedTrades ?? feed.cycles.filter((cycle) => cycle.tradeResult?.executed).length,
    degradedCycles: feed.summary.degradedCycles ?? feed.cycles.filter((cycle) => cycle.degraded).length,
    dataSpendUsd: feed.summary.totalDataSpendUsd ?? feed.cycles.reduce((sum, cycle) => sum + (cycle.dataSpendUsd ?? 0), 0),
    equityChangeUsd,
    equityChangePct,
    floorDistanceUsd,
    riskFloorUsd,
    latestExecutedTrade,
    currentPosition,
    positionMaturesAt,
  };
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

  useEffect(() => {
    if (state.status !== "ready") return;

    const scrollToHash = () => {
      const targetId = window.location.hash.slice(1);
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (!target) return;

      const nav = document.querySelector<HTMLElement>(".topbar");
      const navStyle = nav ? window.getComputedStyle(nav) : null;
      const navBottom = nav && navStyle?.position === "sticky" ? nav.getBoundingClientRect().bottom : 0;
      const anchorOffset = navBottom + 22;
      const targetTop = target.getBoundingClientRect().top + window.scrollY - anchorOffset;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
    };

    const handleAnchorClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!link || !link.hash) return;
      if (link.pathname !== window.location.pathname || link.origin !== window.location.origin) return;

      event.preventDefault();
      window.history.pushState(null, "", link.hash);
      scrollToHash();
    };

    const frame = window.requestAnimationFrame(scrollToHash);
    const timeout = window.setTimeout(scrollToHash, 250);
    window.addEventListener("hashchange", scrollToHash);
    document.addEventListener("click", handleAnchorClick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      window.removeEventListener("hashchange", scrollToHash);
      document.removeEventListener("click", handleAnchorClick);
    };
  }, [state.status]);

  if (state.status === "loading") return <Shell title="Loading Scoop" body="Opening the live receipt feed." />;
  if (state.status === "error") return <Shell title="Feed unavailable" body={state.message} tone="bad" />;
  if (state.feed.cycles.length === 0) return <Shell title="No cycles yet" body="The dashboard is ready, but no receipts have been committed." />;

  const stats = computeStats(state.feed);

  return (
    <main className="app-shell">
      <Topbar stats={stats} />
      <Hero feed={state.feed} stats={stats} />
      <SignalRail stats={stats} />
      <CmcAgentHubShowcase feed={state.feed} stats={stats} />
      <ReadinessLedger stats={stats} />
      <ControlRoom feed={state.feed} stats={stats} />
      <ProofPanel feed={state.feed} stats={stats} />
      <AgentLoop stats={stats} />
      <DecisionLog cycles={state.feed.cycles} />
      <ProofFooter stats={stats} />
    </main>
  );
}

function Shell({ title, body, tone }: { title: string; body: string; tone?: "bad" }) {
  return (
    <main className="app-shell app-shell--center">
      <section className={`empty-state ${tone === "bad" ? "empty-state--bad" : ""}`} aria-live="polite">
        <span className="eyebrow">Scoop dashboard</span>
        <h1>{title}</h1>
        <p>{body}</p>
      </section>
    </main>
  );
}

function Topbar({ stats }: { stats: FeedStats }) {
  return (
    <nav className="topbar" aria-label="Primary">
      <a className="brand" href="#top" aria-label="Scoop home">
        <span className="brand__mark">S</span>
        <span>
          <strong>Scoop</strong>
          <small>BNB AI Trading Agent</small>
        </span>
      </a>
      <div className="nav-links" aria-label="Page sections">
        <a href="#cmc-agent-hub">CMC</a>
        <a href="#control-room">Control</a>
        <a href="#proof">Proof</a>
        <a href="#loop">Loop</a>
        <a href="#receipts">Receipts</a>
      </div>
      <div className="topbar__proof">
        <span className={stats.chain.ok ? "status-dot" : "status-dot status-dot--bad"} />
        <span>{stats.chain.ok ? "receipt chain valid" : "chain break"}</span>
      </div>
    </nav>
  );
}

function Hero({ feed, stats }: { feed: Feed; stats: FeedStats }) {
  const latest = stats.latest;
  const mode = latest.trade ? "armed" : "observe";
  const latestTx = stats.latestExecutedTrade?.tradeResult?.txHash ?? null;

  return (
    <header className="hero" id="top">
      <section className="hero__copy">
        <div className="hero__pills">
          <span className="pill pill--gold">Registered Track 1 agent</span>
          <span className="pill">CMC x402</span>
          <span className="pill">TWAK signing</span>
          <span className="pill">BSC spot</span>
        </div>
        <h1>
          Pays for signal.{" "}
          <span>Signs only when risk clears.</span>
        </h1>
        <p>
          Scoop is a self-custody BSC trading agent for the BNB AI Trading Agent track. It buys CMC intelligence through
          x402, forms one thesis, and lets a hard governor decide whether Trust Wallet Agent Kit can sign.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="#control-room">Open live control room</a>
          {latestTx ? <a className="button" href={bscTxUrl(latestTx)} target="_blank" rel="noreferrer">Latest tx</a> : null}
          <a className="button" href={REPO_URL} target="_blank" rel="noreferrer">View GitHub</a>
        </div>
        <dl className="hero__proofline" aria-label="Live proof summary">
          <div>
            <dt>Signed tx</dt>
            <dd>{stats.executedTrades}</dd>
          </div>
          <div>
            <dt>Receipts</dt>
            <dd>{feed.summary.cycleCount}</dd>
          </div>
          <div>
            <dt>x402 cycles</dt>
            <dd>{stats.x402PaidCycles}</dd>
          </div>
        </dl>
      </section>

      <aside className="terminal-card" aria-label="Live agent command card">
        <div className="terminal-card__top">
          <span className={`mode-badge mode-badge--${mode}`}>{mode === "armed" ? "Armed" : "Observe mode"}</span>
          <span className={stats.freshness.stale ? "freshness freshness--stale" : "freshness"}>{stats.freshness.label}</span>
        </div>
        <div className="terminal-screen">
          <span className="terminal-screen__label">governor receipt</span>
          <strong className="terminal-screen__decision">{terminalDecisionLabel(latest)}</strong>
          <p className="terminal-screen__reason">{terminalReason(latest.governorReason)}</p>
          <div className="command-line">
            <span>paid_calls</span>
            <strong>{latest.paidCallCount}</strong>
          </div>
          <div className="command-line">
            <span>receipt_head</span>
            <strong>{shortHash(latest.checksum)}</strong>
          </div>
          <div className="command-line">
            <span>open_position</span>
            <strong>{stats.currentPosition?.symbol ?? "flat"}</strong>
          </div>
          <div className="command-line">
            <span>cycles</span>
            <strong>{feed.summary.cycleCount}</strong>
          </div>
        </div>
        <div className="rail-map" aria-label="Execution rails">
          <span>CMC x402</span>
          <i />
          <strong>{stats.x402PaidCycles} paid cycles</strong>
          <span>Governor</span>
          <i />
          <strong>{stats.noTradeCycles} stand-downs</strong>
          <span>TWAK</span>
          <i />
          <strong>{stats.executedTrades} signed tx</strong>
        </div>
        <div className="terminal-card__footer">
          <a href={bscAddressUrl(stats.wallet)} target="_blank" rel="noreferrer">Agent wallet</a>
          <a href={bscTxUrl(REGISTRATION_TX)} target="_blank" rel="noreferrer">Registration tx</a>
        </div>
      </aside>
    </header>
  );
}

function SignalRail({ stats }: { stats: FeedStats }) {
  return (
    <section className="signal-rail" aria-label="Contest readiness">
      <MetricCard label="Equity" value={formatUsd(stats.latest.equityUsd)} detail={`${formatPct(stats.equityChangePct)} from risk baseline`} tone={isNumber(stats.equityChangeUsd) && stats.equityChangeUsd >= 0 ? "good" : "warn"} />
      <MetricCard label="Risk floor" value={formatUsd(stats.riskFloorUsd)} detail={`${formatUsd(stats.floorDistanceUsd)} room above floor`} />
      <MetricCard label="Position" value={positionLabel(stats)} detail={positionDetail(stats)} tone={stats.currentPosition ? "good" : undefined} />
      <MetricCard label="x402 spend" value={formatUsd(stats.dataSpendUsd, 4)} detail={`${stats.x402PaidCycles} x402-paid cycles`} tone="good" />
      <MetricCard label="Execution" value={`${stats.armedCycles} / ${stats.executedTrades}`} detail="armed cycles / executed trades" tone={stats.executedTrades > 0 ? "good" : "warn"} />
    </section>
  );
}

function CmcAgentHubShowcase({ feed, stats }: { feed: Feed; stats: FeedStats }) {
  const cmc = computeCmcShowcase(feed);

  return (
    <section className="cmc-showcase" id="cmc-agent-hub" aria-label="CoinMarketCap Agent Hub showcase">
      <div className="cmc-showcase__copy">
        <span className="eyebrow">CoinMarketCap Agent Hub</span>
        <h2>Paid CMC signal is load-bearing, not decoration.</h2>
        <p>
          Scoop buys CMC market perception through x402 before every decision path, hashes the response payloads into
          receipts, and lets the governor stand down unless the paid signal clears risk.
        </p>
        <div className="cmc-showcase__links">
          <a className="button button--primary" href="#proof">Open proof surface</a>
          <a className="button" href="/data/feed.json" target="_blank" rel="noreferrer">Public feed JSON</a>
        </div>
      </div>

      <div className="cmc-showcase__proof">
        <MetricCard label="CMC paid calls" value={formatInteger(cmc.paidCalls)} detail={`${stats.x402PaidCycles} x402-paid cycles`} tone="good" />
        <MetricCard label="Data spend" value={formatUsd(stats.dataSpendUsd, 4)} detail="settled through CMC x402 receipts" tone="good" />
        <MetricCard label="Endpoints" value={formatInteger(cmc.uniqueEndpointCount)} detail={`${formatInteger(cmc.totalCalls)} total CMC call records`} />
        <MetricCard label="Fallbacks" value={formatInteger(cmc.fallbackCalls)} detail="labeled, never hidden" tone={cmc.fallbackCalls > 0 ? "warn" : "good"} />
      </div>

      <article className="cmc-receipt-strip">
        <div>
          <span>Latest paid endpoint</span>
          <strong>{cmc.latestEndpoint}</strong>
        </div>
        <div>
          <span>Latest response hash</span>
          <strong className="mono">{shortHash(cmc.latestResponseHash)}</strong>
        </div>
        <div>
          <span>Agent output</span>
          <strong>{decisionLabel(stats.latest)} after governor checks</strong>
        </div>
      </article>
    </section>
  );
}

function ReadinessLedger({ stats }: { stats: FeedStats }) {
  const latestExecution = stats.latestExecutedTrade;
  const latestTx = latestExecution?.tradeResult?.txHash ?? null;

  return (
    <section className="readiness-ledger" aria-label="Track 1 readiness ledger">
      <div className="readiness-ledger__intro">
        <span className="eyebrow">Track 1 readiness</span>
        <h2>What is proven right now.</h2>
      </div>
      <div className="readiness-list">
        <ReadinessItem
          label="Registered wallet"
          value="Registered"
          detail={`${shortHash(stats.wallet)} submission wallet`}
          href={bscAddressUrl(stats.wallet)}
          tone="good"
        />
        <ReadinessItem
          label="Execution path"
          value={latestTx ? `${stats.executedTrades} signed tx` : "No tx yet"}
          detail={latestExecution ? shortFile(latestExecution.file) : "Armed execution still unproven."}
          href={latestTx ? bscTxUrl(latestTx) : undefined}
          tone={latestTx ? "good" : "warn"}
        />
        <ReadinessItem
          label="Current position"
          value={positionLabel(stats)}
          detail={positionDetail(stats)}
          href={stats.currentPosition?.address ? bscTokenUrl(stats.currentPosition.address) : undefined}
          tone={stats.currentPosition ? "good" : undefined}
        />
        <ReadinessItem
          label="Receipt integrity"
          value={stats.chain.ok ? "Chain valid" : "Chain break"}
          detail={`${stats.chain.count} linked receipts, head ${shortHash(stats.chain.head)}`}
          href={receiptUrl(stats.latest.file)}
          tone={stats.chain.ok ? "good" : "bad"}
        />
      </div>
    </section>
  );
}

function ReadinessItem({
  label,
  value,
  detail,
  href,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );

  if (href) {
    return (
      <a className={`readiness-item ${tone ? `readiness-item--${tone}` : ""}`} href={href} target="_blank" rel="noreferrer">
        {body}
      </a>
    );
  }

  return <div className={`readiness-item ${tone ? `readiness-item--${tone}` : ""}`}>{body}</div>;
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "good" | "warn" }) {
  return (
    <article className={`metric-card ${tone ? `metric-card--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ControlRoom({ feed, stats }: { feed: Feed; stats: FeedStats }) {
  return (
    <section className="section-grid" id="control-room">
      <div className="section-heading">
        <span className="eyebrow">Live control room</span>
        <h2>Track 1 state without guesswork.</h2>
        <p>
          This is the contest operating surface: capital, risk floor, receipt integrity, and whether the agent is observing,
          rehearsing, or trading.
        </p>
      </div>

      <div className="control-layout">
        <article className="panel panel--chart">
          <div className="panel__heading">
            <div>
              <span className="panel-kicker">portfolio path</span>
              <h3>Equity versus governor floor</h3>
            </div>
            <span className={stats.chain.ok ? "badge badge--good" : "badge badge--bad"}>
              {stats.chain.ok ? "browser verified" : `break at ${stats.chain.brokenAt}`}
            </span>
          </div>
          <EquityChart cycles={feed.cycles} />
        </article>

        <aside className="ops-stack">
          <StatusTile label="Mode" value={stats.latest.trade ? "Armed" : "Observe"} detail={stats.latest.trade ? "Trades can execute after governor approval." : "Swaps stay disabled unless a run is explicitly armed."} tone={stats.latest.trade ? "good" : "warn"} />
          <StatusTile label="Open position" value={positionLabel(stats)} detail={positionDetail(stats)} tone={stats.currentPosition ? "good" : undefined} />
          <StatusTile label="In-scope value" value={formatUsd(stats.latest.inScopeUsd)} detail={stats.latest.inScopeWarning ? "Below monitor threshold." : "Eligible asset monitor is healthy."} tone={stats.latest.inScopeWarning ? "bad" : "good"} />
          <StatusTile label="Latest signal" value={signalLabel(stats.latest)} detail={`${formatBps(stats.latest.convictionBps)} via ${stats.latest.provider ?? "local"}`} />
          <StatusTile label="Receipt head" value={shortHash(stats.latest.checksum)} detail={formatDate(stats.latest.at)} mono />
        </aside>
      </div>
    </section>
  );
}

function StatusTile({
  label,
  value,
  detail,
  tone,
  mono,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "warn" | "bad";
  mono?: boolean;
}) {
  return (
    <article className={`status-tile ${tone ? `status-tile--${tone}` : ""}`}>
      <span>{label}</span>
      <strong className={mono ? "mono" : ""}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EquityChart({ cycles }: { cycles: Cycle[] }) {
  const plotted = [...cycles]
    .reverse()
    .filter((cycle) => isNumber(cycle.equityUsd))
    .slice(-72);

  if (plotted.length < 2) {
    return (
      <div className="chart chart--empty">
        <span>Equity chart needs at least two receipts.</span>
      </div>
    );
  }

  const width = 920;
  const height = 330;
  const pad = 34;
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
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Equity and risk floor over recent receipts">
        <defs>
          <linearGradient id="equityGradient" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#37d5ff" />
            <stop offset="100%" stopColor="#73f2a8" />
          </linearGradient>
        </defs>
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

function ProofPanel({ feed, stats }: { feed: Feed; stats: FeedStats }) {
  const latest = stats.latest;
  const latestCalls = latest.paidCalls ?? [];
  const latestExecution = stats.latestExecutedTrade;
  const latestTx = latestExecution?.tradeResult?.txHash ?? null;
  const currentPosition = stats.currentPosition;

  return (
    <section className="section-grid" id="proof">
      <div className="section-heading">
        <span className="eyebrow">Proof surface</span>
        <h2>Verify the agent without trusting the dashboard.</h2>
        <p>
          Scoop exposes the receipt file, chain head, CMC x402 response hashes, registered wallet, and BSC transaction
          proof path from the same public feed the app renders.
        </p>
      </div>

      <div className="proof-grid">
        <article className="proof-card proof-card--wide">
          <span>Latest receipt</span>
          <h3>{shortFile(latest.file)}</h3>
          <dl className="proof-list">
            <div>
              <dt>Receipt file</dt>
              <dd><a href={receiptUrl(latest.file)} target="_blank" rel="noreferrer">{latest.file}</a></dd>
            </div>
            <div>
              <dt>Head checksum</dt>
              <dd className="mono">{latest.checksum ?? "null"}</dd>
            </div>
            <div>
              <dt>Previous checksum</dt>
              <dd className="mono">{latest.prevChecksum ?? "genesis"}</dd>
            </div>
            <div>
              <dt>Browser chain check</dt>
              <dd>{stats.chain.ok ? `${stats.chain.count} linked receipts` : `broken at ${stats.chain.brokenAt}`}</dd>
            </div>
            <div>
              <dt>No-secret verifier</dt>
              <dd><code>npm run receipts:verify</code></dd>
            </div>
          </dl>
        </article>

        <article className="proof-card">
          <span>CMC x402 evidence</span>
          <h3>{latestCalls.length} latest paid calls</h3>
          <dl className="proof-list">
            {latestCalls.length > 0 ? latestCalls.map((call, index) => (
              <div key={`${call.responseHash ?? call.url ?? index}`}>
                <dt>{call.dataSource ?? call.skipped ?? "call"}</dt>
                <dd>{endpointLabel(call.url)}</dd>
                <dd className="mono">{shortHash(call.responseHash)}</dd>
                <dd>{formatUsd(call.costUsd, 4)}</dd>
              </div>
            )) : (
              <div>
                <dt>No paid call</dt>
                <dd>This cycle did not record a CMC x402 response hash.</dd>
              </div>
            )}
          </dl>
        </article>

        <article className="proof-card">
          <span>BSC and TWAK rails</span>
          <h3>{latestTx ? "Execution proof live" : "Awaiting armed tx"}</h3>
          <dl className="proof-list">
            <div>
              <dt>Agent wallet</dt>
              <dd><a href={bscAddressUrl(stats.wallet)} target="_blank" rel="noreferrer">{shortHash(stats.wallet)}</a></dd>
            </div>
            <div>
              <dt>Registration tx</dt>
              <dd><a href={bscTxUrl(REGISTRATION_TX)} target="_blank" rel="noreferrer">{shortHash(REGISTRATION_TX)}</a></dd>
            </div>
            <div>
              <dt>Latest executed tx</dt>
              <dd>
                {latestTx ? (
                  <a href={bscTxUrl(latestTx)} target="_blank" rel="noreferrer">{shortHash(latestTx)}</a>
                ) : (
                  "no executed tx in receipt chain yet"
                )}
              </dd>
            </div>
            <div>
              <dt>Execution receipt</dt>
              <dd>
                {latestExecution ? (
                  <a href={receiptUrl(latestExecution.file)} target="_blank" rel="noreferrer">
                    {shortFile(latestExecution.file)}
                  </a>
                ) : (
                  "no executed receipt yet"
                )}
              </dd>
            </div>
            <div>
              <dt>Open token</dt>
              <dd>
                {currentPosition?.address ? (
                  <a href={bscTokenUrl(currentPosition.address)} target="_blank" rel="noreferrer">
                    {currentPosition.symbol ?? "token"} at {formatUsd(latest.positionUsd)}
                  </a>
                ) : (
                  "flat in latest receipt"
                )}
              </dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  );
}

function AgentLoop({ stats }: { stats: FeedStats }) {
  const steps = [
    {
      title: "Pays CMC",
      body: `${stats.x402PaidCycles} cycles recorded CMC x402-paid market data before making a decision.`,
    },
    {
      title: "Forms one thesis",
      body: `${stats.tradeTheses} trade theses reached the governor; weak output is downgraded before execution.`,
    },
    {
      title: "Governs risk",
      body: `${stats.noTradeCycles} stand-down outcomes are preserved instead of hidden as inactivity.`,
    },
    {
      title: "Signs with TWAK",
      body: stats.executedTrades > 0 ? `${stats.executedTrades} executed trades have BSC tx proof.` : "Execution is wired through TWAK and intentionally unarmed until rehearsal.",
    },
  ];

  return (
    <section className="section-grid" id="loop">
      <div className="section-heading">
        <span className="eyebrow">Agent loop</span>
        <h2>The sponsor stack is in the trade loop.</h2>
        <p>
          Scoop is not a generic chatbot dashboard. Remove CMC x402, Trust Wallet signing, or BNB Chain and the product
          stops working.
        </p>
      </div>
      <div className="loop-grid">
        {steps.map((step, index) => (
          <article className="loop-card" key={step.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function DecisionLog({ cycles }: { cycles: Cycle[] }) {
  return (
    <section className="section-grid" id="receipts">
      <div className="section-heading">
        <span className="eyebrow">Receipt ledger</span>
        <h2>Every cycle is committed before the market grades it.</h2>
        <p>
          The table is the public audit trail: what Scoop paid to know, what it proposed, what the governor allowed, and
          whether a BSC transaction exists.
        </p>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th scope="col">Cycle</th>
              <th scope="col">Outcome</th>
              <th scope="col">Signal</th>
              <th scope="col">Governor</th>
              <th scope="col">Spend</th>
              <th scope="col">Proof</th>
            </tr>
          </thead>
          <tbody>
            {cycles.slice(0, 10).map((cycle) => {
              const label = decisionLabel(cycle);
              return (
                <tr key={cycle.file}>
                  <td>
                    <strong>{formatDate(cycle.at)}</strong>
                    <small>{shortFile(cycle.file)}</small>
                  </td>
                  <td>
                    <span className={`decision-pill ${label !== "NO_TRADE" ? "decision-pill--active" : ""}`}>{label}</span>
                    {cycle.degraded ? <small className="text-bad">degraded data</small> : null}
                  </td>
                  <td>
                    <strong>{signalLabel(cycle)}</strong>
                    <small>{formatBps(cycle.convictionBps)} via {cycle.provider ?? "local"}</small>
                    {cycle.rationale ? <em>{cycle.rationale}</em> : null}
                  </td>
                  <td>
                    <strong>{cycle.governorVerdict ?? "unknown"}</strong>
                    <small>{cycle.governorReason ?? "no reason recorded"}</small>
                  </td>
                  <td>
                    <strong>{cycle.paid ? "x402 paid" : "free/local"}</strong>
                    <small>{cycle.paidCallCount} calls, {formatUsd(cycle.dataSpendUsd, 4)}</small>
                  </td>
                  <td>
                    <strong className="mono">{shortHash(cycle.checksum)}</strong>
                    <small>
                      {cycle.tradeResult?.txHash ? (
                        <a href={bscTxUrl(cycle.tradeResult.txHash)} target="_blank" rel="noreferrer">
                          {shortHash(cycle.tradeResult.txHash)}
                        </a>
                      ) : (
                        "no tx hash"
                      )}
                    </small>
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

function ProofFooter({ stats }: { stats: FeedStats }) {
  const body = stats.executedTrades > 0
    ? "Scoop is public, registered, and has BSC transaction proof in the receipt chain."
    : "Scoop is public and registered. The first armed execution remains the live-readiness gate.";

  return (
    <footer className="footer">
      <div>
        <span className="eyebrow">Submission proof</span>
        <p>{body}</p>
      </div>
      <div className="footer__links">
        <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub repo</a>
        <a href={bscAddressUrl(stats.wallet)} target="_blank" rel="noreferrer">Agent wallet</a>
        <a href={bscTxUrl(REGISTRATION_TX)} target="_blank" rel="noreferrer">Registration tx</a>
      </div>
    </footer>
  );
}

export default App;
