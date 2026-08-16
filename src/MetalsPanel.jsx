import { useEffect, useState } from "react";

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-IN", {
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  });
}

function MetalCard({ data }) {
  if (!data) return null;
  const up = data.change24hPct >= 0;
  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            {data.name}{" "}
            <span className="text-xs font-normal text-slate-500">({data.symbol})</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">per troy ounce</div>
        </div>
        <div
          className={`text-xs font-semibold px-2 py-1 rounded-lg ${
            up
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-red-500/15 text-red-600 dark:text-red-400"
          }`}
        >
          {up ? "+" : ""}
          {data.change24hPct.toFixed(2)}% 24h
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">USD / oz</div>
          <div className="font-semibold text-lg mt-0.5">${fmt(data.priceUsd)}</div>
        </div>
        <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">INR / oz</div>
          <div className="font-semibold text-lg mt-0.5">₹{fmt(data.priceInr, 0)}</div>
        </div>
        <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">1 gram USD</div>
          <div className="font-semibold mt-0.5">${fmt(data.perGramUsd, 2)}</div>
        </div>
        <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">1 gram INR</div>
          <div className="font-semibold mt-0.5">₹{fmt(data.perGramInr, 0)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <span className="text-slate-500">Support</span>
          <span className="font-semibold positive">${fmt(data.insight.support)}</span>
        </div>
        <div className="flex justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <span className="text-slate-500">Resistance</span>
          <span className="font-semibold negative">${fmt(data.insight.resistance)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          {data.insight.bias}
        </div>
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{data.insight.action}</p>
        <div className="mt-2 text-[10px] text-slate-400">
          Range position: {data.insight.rangePositionPct}% from day low → high
        </div>
      </div>
    </div>
  );
}

export default function MetalsPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/metals");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load metals");
      setData(json);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Gold & Silver</div>
          <div className="text-[11px] text-slate-500">
            Live · USD & INR · 1g prices · S/R insight
            {data?.usdInr ? ` · 1 USD ≈ ₹${fmt(data.usdInr, 2)}` : ""}
          </div>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {err && (
        <div className="card p-4 text-sm text-red-500">{err}</div>
      )}

      {loading && !data && (
        <div className="card p-8 text-center text-sm text-slate-500">Loading gold & silver…</div>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <MetalCard data={data.gold} />
          <MetalCard data={data.silver} />
        </div>
      )}

      {data?.asOf && (
        <div className="text-[11px] text-slate-500">
          Updated {new Date(data.asOf).toLocaleString("en-IN")} · Futures proxy (GC=F / SI=F)
        </div>
      )}
    </div>
  );
}
