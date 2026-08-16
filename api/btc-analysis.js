/**
 * GET /api/btc-analysis
 * Returns BTC market snapshot + analysis text.
 * Uses Anthropic if ANTHROPIC_API_KEY is set; otherwise a structured local plan.
 * Edge-cache friendly (4h). Cron can hit with ?secret=CRON_SECRET&refresh=1
 */

async function getBinanceSnapshot() {
  const res = await fetch(
    "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const d = await res.json();
  return {
    price: parseFloat(d.lastPrice),
    change24hPct: parseFloat(d.priceChangePercent),
    high24h: parseFloat(d.highPrice),
    low24h: parseFloat(d.lowPrice),
    volume24h: parseFloat(d.quoteVolume),
    asOf: new Date().toISOString(),
  };
}

function localAnalysis(s) {
  const ch = s.change24hPct;
  const mid = (s.high24h + s.low24h) / 2;
  const range = s.high24h - s.low24h;
  const pos = range > 0 ? (s.price - s.low24h) / range : 0.5;

  let momentum =
    ch > 2
      ? "Bullish momentum over the last 24h — buyers are in control."
      : ch < -2
        ? "Bearish momentum over the last 24h — sellers have the edge."
        : "Sideways / balanced tape over the last 24h — wait for expansion.";

  let levels = `Key range: support near $${Math.round(s.low24h).toLocaleString()} and resistance near $${Math.round(s.high24h).toLocaleString()}. Mid-range ≈ $${Math.round(mid).toLocaleString()}.`;

  let position =
    pos > 0.7
      ? "Price is sitting in the upper third of the 24h range — be careful chasing longs."
      : pos < 0.3
        ? "Price is in the lower third of the 24h range — bounce longs need confirmation; breakdown risk is real."
        : "Price is mid-range — better to trade the edges than the middle.";

  let bias =
    ch > 1.5 ? "Bias: Neutral-Bullish" : ch < -1.5 ? "Bias: Neutral-Bearish" : "Bias: Neutral";

  return `${bias}

${momentum}

${levels}

${position}

Plan: risk only 0.5–1% per idea. Prefer confirmation at range edges over FOMO entries.

Spot: $${s.price.toLocaleString(undefined, { maximumFractionDigits: 0 })} · 24h ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}% · Vol $${(s.volume24h / 1e9).toFixed(2)}B`;
}

async function claudeAnalysis(s) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const prompt = `You are a trading analyst. BTC market snapshot:

Price: $${s.price}
24h change: ${s.change24hPct.toFixed(2)}%
24h high: $${s.high24h}
24h low: $${s.low24h}
24h volume (quote): $${s.volume24h}
As of: ${s.asOf}

Write a concise trading-plan style analysis (150-250 words) covering:
- Current momentum/trend read
- Key levels to watch (support/resistance from the 24h range)
- A balanced risk note 

Factual, no hype.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// Simple process-level cache for warm instances
let cache = null;
const FOUR_H = 4 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const url = new URL(req.url, "http://localhost");
  const secret = url.searchParams.get("secret");
  const refresh = url.searchParams.get("refresh") === "1";
  const cronSecret = process.env.CRON_SECRET;
  const isCron =
    req.headers.authorization === `Bearer ${cronSecret}` ||
    (cronSecret && secret === cronSecret);

  try {
    if (!refresh && !isCron && cache && Date.now() - cache.ts < FOUR_H) {
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
      return res.status(200).json(cache.payload);
    }

    // Protect forced refresh if CRON_SECRET is set
    if ((refresh || isCron) && cronSecret && !isCron && secret !== cronSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const snapshot = await getBinanceSnapshot();
    let analysis;
    let source = "local";
    try {
      const ai = await claudeAnalysis(snapshot);
      if (ai) {
        analysis = ai;
        source = "claude";
      } else {
        analysis = localAnalysis(snapshot);
      }
    } catch (e) {
      analysis = localAnalysis(snapshot);
      source = "local_fallback";
    }

    const payload = {
      analysis,
      snapshot,
      generatedAt: new Date().toISOString(),
      source,
    };
    cache = { ts: Date.now(), payload };
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=14400");
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
