/**
 * GET /api/levels?symbol=BTCUSDT&interval=1h
 * Returns ATR-based entry / SL / TP suggestions from Binance klines.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const url = new URL(req.url, "http://localhost");
    const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
    const interval = url.searchParams.get("interval") || "1h";

    const kRes = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=50`,
      { cache: "no-store" }
    );
    if (!kRes.ok) throw new Error(`Binance klines ${kRes.status}`);
    const klines = await kRes.json();

    const closes = klines.map((k) => parseFloat(k[4]));
    const highs = klines.map((k) => parseFloat(k[2]));
    const lows = klines.map((k) => parseFloat(k[3]));
    const price = closes[closes.length - 1];

    // ATR(14)
    const trs = [];
    for (let i = 1; i < klines.length; i++) {
      const h = highs[i];
      const l = lows[i];
      const pc = closes[i - 1];
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const atrPeriod = 14;
    const atr =
      trs.slice(-atrPeriod).reduce((a, b) => a + b, 0) / Math.min(atrPeriod, trs.length);

    const ema = (arr, n) => {
      const k = 2 / (n + 1);
      let e = arr[0];
      for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
      return e;
    };
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);

    let bias = "Neutral";
    if (price > ema20 && ema20 > ema50) bias = "Bullish";
    else if (price < ema20 && ema20 < ema50) bias = "Bearish";
    else if (price > ema20) bias = "Neutral-Bullish";
    else bias = "Neutral-Bearish";

    const long = {
      entry: Math.round(price * 100) / 100,
      stop: Math.round((price - 1.5 * atr) * 100) / 100,
      tp1: Math.round((price + 2 * atr) * 100) / 100,
      tp2: Math.round((price + 3 * atr) * 100) / 100,
    };
    const short = {
      entry: Math.round(price * 100) / 100,
      stop: Math.round((price + 1.5 * atr) * 100) / 100,
      tp1: Math.round((price - 2 * atr) * 100) / 100,
      tp2: Math.round((price - 3 * atr) * 100) / 100,
    };

    const high24 = Math.max(...highs.slice(-24));
    const low24 = Math.min(...lows.slice(-24));

    return res.status(200).json({
      method: "atr_structure",
      symbol,
      interval,
      price,
      atr: Math.round(atr * 100) / 100,
      bias,
      ema20: Math.round(ema20 * 100) / 100,
      ema50: Math.round(ema50 * 100) / 100,
      range24: { high: high24, low: low24 },
      long,
      short,
      note: "ATR(14) × 1.5 SL · 2R/3R targets.",
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
