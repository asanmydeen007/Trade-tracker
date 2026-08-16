import { useEffect, useState, useCallback, useRef } from "react";

const PAIRS = [
  { id: "BTCUSDT", label: "BTC" },
  { id: "ETHUSDT", label: "ETH" },
  { id: "SOLUSDT", label: "SOL" },
  { id: "XRPUSDT", label: "XRP" },
];

const TFS = ["15m", "1h", "4h", "1d"];

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 });
}

function Levels({ label, levels, positive }) {
  if (!levels) return null;
  return (
    <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3 space-y-1">
      <div className={`text-xs font-semibold ${positive ? "positive" : "negative"}`}>{label}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
        <span className="text-slate-500">Entry</span>
        <span className="font-medium text-right">${fmt(levels.entry)}</span>
        <span className="text-slate-500">Stop</span>
        <span className="font-medium text-right negative">${fmt(levels.stop)}</span>
        <span className="text-slate-500">TP1</span>
        <span className="font-medium text-right positive">${fmt(levels.tp1)}</span>
        <span className="text-slate-500">TP2</span>
        <span className="font-medium text-right positive">${fmt(levels.tp2)}</span>
      </div>
    </div>
  );
}

function buildStructurePlan(symbol, interval, klines) {
  const closes = klines.map((k) => parseFloat(k[4]));
  const highs = klines.map((k) => parseFloat(k[2]));
  const lows = klines.map((k) => parseFloat(k[3]));
  const price = closes[closes.length - 1];
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
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

  return {
    symbol,
    interval,
    price,
    atr,
    bias,
    long: {
      entry: price,
      stop: price - 1.5 * atr,
      tp1: price + 2 * atr,
      tp2: price + 3 * atr,
    },
    short: {
      entry: price,
      stop: price + 1.5 * atr,
      tp1: price - 2 * atr,
      tp2: price - 3 * atr,
    },
    note: `ATR(14)×1.5 SL · 2R/3R · ${interval}. Risk 0.5–1%. Not financial advice.`,
    updatedAt: new Date().toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function buildAiText(plan, ticker24) {
  const ch = ticker24 ? parseFloat(ticker24.priceChangePercent) : 0;
  const high = ticker24 ? parseFloat(ticker24.highPrice) : plan.price;
  const low = ticker24 ? parseFloat(ticker24.lowPrice) : plan.price;
  const momentum =
    ch > 2
      ? "Bullish momentum over the last 24h."
      : ch < -2
        ? "Bearish momentum over the last 24h."
        : "Balanced / sideways tape over the last 24h.";
  return {
    analysis: `${plan.bias}\n\n${momentum}\n\nStructure from EMA20/50 on ${plan.interval}. ATR ≈ ${fmt(plan.atr)}.\n\nLong: entry ~$${fmt(plan.long.entry)}, SL ~$${fmt(plan.long.stop)}, TP1 ~$${fmt(plan.long.tp1)}, TP2 ~$${fmt(plan.long.tp2)}.\n\nShort: entry ~$${fmt(plan.short.entry)}, SL ~$${fmt(plan.short.stop)}, TP1 ~$${fmt(plan.short.tp1)}, TP2 ~$${fmt(plan.short.tp2)}.\n\n24h range $${fmt(low)}–$${fmt(high)}. Prefer range edges. Not financial advice.`,
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
  const [rangeData, setRangeData] = useState(null);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [visionResult, setVisionResult] = useState(null);
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionError, setVisionError] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  const label = PAIRS.find((p) => p.id === pair)?.label || pair;

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

      const price = parseFloat(ticker.lastPrice);
      const high = parseFloat(ticker.highPrice);
      const low = parseFloat(ticker.lowPrice);
      const ch = parseFloat(ticker.priceChangePercent);
      const mid = (high + low) / 2;
      setRangeData({
        price,
        high,
        low,
        change24hPct: ch,
        long: { entry: mid, stop: low, tp1: high, tp2: high + (high - low) * 0.5 },
        short: { entry: mid, stop: high, tp1: low, tp2: low - (high - low) * 0.5 },
        note: "24h range mean-reversion style. Not financial advice.",
      });

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

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVisionError(null);
    setVisionResult(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setPreview(dataUrl);
      setVisionLoading(true);
      try {
        const res = await fetch("/api/chart-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: dataUrl,
            mimeType: file.type || "image/png",
            symbol: label,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.hint || data?.error || "Vision failed");
        setVisionResult(data);
      } catch (err) {
        setVisionError(String(err?.message || err));
      } finally {
        setVisionLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div>
            <div className="text-sm font-semibold">Trading plans</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Free live methods + AI · pair applies to all plans below
            </div>
          </div>
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

      {/* 1 Structure / ATR */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">1 · Structure plan · {label} · {tf}</div>
            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Free
            </span>
          </div>
          {structure?.updatedAt && (
            <div className="text-[11px] text-slate-500">Updated {structure.updatedAt}</div>
          )}
        </div>
        {!structure ? (
          <div className="text-sm text-slate-500 py-6 text-center">Loading…</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-xs mb-3">
              <div>
                <span className="text-slate-500">Bias </span>
                <span className="font-semibold">{structure.bias}</span>
              </div>
              <div>
                <span className="text-slate-500">Price </span>
                <span className="font-semibold">${fmt(structure.price)}</span>
              </div>
              <div>
                <span className="text-slate-500">ATR </span>
                <span className="font-semibold">{fmt(structure.atr)}</span>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Levels label="Long" levels={structure.long} positive />
              <Levels label="Short" levels={structure.short} />
            </div>
            <div className="mt-3 p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              {structure.note}
            </div>
          </>
        )}
      </div>

      {/* 2 24h range */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-sm font-semibold">2 · 24h range · {label}</div>
          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            Free
          </span>
        </div>
        {!rangeData ? (
          <div className="text-sm text-slate-500 py-4 text-center">Loading…</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-xs mb-3">
              <div>
                <span className="text-slate-500">Price </span>
                <span className="font-semibold">${fmt(rangeData.price)}</span>
              </div>
              <div>
                <span className="text-slate-500">24h </span>
                <span className={`font-semibold ${rangeData.change24hPct >= 0 ? "positive" : "negative"}`}>
                  {rangeData.change24hPct >= 0 ? "+" : ""}
                  {rangeData.change24hPct.toFixed(2)}%
                </span>
              </div>
              <div>
                <span className="text-slate-500">Range </span>
                <span className="font-semibold">
                  ${fmt(rangeData.low)} – ${fmt(rangeData.high)}
                </span>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Levels label="Long (range)" levels={rangeData.long} positive />
              <Levels label="Short (range)" levels={rangeData.short} />
            </div>
            <div className="mt-3 p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              {rangeData.note}
            </div>
          </>
        )}
      </div>

      {/* 3 Claude AI text plan */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">3 · Claude AI plan · {label}</div>
            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">
              AI
            </span>
          </div>
          {ai?.generatedAt && (
            <div className="text-[11px] text-slate-500">
              {new Date(ai.generatedAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {ai.source === "claude" ? " · Claude" : " · rules engine"}
            </div>
          )}
        </div>
        {!ai ? (
          <div className="text-sm text-slate-500 py-6 text-center">Loading…</div>
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
                  <div
                    className={`font-semibold text-sm mt-0.5 ${(ai.snapshot.change24hPct || 0) >= 0 ? "positive" : "negative"}`}
                  >
                    {(ai.snapshot.change24hPct || 0) >= 0 ? "+" : ""}
                    {Number(ai.snapshot.change24hPct || 0).toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">24h range</div>
                  <div className="font-semibold text-xs mt-0.5">
                    ${fmt(ai.snapshot.low24h)} – ${fmt(ai.snapshot.high24h)}
                  </div>
                </div>
              </div>
            )}
            <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
              {ai.analysis}
            </div>
          </>
        )}
      </div>

      {/* 4 Chart upload vision */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-sm font-semibold">4 · Claude vision (chart upload)</div>
          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">
            AI
          </span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full py-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-500 hover:border-emerald-500/50 hover:text-emerald-600 transition"
        >
          {visionLoading ? "Analyzing chart…" : `Upload ${label} chart screenshot`}
        </button>
        {preview && (
          <img
            src={preview}
            alt="chart"
            className="w-full max-h-40 object-contain rounded-lg bg-slate-100 dark:bg-slate-800 mt-3"
          />
        )}
        {visionError && (
          <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">{visionError}</div>
        )}
        {visionResult?.analysis && (
          <div className="mt-3 space-y-2 text-xs">
            <div>
              <span className="text-slate-500">Bias </span>
              <span className="font-semibold">{visionResult.analysis.bias}</span>
              {visionResult.analysis.confidence && (
                <span className="text-slate-500"> · {visionResult.analysis.confidence}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1">
              <span className="text-slate-500">Entry</span>
              <span className="text-right font-medium">{visionResult.analysis.entry ?? "—"}</span>
              <span className="text-slate-500">Stop</span>
              <span className="text-right font-medium">{visionResult.analysis.stop_loss ?? "—"}</span>
              <span className="text-slate-500">TPs</span>
              <span className="text-right font-medium">
                {(visionResult.analysis.take_profit || []).join(" / ") || "—"}
              </span>
            </div>
            {visionResult.analysis.summary && (
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {visionResult.analysis.summary}
              </p>
            )}
          </div>
        )}
        <div className="mt-3 text-[11px] text-slate-500">
          Needs ANTHROPIC_API_KEY on Vercel. Upload a chart with a visible price axis.
        </div>
      </div>

      {/* 5 External shortlist */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-sm font-semibold">5 · External APIs (optional later)</div>
          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/20">
            Paid
          </span>
        </div>
        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-2 list-disc pl-4">
          <li>
            <span className="font-medium text-slate-800 dark:text-slate-200">GPTChart.ai</span> — symbol +
            interval → entry / SL / TP JSON
          </li>
          <li>
            <span className="font-medium text-slate-800 dark:text-slate-200">AI Trade Analyser</span> — chart
            upload API (paid plans)
          </li>
          <li>
            <span className="font-medium text-slate-800 dark:text-slate-200">SnapPChart-style</span> —
            screenshot → graded setup
          </li>
        </ul>
        <p className="text-[11px] text-slate-500 mt-3">
          Not free for full API use. Keep as shortlist until you pick one to wire.
        </p>
      </div>

      <div className="text-[11px] text-slate-500 px-1 pb-2">
        All levels are experimental — not financial advice. Risk small size.
      </div>
    </div>
  );
}
