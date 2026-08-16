/**
 * GET /api/grok-plan?symbol=BTCUSDT&interval=1h
 * Uses xAI Grok when XAI_API_KEY is set; else returns structured local plan.
 */
async function snapshot(symbol, interval) {
  const [kRes, tRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=50`),
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
  ]);
  const klines = await kRes.json();
  const ticker = await tRes.json();
  const closes = klines.map((k) => parseFloat(k[4]));
  const highs = klines.map((k) => parseFloat(k[2]));
  const lows = klines.map((k) => parseFloat(k[3]));
  const price = closes[closes.length - 1];
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const atr = trs.slice(-14).reduce((a, b) => a + b, 0) / Math.min(14, trs.length);
  return {
    symbol,
    interval,
    price,
    atr,
    change24hPct: parseFloat(ticker.priceChangePercent),
    high24h: parseFloat(ticker.highPrice),
    low24h: parseFloat(ticker.lowPrice),
    asOf: new Date().toISOString(),
  };
}

function localPlan(s) {
  const ch = s.change24hPct;
  const bias =
    ch > 1.5 ? "Neutral-Bullish" : ch < -1.5 ? "Neutral-Bearish" : "Neutral";
  const longEntry = s.price;
  const longSl = s.price - 1.5 * s.atr;
  const longTp1 = s.price + 2 * s.atr;
  const longTp2 = s.price + 3 * s.atr;
  return {
    analysis: `${bias} bias on ${s.symbol} (${s.interval}).

24h change ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%. Range $${Math.round(s.low24h).toLocaleString()}–$${Math.round(s.high24h).toLocaleString()}. ATR ≈ ${s.atr.toFixed(2)}.

Long idea: entry ~$${Math.round(longEntry).toLocaleString()}, SL ~$${Math.round(longSl).toLocaleString()}, TP1 ~$${Math.round(longTp1).toLocaleString()}, TP2 ~$${Math.round(longTp2).toLocaleString()}.

Short idea: mirror with 1.5×ATR stop and 2R/3R targets.

Prefer confirmation at range edges. Risk 0.5–1% per idea. Not financial advice.`,
    snapshot: {
      price: s.price,
      change24hPct: s.change24hPct,
      high24h: s.high24h,
      low24h: s.low24h,
    },
    source: "rules",
    generatedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const url = new URL(req.url, "http://localhost");
    const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
    const interval = url.searchParams.get("interval") || "1h";
    const s = await snapshot(symbol, interval);

    const key = process.env.XAI_API_KEY;
    if (!key) {
      return res.status(200).json(localPlan(s));
    }

    const prompt = `You are a trading analyst. Market snapshot for ${symbol}:
Price: $${s.price}
Interval: ${interval}
ATR(14): ${s.atr}
24h change: ${s.change24hPct.toFixed(2)}%
24h high: $${s.high24h}
24h low: $${s.low24h}

Write a concise trading plan (120-200 words): bias, key levels, long and short entry/SL/TP ideas using ATR context, and a risk note. No hype. Not financial advice.`;

    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "grok-3",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("Grok error", err.slice(0, 300));
      return res.status(200).json(localPlan(s));
    }

    const data = await r.json();
    const analysis =
      data.choices?.[0]?.message?.content || localPlan(s).analysis;

    return res.status(200).json({
      analysis,
      snapshot: {
        price: s.price,
        change24hPct: s.change24hPct,
        high24h: s.high24h,
        low24h: s.low24h,
      },
      source: "grok",
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
