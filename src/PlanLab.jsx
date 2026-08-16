import { useEffect, useState, useCallback } from "react";

const PAIRS = [
  { id: "BTCUSDT", label: "BTC", notion: "Bitcoin" },
  { id: "ETHUSDT", label: "ETH", notion: "Eth" },
  { id: "SOLUSDT", label: "SOL", notion: "Solana" },
  { id: "XRPUSDT", label: "XRP", notion: "XRP" },
];

const TFS = ["15m", "1h", "4h", "1d"];

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 });
}

function buildStructurePlan(symbol, interval, klines) {
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
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  let bias = "Neutral";
  if (price > ema20 && ema20 > ema50) bias = "Bullish";
  else if (price < ema20 && ema20 < ema50) bias = "Bearish";
  else if (price > ema20) bias = "Neutral-Bullish";
  else bias = "Neutral-Bearish";

  const long = {
    entry: price,
    stop: price - 1.5 * atr,
    tp1: price + 2 * atr,
    tp2: price + 3 * atr,
  };
  const short = {
    entry: price,
    stop: price + 1.5 * atr,
    tp1: price - 2 * atr,
    tp2: price - 3 * atr,
  };

  return {
    symbol,
    interval,
    price,
    atr,
    bias,
    ema20,
    ema50,
    long,
    short,
    note: `ATR(14)×1.5 SL · 2R/3R targets · ${interval}. Risk 0.5–1%. Not financial advice.`,
    updatedAt: new Date().toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }),
  };
}

function buildAiText(plan, ticker24) {
  const ch = ticker24 ? parseFloat(ticker24.priceChangePercent) : 0;
  const high = ticker24 ? parseFloat(ticker24.highPrice) : plan.price;
  const low = ticker24 ? parseFloat(ticker24.lowPrice) : plan.price;
  const mid = (high + low) / 2;
  const momentum =
    ch > 2 ? "Bullish momentum over the last 24h."
    : ch < -2 ? "Bearish momentum over the last 24h."
    : "Balanced / sideways tape over the last 24h.";
  return {
    analysis: `${plan.bias}\n\n${momentum}\n\nStructure bias from EMA20/50 on ${plan.interval}. ATR ≈ ${fmt(plan.atr)}.\n\nLong: entry ~$${fmt(plan.long.entry)}, SL ~$${fmt(plan.long.stop)}, TP1 ~$${fmt(plan.long.tp1)}, TP2 ~$${fmt(plan.long.tp2)}.\n\nShort: entry ~$${fmt(plan.short.entry)}, SL ~$${fmt(plan.short.stop)}, TP1 ~$${fmt(plan.short.tp1)}, TP2 ~$${fmt(plan.short.tp2)}.\n\n24h range $${fmt(low)}–$${fmt(high)} (mid $${fmt(mid)}). Prefer edge of range over mid-range FOMO. Not financial advice.`,
    snapshot: {
      price: plan.price,
      change24hPct: ch,
      high24h: high,
      low24h: low,
    },
    source: "rules",
    generatedAt: new Date().toISOString(),
  };
}

export default function PlanLab() {
  const [pair, setPair] = useState("BTCUSDT");
  const [tf, setTf] = useState("1h");
  const [structure, setStructure] = useState(null);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kRes, tRes, apiRes] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${tf}&limit=50`),
        fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`),
        fetch(`/api/levels?symbol=${pair}&interval=${tf}`).catch(() => null),
      ]);
      const klines = await kRes.json();
      const ticker = await tRes.json();
      let plan = buildStructurePlan(pair, tf, klines);
      if (apiRes && apiRes.ok) {
        try {
          const data = await apiRes.json();
          if (data?.long && data?.price) {
            plan = {
              ...plan,
              price: data.price,
              atr: data.atr,
              bias: data.bias || plan.bias,
              long: data.long,
              short: data.short,
              note: data.note || plan.note,
            };
          }
        } catch {}
      }
      setStructure(plan);

      // AI card: try server btc-analysis only for BTC; else local text for any pair
      let aiPayload = null;
      if (pair === "BTCUSDT") {
        try {
          const r = await fetch("/api/btc-analysis");
          const ct = r.headers.get("content-type") || "";
          if (r.ok && ct.includes("application/json")) {
            const d = await r.json();
            if (d?.analysis) aiPayload = d;
          }
        } catch {}
      }
      if (!aiPayload) aiPayload = buildAiText(plan, ticker);
      setAi(aiPayload);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [pair, tf]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const label = PAIRS.find((p) => p.id === pair)?.label || pair;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="text-sm font-semibold">Trading plans</div>
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {PAIRS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPair(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                pair === p.id
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {TFS.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium ${
                tf === t
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {error && <div className="text-xs text-red-500 mt-2">{error}</div>}
      </div>

      {/* Structure plan */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold">Structure plan · {label}USDT · {tf}</div>
          {structure?.updatedAt && (
            <div className="text-[11px] text-slate-500">Updated {structure.updatedAt}</div>
          )}
        </div>
        {!structure ? (
          <div className="text-sm text-slate-500 py-6 text-center">Loading plan…</div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-slate-500 mb-1">Bias</div>
                <div className="font-medium">{structure.bias}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Price / ATR</div>
                <div className="font-medium">${fmt(structure.price)} · ATR {fmt(structure.atr)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Long</div>
                <div className="text-xs space-y-0.5">
                  <div>Entry ${fmt(structure.long.entry)}</div>
                  <div className="negative">SL ${fmt(structure.long.stop)}</div>
                  <div className="positive">TP1 ${fmt(structure.long.tp1)} · TP2 ${fmt(structure.long.tp2)}</div>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Short</div>
                <div className="text-xs space-y-0.5">
                  <div>Entry ${fmt(structure.short.entry)}</div>
                  <div className="negative">SL ${fmt(structure.short.stop)}</div>
                  <div className="positive">TP1 ${fmt(structure.short.tp1)} · TP2 ${fmt(structure.short.tp2)}</div>
                </div>
              </div>
            </div>
            <div className="mt-4 p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              {structure.note}
            </div>
          </>
        )}
      </div>

      {/* Claude / AI plan */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">Claude AI plan · {label}</div>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">
              AI
            </span>
          </div>
          {ai?.generatedAt && (
            <div className="text-[11px] text-slate-500 shrink-0">
              {new Date(ai.generatedAt).toLocaleString("en-IN", {
                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
              })}
              {ai.source === "claude" ? " · Claude" : " · rules engine"}
            </div>
          )}
        </div>
        {!ai ? (
          <div className="text-sm text-slate-500 py-6 text-center">Loading AI plan…</div>
        ) : (
          <>
            {ai.snapshot && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Price</div>
                  <div className="font-semibold text-sm mt-0.5">${fmt(ai.snapshot.price)}</div>
                </div>
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">24h</div>
                  <div className={`font-semibold text-sm mt-0.5 ${(ai.snapshot.change24hPct || 0) >= 0 ? "positive" : "negative"}`}>
                    {(ai.snapshot.change24hPct || 0) >= 0 ? "+" : ""}
                    {Number(ai.snapshot.change24hPct || 0).toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">24h range</div>
                  <div className="font-semibold text-xs mt-0.5 leading-snug">
                    ${fmt(ai.snapshot.low24h)} – ${fmt(ai.snapshot.high24h)}
                  </div>
                </div>
              </div>
            )}
            <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
              {ai.analysis}
            </div>
            <div className="mt-4 p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              Pair and timeframe follow the selectors above. Not financial advice.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
