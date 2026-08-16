/**
 * GET /api/grok-plan?symbol=BTCUSDT&interval=1h
 * Uses xAI Responses API (grok-4.6) when XAI_API_KEY is set.
 */
function num(n, d = 2) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

async function market(symbol, interval) {
  const [kRes, tRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=50`),
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
  ]);
  if (!kRes.ok) throw new Error(`klines ${kRes.status}`);
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
  const ema = (arr, n) => {
    const k = 2 / (n + 1);
    let e = arr[0];
    for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  };
  return {
    symbol,
    interval,
    price,
    atr,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    change24hPct: parseFloat(ticker.priceChangePercent),
    high24h: parseFloat(ticker.highPrice),
    low24h: parseFloat(ticker.lowPrice),
    volume24h: parseFloat(ticker.quoteVolume),
  };
}

function grokStyleLocal(s) {
  const above20 = s.price > s.ema20;
  const above50 = s.price > s.ema50;
  let stance = "No clear edge — wait.";
  if (above20 && above50 && s.change24hPct > 0) stance = "Trend leans long; buy dips, don't chase.";
  else if (!above20 && !above50 && s.change24hPct < 0) stance = "Trend leans short; sell rips, don't panic dump.";
  else if (above20 && !above50) stance = "Short-term bounce inside a softer bigger picture.";
  else stance = "Mixed signals — size down or stand aside.";

  const longSl = s.price - 1.2 * s.atr;
  const longTp = s.price + 2.5 * s.atr;
  const shortSl = s.price + 1.2 * s.atr;
  const shortTp = s.price - 2.5 * s.atr;
  const pos = (s.price - s.low24h) / Math.max(s.high24h - s.low24h, 1e-9);

  return {
    analysis: `Grok take on ${s.symbol} (${s.interval})

${stance}

Tape: last $${num(s.price, s.price < 10 ? 4 : 2)} · 24h ${s.change24hPct >= 0 ? "+" : ""}${s.change24hPct.toFixed(2)}% · vol $${(s.volume24h / 1e9).toFixed(2)}B
EMA20 $${num(s.ema20)} vs EMA50 $${num(s.ema50)} · price is ${above20 ? "above" : "below"} EMA20
Sitting ${Math.round(pos * 100)}% up the 24h range ($${num(s.low24h)}–$${num(s.high24h)})

If long: invalidation under $${num(longSl)} · first target $${num(longTp)} (~2.5×ATR)
If short: invalidation over $${num(shortSl)} · first target $${num(shortTp)}

One rule: if price is stuck mid-range, skip. Edges only. Risk small.

(Not financial advice. Local plan until XAI_API_KEY has credits.)`,
    snapshot: {
      price: s.price,
      change24hPct: s.change24hPct,
      high24h: s.high24h,
      low24h: s.low24h,
    },
    source: "grok-local",
    generatedAt: new Date().toISOString(),
  };
}

function extractText(data) {
  // Responses API shapes vary; try common fields
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  if (typeof data?.text === "string" && data.text.trim()) return data.text;
  if (Array.isArray(data?.output)) {
    const parts = [];
    for (const item of data.output) {
      if (typeof item?.content === "string") parts.push(item.content);
      else if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === "string") parts.push(c.text);
          else if (typeof c === "string") parts.push(c);
        }
      } else if (typeof item?.text === "string") parts.push(item.text);
    }
    if (parts.length) return parts.join("\n");
  }
  if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const url = new URL(req.url, "http://localhost");
    const symbol = (url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
    const interval = url.searchParams.get("interval") || "1h";
    const s = await market(symbol, interval);
    const key = process.env.XAI_API_KEY;

    if (!key) {
      return res.status(200).json(grokStyleLocal(s));
    }

    const prompt = `You are Grok, built by xAI. Give a sharp, practical trading read for the CURRENT market — not generic filler.

Market (live):
- Symbol: ${symbol}
- Timeframe context: ${interval} structure
- Price: $${s.price}
- 24h change: ${s.change24hPct.toFixed(2)}%
- 24h high/low: $${s.high24h} / $${s.low24h}
- ATR(14): ${s.atr}
- EMA20: ${s.ema20}
- EMA50: ${s.ema50}
- 24h quote volume: $${s.volume24h}

Write 140-220 words:
1) Your bias in one line
2) What the tape is doing right now
3) Concrete long idea (entry zone, stop, target) OR say skip
4) Concrete short idea (entry zone, stop, target) OR say skip
5) One risk rule

Be direct. No hype. Not financial advice.`;

    // Prefer Responses API (grok-4.6), fallback to chat completions
    let analysis = null;

    const resp = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "grok-4.6",
        input: prompt,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      analysis = extractText(data);
    } else {
      const errBody = await resp.text();
      // fallback chat completions
      const chat = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "grok-3",
          temperature: 0.5,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (chat.ok) {
        const data = await chat.json();
        analysis = data.choices?.[0]?.message?.content || null;
      } else {
        console.error("xAI error", resp.status, errBody.slice(0, 300));
      }
    }

    if (!analysis) return res.status(200).json(grokStyleLocal(s));

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
