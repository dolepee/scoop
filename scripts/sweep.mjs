// One-off sweep: send all USDT then sweep BNB to SWEEP_TO on BSC, signed via
// the twak CLI (Trust Wallet Agent Kit). Password comes from TWAK_WALLET_PASSWORD.
// --confirm-to pins the destination so a resolution surprise cannot redirect funds.
import { spawnSync } from 'node:child_process';

const W = '0x5927a9662588f5609154488111E8ee7f4075513C';     // agent wallet
const USDT_ADDR = '0x55d398326f99059fF775485246999027B3197955'; // BSC USDT (BEP20)
const NATIVE_ASSET = 'c20000714';                            // BNB Smart Chain native
const USDT_ASSET = `c20000714_t${USDT_ADDR}`;                // BEP20 USDT asset id
const RESERVE_BNB = 0.0003;                                  // leave for gas

const DEST = process.env.SWEEP_TO;
if (!DEST || !/^0x[0-9a-fA-F]{40}$/.test(DEST)) throw new Error(`bad SWEEP_TO: ${DEST}`);

function twak(args) {
  const res = spawnSync('npx', ['twak', ...args], { encoding: 'utf8', timeout: 180000, env: process.env });
  return ((res.stdout || '') + (res.stderr || ''));
}
function twakJson(args) {
  const out = twak([...args, '--json']);
  const i = out.indexOf('{'), j = out.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('twak returned no JSON: ' + out.slice(0, 300));
  return JSON.parse(out.slice(i, j + 1));
}
function numFrom(b) {
  for (const k of ['total', 'available', 'balance', 'amount', 'value']) {
    if (b && b[k] != null && !isNaN(Number(b[k]))) return Number(b[k]);
  }
  if (b && b.balance && typeof b.balance === 'object') return numFrom(b.balance);
  return NaN;
}
const hashOf = (r) => r.hash || r.txHash || r.transactionHash || (r.tx && r.tx.hash) || JSON.stringify(r).slice(0, 240);
const floor6 = (n) => Math.floor(n * 1e6) / 1e6;

console.log('dest:', DEST);
try { console.log('validate:', JSON.stringify(twakJson(['validate', '--address', DEST])).slice(0, 200)); }
catch (e) { console.log('validate err:', e.message); }

// 1) USDT — full balance
const ub = twakJson(['balance', '--chain', 'bsc', '--address', W, '--token', USDT_ADDR]);
const usdt = floor6(numFrom(ub));
console.log('USDT balance:', numFrom(ub), '| raw:', JSON.stringify(ub).slice(0, 200));
if (usdt > 0) {
  const r = twakJson(['transfer', '--to', DEST, '--confirm-to', DEST, '--token', USDT_ASSET, '--amount', String(usdt)]);
  console.log('USDT_TX:', hashOf(r));
} else {
  console.log('no USDT to send (parsed', usdt, ')');
}

// 2) BNB — sweep minus gas reserve (read AFTER the USDT tx so gas is accounted)
const nb = twakJson(['balance', '--chain', 'bsc', '--address', W]);
const bnb = numFrom(nb);
const send = floor6(bnb - RESERVE_BNB);
console.log('BNB balance:', bnb, '| raw:', JSON.stringify(nb).slice(0, 200));
if (send > 0) {
  const r = twakJson(['transfer', '--to', DEST, '--confirm-to', DEST, '--token', NATIVE_ASSET, '--amount', String(send)]);
  console.log('BNB_TX:', hashOf(r));
} else {
  console.log('BNB too low to sweep after reserve');
}
console.log('SWEEP_DONE');
