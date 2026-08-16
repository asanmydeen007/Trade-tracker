import { useEffect, useState, useRef } from "react";

const SYMBOLS = [
  { id: "BTCUSDT", label: "BTC" },
  { id: "ETHUSDT", label: "ETH" },
  { id: "SOLUSDT", label: "SOL" },
  { id: "XRPUSDT", label: "XRP" },
];

const INTERVALS = ["15m", "1h", "4h", "1d"];

function MethodCard({ title, badge, badgeColor, children, footer }) {
  return (
    <div className="card p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-sm font-semibold">{title}</div>
        {badge && (
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badgeColor || "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/20"}`}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="flex-1 text-sm">{children}</div>
      {footer && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
          {footer}
        </div>
      )}
    </div>
  );
}

function LevelsBlock({ label, levels, positive }) {
  if (!levels) return null;
  return (
    <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3 space-y-1.5">
      <div className={`text-xs font-semibold ${positive ? "positive" : "negative"}`}>{label}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <span className="text-slate-500">Entry</span>
        <span className="font-medium text-right">${Number(levels.entry).toLocaleString()}</span>
        <span className="text-slate-500">Stop</span>
        <span className="font-medium text-right negative">${Number(levels.stop).toLocaleString()}</span>
        <span className="text-slate-500">TP1</span>
        <span className="font-medium text-right positive">${Number(levels.tp1).toLocaleString()}</span>
        <span className="text-slate-500">TP2</span>
        <span className="font-medium text-right positive">${Number(levels.tp2).toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function AnalysisPanel() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIntervalTf] = useState("1h");
  const [atrData, setAtrData] = useState(null);
  const [atrLoading, setAtrLoading] = useState(false);
  const [atrError, setAtrError] = useState(null);

  const [rangeData, setRangeData] = useState(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  const [visionResult, setVisionResult] = useState(null);
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionError, setVisionError] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  const loadAtr = async () => {
    setAtrLoading(true);
    setAtrError(null);
    try {
      const res = await fetch(`/api/levels?symbol=${symbol}&interval=${interval}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setAtrData(data);
    } catch (e) {
      // client fallback
      try {
        const kRes = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=50`
        );
        const klines = await kRes.json();
        const closes = klines.map((k) => parseFloat(k[4]));
        const highs = klines.map((k) => parseFloat(k[2]));
        const lows = klines.map((k) => parseFloat(k[3]));
        const price = closes[closes.length - 1];
        const trs = [];
        for (let i = 1; i < klines.length; i++) {
          const h = highs[i], l = lows[i], pc = closes[i - 1];
          trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        }
        const atr = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;
        setAtrData({
          method: "atr_structure",
          symbol,
          interval,
          price,
          atr: Math.round(atr * 100) / 100,
          bias: "Neutral",
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
          note: "Client ATR fallback",
          asOf: new Date().toISOString(),
        });
        setAtrError(null);
      } catch (e2) {
        setAtrError(String(e?.message || e));
      }
    } finally {
      setAtrLoading(false);
    }
  };

  const loadRange = async () => {
    setRangeLoading(true);
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      const d = await res.json();
      const price = parseFloat(d.lastPrice);
      const high = parseFloat(d.highPrice);
      const low = parseFloat(d.lowPrice);
      const ch = parseFloat(d.priceChangePercent);
      const mid = (high + low) / 2;
      setRangeData({
        method: "range_24h",
        price,
        high,
        low,
        change24hPct: ch,
        long: {
          entry: mid,
          stop: low,
          tp1: high,
          tp2: high + (high - low) * 0.5,
        },
        short: {
          entry: mid,
          stop: high,
          tp1: low,
          tp2: low - (high - low) * 0.5,
        },
        note: "24h range mean-reversion style levels. Not financial advice.",
        asOf: new Date().toISOString(),
      });
    } catch (e) {
      setRangeData(null);
    } finally {
      setRangeLoading(false);
    }
  };

  useEffect(() => {
    loadAtr();
    loadRange();
  }, [symbol, interval]);

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
            symbol: symbol.replace("USDT", ""),
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
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <div className="text-sm font-semibold">Analysis lab</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Compare methods side by side — keep what works, remove the rest later
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {SYMBOLS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSymbol(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  symbol === s.id
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {INTERVALS.map((tf) => (
            <button
              key={tf}
              onClick={() => setIntervalTf(tf)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium ${
                interval === tf
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
              }`}
            >
              {tf}
            </button>
          ))}
          <button
            onClick={() => {
              loadAtr();
              loadRange();
            }}
            className="ml-auto px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Method 1: ATR */}
        <MethodCard
          title="1 · ATR structure"
          badge="Live"
          badgeColor="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          footer={atrData?.note || "Binance klines · ATR(14) · EMA bias"}
        >
          {atrLoading && <div className="text-slate-500 py-4 text-center">Loading…</div>}
          {atrError && !atrData && <div className="text-red-500 text-xs">{atrError}</div>}
          {atrData && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs">
                <div>
                  <span className="text-slate-500">Price </span>
                  <span className="font-semibold">${Number(atrData.price).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-500">Bias </span>
                  <span className="font-semibold">{atrData.bias}</span>
                </div>
                <div>
                  <span className="text-slate-500">ATR </span>
                  <span className="font-semibold">{atrData.atr}</span>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <LevelsBlock label="Long idea" levels={atrData.long} positive />
                <LevelsBlock label="Short idea" levels={atrData.short} />
              </div>
            </div>
          )}
        </MethodCard>

        {/* Method 2: 24h range */}
        <MethodCard
          title="2 · 24h range"
          badge="Live"
          badgeColor="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          footer={rangeData?.note || "Binance 24h ticker"}
        >
          {rangeLoading && <div className="text-slate-500 py-4 text-center">Loading…</div>}
          {rangeData && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs">
                <div>
                  <span className="text-slate-500">Price </span>
                  <span className="font-semibold">${Number(rangeData.price).toLocaleString()}</span>
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
                    ${Number(rangeData.low).toLocaleString()} – ${Number(rangeData.high).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <LevelsBlock label="Long (range)" levels={rangeData.long} positive />
                <LevelsBlock label="Short (range)" levels={rangeData.short} />
              </div>
            </div>
          )}
        </MethodCard>

        {/* Method 3: Claude vision */}
        <MethodCard
          title="3 · Claude vision (chart upload)"
          badge="AI"
          badgeColor="bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/20"
          footer="Needs ANTHROPIC_API_KEY on Vercel · upload TradingView screenshot"
        >
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFile}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-500 hover:border-emerald-500/50 hover:text-emerald-600 transition"
            >
              {visionLoading ? "Analyzing chart…" : "Upload chart screenshot"}
            </button>
            {preview && (
              <img src={preview} alt="chart" className="w-full max-h-40 object-contain rounded-lg bg-slate-100 dark:bg-slate-800" />
            )}
            {visionError && <div className="text-xs text-amber-600 dark:text-amber-400">{visionError}</div>}
            {visionResult?.analysis && (
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-slate-500">Bias </span>
                  <span className="font-semibold">{visionResult.analysis.bias}</span>
                  {visionResult.analysis.confidence && (
                    <span className="text-slate-500"> · {visionResult.analysis.confidence} confidence</span>
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
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-line">
                    {visionResult.analysis.summary}
                  </p>
                )}
              </div>
            )}
            {!visionResult && !visionError && !visionLoading && (
              <p className="text-[11px] text-slate-500">
                Upload a clear chart with visible price axis for best results.
              </p>
            )}
          </div>
        </MethodCard>

        {/* Method 4: External APIs placeholder */}
        <MethodCard
          title="4 · External APIs (later)"
          badge="Optional"
          badgeColor="bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/20"
          footer="Wire GPTChart / AI Trade Analyser keys when you pick a vendor"
        >
          <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-2 list-disc pl-4">
            <li>
              <span className="font-medium text-slate-800 dark:text-slate-200">GPTChart.ai</span> — symbol + interval → entry / SL / TP JSON
            </li>
            <li>
              <span className="font-medium text-slate-800 dark:text-slate-200">AI Trade Analyser</span> — chart upload API (paid plans)
            </li>
            <li>
              <span className="font-medium text-slate-800 dark:text-slate-200">SnapPChart-style</span> — screenshot → graded setup
            </li>
          </ul>
          <p className="text-[11px] text-slate-500 mt-3">
            These need vendor API keys. Keep this card as a shortlist until you choose one.
          </p>
        </MethodCard>
      </div>

      <div className="text-[11px] text-slate-500 px-1">
        All levels are experimental suggestions for comparison only — not financial advice. Risk small size.
      </div>
    </div>
  );
}
