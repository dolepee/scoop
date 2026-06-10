// The competition's eligible BEP-20 token list, transcribed verbatim from the
// official brief (149 symbols). Trades outside this list do not count toward
// the leaderboard, so the governor enforces it as a hard gate before sizing.
// Symbols are matched case-insensitively after trimming; the two non-ASCII
// entries are kept exactly as published.

export const ELIGIBLE_TOKENS = [
  "ETH", "USDT", "USDC", "XRP", "TRX", "DOGE", "ZEC", "ADA", "LINK", "BCH",
  "DAI", "TON", "USD1", "USDe", "M", "LTC", "AVAX", "SHIB", "XAUt", "WLFI",
  "H", "DOT", "UNI", "ASTER", "DEXE", "USDD", "ETC", "AAVE", "ATOM", "U",
  "STABLE", "FIL", "INJ", "币安人生", "NIGHT", "FET", "TUSD", "BONK", "PENGU",
  "CAKE", "SIREN", "LUNC", "ZRO", "KITE", "FDUSD", "BEAT", "PIEVERSE", "BTT",
  "NFT", "EDGE", "FLOKI", "LDO", "B", "FF", "PENDLE", "NEX", "STG", "AXS",
  "TWT", "HOME", "RAY", "COMP", "GWEI", "XCN", "GENIUS", "XPL", "BAT",
  "SKYAI", "APE", "IP", "SFP", "TAG", "NXPC", "AB", "SAHARA", "1INCH",
  "CHEEMS", "BANANAS31", "RIVER", "MYX", "RAVE", "SNX", "FORM", "LAB", "HTX",
  "USDf", "CTM", "BDX", "SLX", "UB", "DUCKY", "FRAX", "BILL", "WFI", "KOGE",
  "ALE", "FRXUSD", "USDF", "GOMINING", "VCNT", "GUA", "DUSD", "SMILEK", "0G",
  "BEAM", "MY", "SOON", "REAL", "Q", "AIOZ", "ZIG", "YFI", "TAC", "lisUSD",
  "CYS", "ZAMA", "TRIA", "HUMA", "PLUME", "ZIL", "XPR", "ZETA", "BabyDoge",
  "NILA", "ROSE", "VELO", "UAI", "BRETT", "OPEN", "BSB", "TOSHI", "BAS",
  "ACH", "AXL", "LUR", "ELF", "KAVA", "APR", "IRYS", "EURI", "XUSD", "BARD",
  "DUSK", "SUSHI", "PEAQ", "COAI", "BDCA", "XAUM",
];

const NORMALIZED = new Set(ELIGIBLE_TOKENS.map((s) => s.trim().toUpperCase()));

export function isEligible(symbol) {
  return NORMALIZED.has(String(symbol ?? "").trim().toUpperCase());
}

// Stables we treat as parking assets. All are in the eligible list, so
// rotations between them still count as qualifying trades (the compliance
// valve relies on this).
export const PARKING_STABLES = ["USDT", "USDC", "USD1"];
