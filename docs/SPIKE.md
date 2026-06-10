# Validation spike results (Jun 10)

Every architecture-critical assumption tested before full build. Verdict: GREEN, Scoop is locked.

| Leg | Result | Proof |
|---|---|---|
| TWAK wallet, local custody | PASS | Wallet created via CLI; key in locally encrypted keystore (`~/.twak/wallet.json`, 0600); password only in local env. Address `0x5927a9662588f5609154488111E8ee7f4075513C`. |
| Local signing + live BSC execution | PASS | Two real swaps signed locally and broadcast through TWAK: 0.0043 BNB -> 2.518 USD1 (`0xbc2456d1142e55678b766242a217e157f57eee025313e4c918d7c4c0a2bfa03a`), 0.0245 BNB -> 14.328 USDT (`0x26d77787a2480dc9105facec9e861beeb284c0c900a716ab172493c968260545`). Provider route: LiquidMesh/0x via TWAK swap. |
| x402 paid perception | PASS | Real paid request to `pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest`: $0.01 World Liberty Financial USD1 on BNB Smart Chain, gasless eip3009, signed by the same agent wallet, valid CMC payload returned. `--yes` flag enables non-interactive cron use. |
| x402 rail question (Codex's review item) | RESOLVED | CMC x402 settles natively on BSC (USD1 default, BSC-USDC/USDT permit2 also offered). No Base purse needed; one wallet pays for data and trades. |
| Swap quoting for the executor | PASS | Quote-only path returns route + minReceived; BEP-20s resolve by contract address via `twak search` (symbol+chain+decimals). |
| Competition contract | PASS (read) / PENDING (tx) | `twak compete status` reads the live contract (registration open, deadline 2026-06-25T00:00Z). The register tx hit a local egress flake to BSC RPC hosts; retry from a clean network or the Actions runner. |
| CMC x402 MCP (narratives/news) | KNOWN LIMITATION | The x402-gated MCP at `mcp.coinmarketcap.com/x402/mcp` lists 12 tools (handshake and tools/list free), but TWAK's x402 client returns HTTP 400 on the PAID retry of POST-with-body requests (GET REST endpoints work). Paid perception therefore uses the four REST x402 endpoints (listings, quotes, dex search, dex pair quotes). Revisit: implement the 402 dance directly, or report upstream to TWAK. |

## Funding state (from $20 / 0.0322 BNB received)
- 2.518 USD1: x402 data purse (~250 paid requests)
- 14.328 USDT: trading capital (in-scope asset for the holding rule)
- ~0.0034 BNB: gas reserve
- Data spent so far: $0.01 (first paid call)
