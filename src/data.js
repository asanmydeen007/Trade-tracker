export const TRADES = [
  { id: "1", name: "Silver", pair: "Silver", pnl: -400, date: "2026-08-16" },
  { id: "2", name: "Sui", pair: "Sui", pnl: -40, date: "2026-08-15" },
  { id: "3", name: "Silver", pair: "Silver", pnl: -15, date: "2026-08-15" },
  { id: "4", name: "Eth", pair: "Eth", pnl: 15, date: "2026-08-15" },
  { id: "5", name: "Solana", pair: "Solana", pnl: 10, date: "2026-08-15" },
  { id: "6", name: "BTC Short", pair: "Bitcoin", pnl: 39, date: "2026-08-14" },
  { id: "7", name: "BTC", pair: "Bitcoin", pnl: 20, date: "2026-08-14" },
];

export const PAIR_COLORS = {
  Bitcoin: "#f7931a",
  Eth: "#627eea",
  Solana: "#9945ff",
  Sui: "#4da2ff",
  Silver: "#a8a29e",
  Gold: "#eab308",
  XRP: "#23292f",
};

// Official / high-quality icons from public CDNs
export const PAIR_ICONS = {
  Bitcoin: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  Eth: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  Solana: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
  Sui: "https://assets.coingecko.com/coins/images/26375/small/sui-ocean-square.png",
  XRP: "https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png",
  // Metals
  Silver: null,
  Gold: null,
};

export const SECTIONS = [
  { id: "crypto", label: "Crypto", icon: "₿" },
  { id: "us-stocks", label: "US Stocks", icon: "🇺🇸" },
  { id: "indian", label: "Indian Stocks", icon: "🇮🇳" },
  { id: "forex", label: "Forex", icon: "💱" },
  { id: "news", label: "News", icon: "📰" },
  { id: "plan", label: "Trading Plan", icon: "📋" },
];
