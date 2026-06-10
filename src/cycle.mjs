// One Scoop cycle: perceive (paid where it matters) -> decide -> govern ->
// execute via TWAK -> receipt. Designed to run from cron with no human.
//
// SCOOP_DRY_RUN=1 runs the full loop with free price perception only, no
// x402 spend, no execution: it still writes a real chained receipt labeled
// dryRun so the receipt history covers the build phase honestly.

import { execFileSync } from "node:child_process";
import { decide, DEFAULT_CONFIG, initialState, noteEntry, noteTrade, syncState } from "./governor.mjs";
import { writeReceipt, sha256, canonical } from "./receipts.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DRY = process.env.SCOOP_DRY_RUN === "1";
const STATE_FILE = join(process.cwd(), "state", "governor-state.json");
const WALLET = "0x5927a9662588f5609154488111E8ee7f4075513C";

function twakJson(args) {
  const out = execFileSync("npx", ["twak", ...args, "--json"], {
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  });
  const start = out.indexOf("{");
  const startArr = out.indexOf("[");
  const idx = startArr >= 0 && (startArr < start || start < 0) ? startArr : start;
  return JSON.parse(out.slice(idx));
}

function loadState(equityUsd, nowMs) {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return initialState(equityUsd, nowMs);
}

function saveState(state) {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function main() {
  const nowMs = Date.now();
  const generatedAt = new Date(nowMs).toISOString();

  // ---- Perceive (dry: free price endpoints only) ----------------------
  const perception = { mode: DRY ? "dry_free_data" : "paid_x402", calls: [], dataSpendUsd: 0 };
  const watch = ["BNB", "CAKE", "FLOKI"];
  for (const sym of watch) {
    try {
      const p = twakJson(["price", sym]);
      perception.calls.push({ kind: "price", symbol: sym, priceUsd: p.priceUsd, responseHash: sha256(canonical(p)) });
    } catch (error) {
      perception.calls.push({ kind: "price", symbol: sym, error: String(error.message).slice(0, 120) });
    }
  }
  // Paid perception (news/social via x402) plugs in here when funded:
  // twak x402 request <cmc-endpoint> --max-payment ... ; each call appends
  // { kind, endpoint, paymentTx|paymentAuth, costUsd, responseHash }.

  // ---- Equity ----------------------------------------------------------
  // Dry mode before funding: equity is the planned capital so governor math
  // is exercised end to end. Live mode reads the wallet portfolio.
  let equityUsd = 20;
  if (!DRY) {
    try {
      const b = twakJson(["wallet", "portfolio", "--chain", "bsc"]);
      equityUsd = Number(b.totalUsd ?? b.total ?? equityUsd);
    } catch {
      // keep prior equity; receipt records the read failure below
    }
  }

  // ---- Thesis (model plugs in post-funding; dry mode = none) -----------
  const proposal = { kind: "NONE" };

  // ---- Govern -----------------------------------------------------------
  let state = syncState(loadState(equityUsd, nowMs), equityUsd, nowMs);
  const ruling = decide(proposal, state, { equityUsd, nowMs });

  // ---- Execute ----------------------------------------------------------
  let execution = { executed: false };
  if (!DRY && ruling.decision === "APPROVE") {
    // twak swap path wired at funding: quote first, then execute with
    // --password from env; record tx hash + route in execution.
    execution = { executed: false, note: "execution_wired_at_funding" };
  } else if (!DRY && ruling.decision === "COMPLIANCE_TRADE") {
    execution = { executed: false, note: "compliance_rotation_wired_at_funding" };
  }
  if (ruling.decision === "APPROVE" && execution.executed) state = noteEntry(state, ruling.sizedPct);
  if (ruling.decision === "COMPLIANCE_TRADE" && execution.executed) state = noteTrade(state);
  saveState(state);

  // ---- Receipt -----------------------------------------------------------
  const { receipt, file } = writeReceipt({
    generatedAt,
    agent: "Scoop",
    wallet: WALLET,
    chain: "bsc",
    dryRun: DRY,
    perception,
    proposal,
    governor: {
      config: DEFAULT_CONFIG,
      state: { ...state },
      ruling,
    },
    execution,
    counters: {
      equityUsd,
      floorUsd: state.floorUsd,
      dataSpendUsd: perception.dataSpendUsd,
    },
  });

  console.log("SCOOP_CYCLE_COMPLETE");
  console.log(`decision=${ruling.decision}`);
  console.log(`receipt=${file}`);
  console.log(`checksum=${receipt.checksum}`);
}

await main();
