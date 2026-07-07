// One-off wallet sweep: send all USDT then sweep BNB to SWEEP_TO on BSC.
// Signs inside CI using the restored TWAK keystore. No key is printed.
// Safety: decrypts the keystore, asserts the derived address matches the
// known agent wallet, and only then broadcasts. Aborts (no send) on mismatch.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { ethers } from 'ethers';

const AGENT = '0x5927a9662588f5609154488111E8ee7f4075513C';
const USDT  = '0x55d398326f99059fF775485246999027B3197955'; // BSC USDT, 18 decimals
const RPC   = process.env.BSC_RPC || 'https://bsc-rpc.publicnode.com';

const rawTo = process.env.SWEEP_TO;
if (!rawTo) throw new Error('SWEEP_TO missing');
const TO = ethers.getAddress(rawTo); // validates checksum/format

const ksJson = readFileSync(`${homedir()}/.twak/wallet.json`, 'utf8');
const password = process.env.TWAK_WALLET_PASSWORD;
if (!password) throw new Error('TWAK_WALLET_PASSWORD missing');

let base;
try {
  base = await ethers.Wallet.fromEncryptedJson(ksJson, password);
} catch (e) {
  console.error('DECRYPT_FAILED (not a standard V3 keystore):', e.shortMessage || e.message);
  console.error('No funds moved. Aborting so the signing path can be adjusted.');
  process.exit(2);
}
if (base.address.toLowerCase() !== AGENT.toLowerCase()) {
  throw new Error(`SAFETY ABORT: keystore address ${base.address} != expected ${AGENT}`);
}

const provider = new ethers.JsonRpcProvider(RPC, 56);
const wallet = base.connect(provider);
console.log('signer :', wallet.address);
console.log('dest   :', TO);

const fee = await provider.getFeeData();
let gasPrice = fee.gasPrice ?? ethers.parseUnits('1', 'gwei');
gasPrice = (gasPrice * 12n) / 10n; // +20% headroom for prompt inclusion
console.log('gasPrice(gwei):', ethers.formatUnits(gasPrice, 'gwei'));

// 1) USDT: send the full balance
const erc20 = new ethers.Contract(USDT, [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)'
], wallet);
const ubal = await erc20.balanceOf(wallet.address);
console.log('USDT balance:', ethers.formatUnits(ubal, 18));
if (ubal > 0n) {
  const tx1 = await erc20.transfer(TO, ubal, { gasPrice });
  console.log('USDT_TX:', tx1.hash);
  const r1 = await tx1.wait();
  console.log('USDT_STATUS:', r1.status, 'block', r1.blockNumber);
} else {
  console.log('no USDT to send');
}

// 2) BNB: sweep balance minus a small gas reserve
const bal = await provider.getBalance(wallet.address);
const gasLimit = 21000n;
const gasCost = gasLimit * gasPrice;
const value = bal - gasCost - (gasCost / 2n);
console.log('BNB balance:', ethers.formatEther(bal));
if (value > 0n) {
  const tx2 = await wallet.sendTransaction({ to: TO, value, gasLimit, gasPrice });
  console.log('BNB_TX:', tx2.hash);
  const r2 = await tx2.wait();
  console.log('BNB_STATUS:', r2.status, 'block', r2.blockNumber, 'sent', ethers.formatEther(value));
} else {
  console.log('BNB too low to sweep after gas');
}
console.log('SWEEP_DONE');
