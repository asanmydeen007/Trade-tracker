/**
 * GET /api/metals
 * Live Gold (XAU) & Silver (XAG) + USD/INR, per-gram prices, S/R insight.
 */
const OZ_TO_GRAM = 31.1034768;

async function yahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`yahoo ${symbol} ${r.status}`);
  const d = await r.json();
  const res = d.chart?.result?.[0];
  if (!res) throw new Error(`no data ${symbol}`);
  const m = res.meta;
  const closes = (res.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const price = m.regularMarketPrice;
  const prev = closes.length >= 2 ? closes[closes.length - 2] : price;
  const change24hPct = prev ? ((price - prev) / prev) * 100 : 0;
  const high24h = m.regularMarketDayHigh || Math.max(...closes.slice(-2));
  const low24h = m.regularMarketDayLow || Math.min(...closes.slice(-2));
  return {
    price,
    prevClose: prev,
    change24hPct,
    high24h,
    low24h,
    week52High: m.fiftyTwoWeekHigh,
    week52Low: m.fiftyTwoWeekLow,
  };
}

function insight(name, s) {
  const range = Math.max(s.high24h - s.low24h, 1e-9);
  const pos = (s.price - s.low24h) / range;
  const support = Math.round(s.low24h * 100) / 100;
  const resistance = Math.round(s.high24h * 100) / 100;
  const mid = Math.round(((s.high24h + s.low24h) / 2) * 100) / 100;

  let bias = "Neutral";
  let action = "Wait for a clearer edge near range extremes.";
  if (pos <= 0.25) {
    bias = "Near support — buy zone";
    action = `Price is in the lower 25% of today's range. Prefer buys near support ~$${support}. Avoid chasing if it breaks below.`;
  } else if (pos >= 0.75) {
    bias = "Near resistance — sell / caution";
    action = `Price is in the upper 25% of today's range. Prefer sells or partial profits near resistance ~$${resistance}. Be careful buying here.`;
  } else if (s.change24hPct > 1.2) {
    bias = "Bullish momentum";
    action = `Strong up-day. Look for pullbacks toward $${mid} rather than FOMO entries at highs.`;
  } else if (s.change24hPct < -1.2) {
    bias = "Bearish momentum";
    action = `Soft session. Bounce shorts into $${mid}–$${resistance}, or wait for support hold at $${support}.`;
  } else {
    action = `Mid-range. Better to trade edges: support $${support}, resistance $${resistance}.`;
  }

  return { bias, action, support, resistance, mid, rangePositionPct: Math.round(pos * 100) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const [gold, silver, fx] = await Promise.all([
      yahoo("GC=F"),
      yahoo("SI=F"),
      fetch("https://api.exchangerate-api.com/v4/latest/USD", { cache: "no-store" }).then((r) =>
        r.json()
      ),
    ]);

    const usdInr = fx?.rates?.INR || 95.5;

    // India board rates (ex-GST) sit above pure international spot due to local premium.
    // Soft indicative uplift so gram rates read closer to Indian boards (without GST).
    const INDIA_PREMIUM = { Gold: 0.045, Silver: 0.18 };

    const pack = (name, symbol, s) => {
      const perGramUsd = s.price / OZ_TO_GRAM;
      const perGramInrSpot = perGramUsd * usdInr;
      const premium = INDIA_PREMIUM[name] || 0.05;
      const perGramInrIndia = perGramInrSpot * (1 + premium);
      const ozInr = s.price * usdInr;
      return {
        name,
        symbol,
        unit: "USD per troy ounce",
        priceUsd: s.price,
        priceInr: ozInr,
        change24hPct: s.change24hPct,
        high24h: s.high24h,
        low24h: s.low24h,
        perGramUsd,
        perGramInr: perGramInrSpot,
        perGramInrIndia,
        per10gInrIndia: perGramInrIndia * 10,
        indiaPremiumPct: Math.round(premium * 100),
        insight: insight(name, s),
      };
    };

    return res.status(200).json({
      usdInr,
      gold: pack("Gold", "XAU", gold),
      silver: pack("Silver", "XAG", silver),
      asOf: new Date().toISOString(),
      note: "Futures-based spot proxy (GC=F / SI=F). 1 troy oz = 31.1035 g. Not financial advice.",
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
