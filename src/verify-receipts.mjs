import { verifyChain } from "./receipts.mjs";

const result = verifyChain();
console.log(JSON.stringify(result, null, 2));
if (!result.valid) {
  console.error("SCOOP_RECEIPT_CHAIN_INVALID");
  process.exit(1);
}
console.log("SCOOP_RECEIPT_CHAIN_VALID");
