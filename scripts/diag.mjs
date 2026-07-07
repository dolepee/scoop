// Read-only: dump full twak help + balances so the sweep uses the exact flags.
// No password used here, no funds moved.
import { execSync } from 'node:child_process';
const W = '0x5927a9662588f5609154488111E8ee7f4075513C';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const run = (c) => { try { return execSync(`npx twak ${c} 2>&1`, { encoding: 'utf8', timeout: 120000 }); } catch (e) { return String(e.stdout || e.message); } };
console.log('=== twak --help ===\n' + run('--help'));
console.log('=== twak transfer --help ===\n' + run('transfer --help'));
console.log('=== twak balance --help ===\n' + run('balance --help'));
console.log('=== native balance bsc ===\n' + run(`balance --chain bsc --address ${W}`));
console.log('=== usdt balance bsc ===\n' + run(`balance --chain bsc --address ${W} --token ${USDT}`));
