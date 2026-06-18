# Validation spike results (Jun 10)

Every architecture-critical assumption tested before full build. Verdict: GREEN, Scoop is locked.

| Leg | Result | Proof |
|---|---|---|
| TWAK wallet, local custody | PASS | Wallet created via CLI; key in locally encrypted keystore (`~/.twak/wallet.json`, 0600); password only in local env. Address `0x5927a9662588f5609154488111E8ee7f4075513C`. |
| Local signing + live BSC execution | PASS | Two real swaps signed locally and broadcast through TWAK: 0.0043 BNB -> 2.518 USD1 (`0xbc2456d1142e55678b766242a217e157f57eee025313e4c918d7c4c0a2bfa03a`), 0.0245 BNB -> 14.328 USDT (`0x26d77787a2480dc9105facec9e861beeb284c0c900a716ab172493c968260545`). Provider route: LiquidMesh/0x via TWAK swap. |
| Normal-path armed rehearsal | PASS | Manual GitHub Actions dispatch with `trade=1` ran the standard cycle path, produced `COMPLIANCE_BUY`, and signed a real LAB buy on BSC: `0x626b1f7d22cd2f751ec7f82fcc10853fffe84d27cc9966bc18978f9a1f01c81e`. |
| x402 paid perception | PASS | Real paid request to `pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest`: $0.01 World Liberty Financial USD1 on BNB Smart Chain, gasless eip3009, signed by the same agent wallet, valid CMC payload returned. `--yes` flag enables non-interactive cron use. |
| x402 rail question (Codex's review item) | RESOLVED | CMC x402 settles natively on BSC (USD1 default, BSC-USDC/USDT permit2 also offered). No Base purse needed; one wallet pays for data and trades. |
| Swap quoting for the executor | PASS | Quote-only path returns route + minReceived; BEP-20s resolve by contract address via `twak search` (symbol+chain+decimals). |
| Competition contract | PASS | Registration is on-chain for agent wallet `0x5927a9662588f5609154488111E8ee7f4075513C`: `0x5877f701e471da2ed41b6e0fabcac1c820a8daf8bf4fd5f59538e48709dd73cb`. |
| CMC x402 MCP (narratives/news) | KNOWN LIMITATION | The x402-gated MCP at `mcp.coinmarketcap.com/x402/mcp` lists 12 tools (handshake and tools/list free), but TWAK's x402 client returns HTTP 400 on the PAID retry of POST-with-body requests (GET REST endpoints work). Paid perception therefore uses the four REST x402 endpoints (listings, quotes, dex search, dex pair quotes). Revisit: implement the 402 dance directly, or report upstream to TWAK. |

## Funding state (from $20 / 0.0322 BNB received)
- Latest public receipt as of 2026-06-18T16:23:21.596Z: 15.09 in-scope USD value, with 14.31 USDT and 0.78 USD1 recorded before the LAB compliance buy settled.
- Current gas reserve remains thin at roughly 0.0034 BNB and must be checked before any armed run.
- Data spent through the public receipt chain as of 2026-06-18T16:23:21.596Z: about $1.68 across 85 paid-mode cycles, including 70 x402-paid cycles.
