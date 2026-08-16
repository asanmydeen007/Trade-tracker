import { useEffect, useState, useCallback } from "react";

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
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }),
  };
}

function buildRulesAi(plan, ticker) {
  const ch = parseFloat(ticker.priceChangePercent);
  const high = parseFloat(ticker.highPrice);
  const low = parseFloat(ticker.lowPrice);
  const momentum =
    ch > 2 ? "Bullish momentum over the last 24h."
    : ch < -2 ? "Bearish momentum over the last 24h."
    : "Balanced / sideways tape over the last 24h.";
  return {
    analysis: `${plan.bias}\n\n${momentum}\n\nATR ≈ ${fmt(plan.atr)} on ${plan.interval}.\n\nLong: entry ~$${fmt(plan.long.entry)}, SL ~$${fmt(plan.long.stop)}, TP1 ~$${fmt(plan.long.tp1)}, TP2 ~$${fmt(plan.long.tp2)}.\n\nShort: entry ~$${fmt(plan.short.entry)}, SL ~$${fmt(plan.short.stop)}, TP1 ~$${fmt(plan.short.tp1)}, TP2 ~$${fmt(plan.short.tp2)}.\n\n24h range $${fmt(low)}–$${fmt(high)}. Not financial advice.`,
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

function AiCard({ title, badge, data, emptyText }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{title}</div>
          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">
            {badge}
          </span>
        </div>
        {data?.generatedAt && (
          <div className="text-[11px] text-slate-500 shrink-0">
            {new Date(data.generatedAt).toLocaleString("en-IN", {
              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
            })}
            {data.source === "claude" || data.source === "grok"
              ? ` · ${data.source === "claude" ? "Claude" : "Grok"}`
              : " · rules engine"}
          </div>
        )}
      </div>
      {!data ? (
        <div className="text-sm text-slate-500 py-6 text-center">{emptyText}</div>
      ) : (
        <>
          {data.snapshot && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Price</div>
                <div className="font-semibold text-sm mt-0.5">${fmt(data.snapshot.price)}</div>
              </div>
              <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">24h</div>
                <div className={`font-semibold text-sm mt-0.5 ${(data.snapshot.change24hPct || 0) >= 0 ? "positive" : "negative"}`}>
                  {(data.snapshot.change24hPct || 0) >= 0 ? "+" : ""}
                  {Number(data.snapshot.change24hPct || 0).toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">24h range</div>
                <div className="font-semibold text-xs mt-0.5">
                  ${fmt(data.snapshot.low24h)} – ${fmt(data.snapshot.high24h)}
                </div>
              </div>
            </div>
          )}
          <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
            {data.analysis}
          </div>
        </>
      )}
    </div>
  );
}

export default function PlanLab() {
  const [pair, setPair] = useState("BTCUSDT");
  const [tf, setTf] = useState("1h");
  const [structure, setStructure] = useState(null);
  const [rangeData, setRangeData] = useState(null);
  const [claude, setClaude] = useState(null);
  const [grok, setGrok] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const label = PAIRS.find((p) => p.id === pair)?.label || pair;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kRes, tRes, levelsRes] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${tf}&limit=50`),
        fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`),
        fetch(`/api/levels?symbol=${pair}&interval=${tf}`).catch(() => null),
      ]);
      const klines = await kRes.json();
      const ticker = await tRes.json();
      let plan = buildStructurePlan(pair, tf, klines);
      if (levelsRes && levelsRes.ok) {
        try {
          const data = await levelsRes.json();
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

      // Claude
      let claudeData = null;
      if (pair === "BTCUSDT") {
        try {
          const r = await fetch("/api/btc-analysis");
          const ct = r.headers.get("content-type") || "";
          if (r.ok && ct.includes("application/json")) {
            const d = await r.json();
            if (d?.analysis) claudeData = d;
          }
        } catch {}
      }
      setClaude(claudeData || buildRulesAi(plan, ticker));

      // Grok
      let grokData = null;
      try {
        const r = await fetch(`/api/grok-plan?symbol=${pair}&interval=${tf}`);
        const ct = r.headers.get("content-type") || "";
        if (r.ok && ct.includes("application/json")) {
          const d = await r.json();
          if (d?.analysis) grokData = d;
        }
      } catch {}
      setGrok(grokData || buildRulesAi(plan, ticker));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [pair, tf]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div>
            <div className="text-sm font-semibold">Trading plans</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Pair applies to all plans · free structure + AI plans
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

      {/* 1 Structure */}
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
              <div><span className="text-slate-500">Bias </span><span className="font-semibold">{structure.bias}</span></div>
              <div><span className="text-slate-500">Price </span><span className="font-semibold">${fmt(structure.price)}</span></div>
              <div><span className="text-slate-500">ATR </span><span className="font-semibold">{fmt(structure.atr)}</span></div>
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
              <div><span className="text-slate-500">Price </span><span className="font-semibold">${fmt(rangeData.price)}</span></div>
              <div>
                <span className="text-slate-500">24h </span>
                <span className={`font-semibold ${rangeData.change24hPct >= 0 ? "positive" : "negative"}`}>
                  {rangeData.change24hPct >= 0 ? "+" : ""}{rangeData.change24hPct.toFixed(2)}%
                </span>
              </div>
              <div>
                <span className="text-slate-500">Range </span>
                <span className="font-semibold">${fmt(rangeData.low)} – ${fmt(rangeData.high)}</span>
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

      <AiCard title={`3 · Claude AI plan · ${label}`} badge="Claude" data={claude} emptyText="Loading Claude plan…" />
      <AiCard title={`4 · Grok AI plan · ${label}`} badge="Grok" data={grok} emptyText="Loading Grok plan…" />

      <div className="text-[11px] text-slate-500 px-1 pb-2">
        Not financial advice. Optional keys: ANTHROPIC_API_KEY (Claude), XAI_API_KEY (Grok). Without keys, AI cards use the rules engine.
      </div>
    </div>
  );
}
