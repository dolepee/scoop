// Read-only diagnostic: identify the keystore format and the twak command
// surface so the sweep can sign correctly. Prints NO key material, moves NO funds.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const raw = readFileSync(`${homedir()}/.twak/wallet.json`, 'utf8');
console.log('DIAG bytes:', raw.length, '| first-brace:', raw.trimStart().startsWith('{'), '| char0:', raw.charCodeAt(0));

let j = null;
try {
  j = JSON.parse(raw);
  console.log('DIAG JSON top-level keys:', JSON.stringify(Object.keys(j)));
} catch (e) {
  console.log('DIAG not JSON:', e.message);
  try {
    const d2 = Buffer.from(raw, 'base64').toString('utf8');
    const brace = d2.trimStart().startsWith('{');
    console.log('DIAG 2nd-decode first-brace:', brace, '| keys:', brace ? JSON.stringify(Object.keys(JSON.parse(d2))) : 'n/a');
  } catch (e2) {
    console.log('DIAG 2nd-decode failed:', e2.message);
  }
}
if (j) {
  if (j.crypto) console.log('DIAG crypto keys:', JSON.stringify(Object.keys(j.crypto)));
  if (j.Crypto) console.log('DIAG Crypto(caps) keys:', JSON.stringify(Object.keys(j.Crypto)));
  console.log('DIAG version:', j.version, '| type:', j.type ?? '-', '| address field present:', !!(j.address || j.activeAccounts || j.accounts));
}

for (const c of ['--help', 'send --help', 'transfer --help', 'withdraw --help', 'account --help']) {
  try {
    const o = execSync(`npx twak ${c} 2>&1 | head -30`, { encoding: 'utf8', timeout: 120000 });
    console.log(`\n### twak ${c} ###\n` + o.slice(0, 1500));
  } catch (e) {
    console.log(`\n### twak ${c} ### ERR: ` + String(e.stdout || e.message).slice(0, 200));
  }
}
