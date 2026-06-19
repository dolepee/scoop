# Scoop

Scoop is a self-custody trading agent on BSC that buys its own market intelligence with x402 micropayments, stands aside by default, and chains a receipt for every dollar spent and every trade signed.
Most cycles should refuse to trade; the receipt chain proves those refusals happened before the market graded them.

## Judge This In 60 Seconds

- Live dashboard: https://scoop-livid.vercel.app. It renders `web/public/data/feed.json`, exposes the latest receipt proof, and verifies receipt-chain linkage in the browser.
- On-chain agent registration: [`0x5877f701e471da2ed41b6e0fabcac1c820a8daf8bf4fd5f59538e48709dd73cb`](https://bscscan.com/tx/0x5877f701e471da2ed41b6e0fabcac1c820a8daf8bf4fd5f59538e48709dd73cb).
- Agent wallet: [`0x5927a9662588f5609154488111E8ee7f4075513C`](https://bscscan.com/address/0x5927a9662588f5609154488111E8ee7f4075513C).
- Validation spike: [`docs/SPIKE.md`](docs/SPIKE.md) records a real paid CMC x402 call and two TWAK-signed BSC swaps, including [`0xbc2456d1142e55678b766242a217e157f57eee025313e4c918d7c4c0a2bfa03a`](https://bscscan.com/tx/0xbc2456d1142e55678b766242a217e157f57eee025313e4c918d7c4c0a2bfa03a) and [`0x26d77787a2480dc9105facec9e861beeb284c0c900a716ab172493c968260545`](https://bscscan.com/tx/0x26d77787a2480dc9105facec9e861beeb284c0c900a716ab172493c968260545).
- Armed rehearsal: receipt [`2026-06-18-162321-0518af27ef.json`](receipts/2026-06-18-162321-0518af27ef.json) records a real TWAK-signed BSC compliance buy, tx [`0x626b1f7d22cd2f751ec7f82fcc10853fffe84d27cc9966bc18978f9a1f01c81e`](https://bscscan.com/tx/0x626b1f7d22cd2f751ec7f82fcc10853fffe84d27cc9966bc18978f9a1f01c81e); receipt [`2026-06-19-131859-d595aff9b5.json`](receipts/2026-06-19-131859-d595aff9b5.json) records the matching compliance sell, tx [`0x4436f1bb412160ace53fb2f61498bb3bb9f8d5b5e066172562ba7bd5a328114e`](https://bscscan.com/tx/0x4436f1bb412160ace53fb2f61498bb3bb9f8d5b5e066172562ba7bd5a328114e).
- Local proof: run `npm run receipts:verify`; it recomputes every SHA-256 checksum and every `prevChecksum` link.
- Live proof source: current counts are rendered from [`web/public/data/feed.json`](web/public/data/feed.json) and on the dashboard. Final-audit checkpoint, as of `2026-06-19T15:18:19.881Z`: 102 cycles, 99 paid-mode cycles, 84 CMC x402-paid cycles, 168 paid CMC calls, `$1.96` data spend, 25 proposed `TRADE` theses, 2 armed cycles, 2 executed BSC transactions, equity `14.73`, chain verification `true`.
- Committed governor state is rebaselined to the actual funded equity: baseline `15.01`, peak `15.04`, internal floor `13.536`. The early `20.00` bootstrap receipt remains in history as `firstReceiptEquityUsd`, not the live risk baseline.
- CoinMarketCap special-prize proof is surfaced at `https://scoop-livid.vercel.app/#cmc-agent-hub`: CMC x402 paid cycles, response hashes, endpoints, spend, and fallback labeling are computed from the same public receipt feed.

## One Cycle

```text
CMC x402 perception -> structured thesis -> deterministic governor -> TWAK execution -> chained receipt -> dashboard feed
```

1. Perception: Scoop pays CMC REST x402 endpoints from the same BSC wallet that trades. Calls settle in USD1 on BSC through TWAK. If a paid call fails and `CMC_API_KEY` exists, the receipt records the free-tier fallback source instead.
2. Thesis: an LLM writes one structured proposal with action, symbol, direction, conviction, rationale, and invalidation. It never has execution authority.
3. Governor: deterministic code applies the drawdown floor, conviction gate, token eligibility, daily risk cap, degraded-read veto, and daily compliance rule.
4. Execution: only `src/executor.mjs` can swap, and it only calls the TWAK swap interface on BSC spot markets.
5. Receipt: every cycle writes canonical JSON into `receipts/`, embeds the previous checksum, and updates `web/public/data/feed.json` for the dashboard.

## Rules Compliance

| Official rule | Scoop mechanism |
| --- | --- |
| At least 1 trade per day | Armed-only compliance trades open from 12:00 UTC if no trade has executed that day, use minimal buy/sell behavior, are tagged `complianceTrade`, and still pass through the governor. Rehearsal has executed a Jun 18 compliance buy and a Jun 19 compliance sell. |
| Fixed 149-token eligible list | `data/eligible_tokens.json` stores all 149 symbols and BSC addresses with provenance; `src/allowlist.mjs` fails closed. |
| Max drawdown risk gate | The ratchet governor stands down well before the competition DQ line; the committed live floor is `13.536` against funded baseline `15.01`. |
| Non-zero in-scope balance | Each feed cycle carries `inScopeUsd`; final-audit checkpoint value is `14.73`, warning flag `false`, as of `2026-06-19T15:18:19.881Z`. |
| TWAK execution | The executor has no non-TWAK swap path; live swaps in [`docs/SPIKE.md`](docs/SPIKE.md) were signed locally through TWAK. |

## Submission Values

| Field | Value |
| --- | --- |
| Track | Track 1: Autonomous Trading Agents |
| Public repo | https://github.com/dolepee/scoop |
| Live app | https://scoop-livid.vercel.app |
| Agent wallet / DoraHacks address | `0x5927a9662588f5609154488111E8ee7f4075513C` |
| Registration transaction | `0x5877f701e471da2ed41b6e0fabcac1c820a8daf8bf4fd5f59538e48709dd73cb` |
| CMC proof surface | https://scoop-livid.vercel.app/#cmc-agent-hub |
| Latest executed BSC transaction | `0x4436f1bb412160ace53fb2f61498bb3bb9f8d5b5e066172562ba7bd5a328114e` |
| Demo video | Optional per rules; the README and live dashboard are the primary proof surfaces. |

## Best TWAK Use

Scoop uses TWAK as the load-bearing self-custody layer:

- Wallet creation and local encrypted keystore: validated in [`docs/SPIKE.md`](docs/SPIKE.md).
- Swap quoting and execution: `twak swap --quote-only` for quotes; `twak swap` for live BSC spot execution.
- x402 request and payment rail: `twak x402 request` pays CMC REST endpoints from the agent wallet on BSC using gasless eip3009.
- Competition registration/status: `twak compete status` reads the live registration contract; registration tx is linked above.

Known limitation: TWAK's x402 client returned HTTP 400 on the paid retry for POST-body MCP tool calls. Scoop keeps that documented and uses the CMC REST x402 endpoints instead. That is useful product feedback, not a hidden fallback.

## Architecture

| File | Role |
| --- | --- |
| `src/cycle.mjs` | One full perceive -> think -> govern -> execute -> receipt cycle. |
| `src/scout-rest.mjs` | Paid CMC REST x402 perception, budget caps, and free-tier fallback labeling. |
| `src/thesis.mjs` | Structured LLM proposal; hashes prompt context and returns at most one action. |
| `src/governor.mjs` | Pure ratchet risk engine, eligibility gate, midday compliance fallback, and veto reasons. |
| `src/compliance.mjs` | Minimal daily trade selector for the armed competition week. |
| `src/executor.mjs` | TWAK-only token resolution, quote, balance, and swap calls. |
| `src/receipts.mjs` | Canonical JSON hashing, receipt writing, and chain verification. |
| `src/buildFeed.mjs` | Converts receipts into `web/public/data/feed.json` for the dashboard. |
| `web/` | Single-page dashboard that reads the public feed and verifies linkage client-side. |

## Run It

```bash
npm ci
npm test
npm run receipts:verify
npm run build:feed
```

| Env var | Purpose |
| --- | --- |
| `TWAK_ACCESS_ID` | TWAK API access identifier. |
| `TWAK_HMAC_SECRET` | TWAK API signing secret. |
| `TWAK_WALLET_PASSWORD` | Unlocks the local TWAK keystore. |
| `TWAK_WALLET_JSON_B64` | GitHub Actions secret used to restore the encrypted keystore. |
| `BANKR_LLM_KEY` | Enables live structured thesis generation. |
| `SCOOP_LLM_MODEL` | Optional model override. |
| `SCOOP_PAID` | `1` enables paid x402 perception. |
| `SCOOP_TRADE` | `1` arms real swaps; unset means observe-only receipts. |
| `SCOOP_DATA_CAP_USD` | Per-cycle data spend cap. |
| `CMC_API_KEY` | Optional free-tier fallback if paid CMC x402 fails. |

Observe mode: `npm run cycle:paid` buys data and writes receipts without real swaps.
Armed mode: `npm run cycle:live` enables TWAK swaps and should be used only for rehearsal/scored windows.
GitHub Actions runs `.github/workflows/scoop-cycle.yml` hourly, verifies the public receipt head before and after each cycle, rebuilds the feed, and commits new receipts only if `origin/master` did not move during the run. A local dispatcher, if used, must call the same cycle path and must not bypass `npm run receipts:verify`.

Live trading switch: observe mode is the default. Manual dispatch with `trade=1` arms one run. For the scored week, set the repository variable `SCOOP_TRADE_LIVE=1` only after confirming wallet funding, gas reserve, current dashboard deployment, and the latest receipt head.

## Phases

| Date | Phase | Status |
| --- | --- | --- |
| Jun 10-18, 2026 | Observation build | Paid CMC x402 data, receipt chain, dashboard, and governor exercising in observe mode. |
| Jun 18-20, 2026 | Armed rehearsal | Rehearsal executed one minimal LAB compliance buy and the matching compliance sell on BSC. Final-audit checkpoint has 102 valid receipts and 2 executed trades; the governor state is rebaselined to actual funded equity. |
| Jun 22-28, 2026 | Scored trading week | Planned hands-off BSC trading window. |

## Receipt Integrity

Each receipt is canonicalized, hashed with SHA-256, and stores the previous receipt's checksum. `npm run receipts:verify` recomputes every checksum and confirms the chain head:

```text
SCOOP_RECEIPT_CHAIN_VALID
```

The dashboard repeats the same linkage check in the browser, so a judge can see whether the public feed is internally consistent without trusting this README.

Transparent build-phase notes: commit `254bde6` rechained early receipts after fixing a JSON round-trip checksum asymmetry, before go-live. On Jun 16, a pre-live workflow-dispatch fork produced two receipts from the same previous checksum; the later receipt was rechained and the workflow was hardened to pull, verify, and guard origin head before committing. Policy for the scored trading window: no rechain; bad receipts get corrected by a new receipt and a new commit, not by rewriting history.
