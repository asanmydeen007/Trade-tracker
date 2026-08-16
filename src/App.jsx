import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, PieChart, Pie, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend
} from "recharts";
import { Menu, X, Sun, Moon, ChevronLeft, ChevronRight } from "lucide-react";
import { TRADES, PAIR_COLORS, PAIR_ICONS, SECTIONS } from "./data";
import clsx from "clsx";

const USD_RATE = 95.55;
const USDT_RATE = 95.40;
const BALANCE = 925;

function formatPnl(v) {
  const abs = Math.abs(v).toLocaleString("en-US");
  return v >= 0 ? `+$${abs}` : `-$${abs}`;
}

function formatInr(v) {
  const abs = Math.abs(Math.round(v * USD_RATE)).toLocaleString("en-IN");
  return v >= 0 ? `+₹${abs}` : `-₹${abs}`;
}

export default function App() {
  const [dark, setDark] = useState(true);
  const [section, setSection] = useState("crypto");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pairFilter, setPairFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [btcPrice, setBtcPrice] = useState(null);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [tradingPlan, setTradingPlan] = useState(null);

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Live BTC price
  useEffect(() => {
    const fetchBtc = async () => {
      try {
        const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        const data = await res.json();
        setBtcPrice(parseFloat(data.price));
      } catch (e) {}
    };
    fetchBtc();
    const id = setInterval(fetchBtc, 15000);
    return () => clearInterval(id);
  }, []);

  // Generate / refresh Trading Plan every 4 hours (and on first load)
  const generateTradingPlan = (price) => {
    if (!price || price < 1000) return null;

    const round = (v) => Math.round(v / 50) * 50; // round to nearest 50

    // Simple dynamic levels based on current price
    const support1 = round(price * 0.975);
    const support2 = round(price * 0.95);
    const support3 = round(price * 0.925);
    const resist1 = round(price * 1.025);
    const resist2 = round(price * 1.05);
    const resist3 = round(price * 1.08);
    const stop = round(price * 0.965);
    const tp1 = round(price * 1.03);
    const tp2 = round(price * 1.055);
    const tp3 = round(price * 1.09);

    // Bias logic
    let bias = "Neutral";
    let entry = `Wait for clear structure around $${round(price).toLocaleString()}`;
    if (price > 70000) {
      bias = "Bullish";
      entry = `Look for longs on pullback to $${support1.toLocaleString()}–$${support2.toLocaleString()}`;
    } else if (price < 55000) {
      bias = "Bearish";
      entry = `Look for shorts on bounce into $${resist1.toLocaleString()}–$${resist2.toLocaleString()}`;
    } else {
      bias = "Neutral-Bearish short-term";
      entry = `Watch reclaim of $${resist1.toLocaleString()}–$${resist2.toLocaleString()} with volume`;
    }

    return {
      bias,
      entry,
      support: [support1, support2, support3].map(v => v.toLocaleString()),
      resistance: [resist1, resist2, resist3].map(v => v.toLocaleString()),
      stop: `Below $${stop.toLocaleString()}`,
      tps: [
        `TP1: $${tp1.toLocaleString()}`,
        `TP2: $${tp2.toLocaleString()}`,
        `TP3: $${tp3.toLocaleString()}`,
      ],
      note: `Plan auto-updated from live BTC price ($${Math.round(price).toLocaleString()}). Risk only 0.5–1% per idea.`,
      updatedAt: new Date().toLocaleString("en-IN", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
      }),
    };
  };

  useEffect(() => {
    const updatePlan = async () => {
      try {
        let price = btcPrice;
        if (!price) {
          const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
          const data = await res.json();
          price = parseFloat(data.price);
        }
        const plan = generateTradingPlan(price);
        if (plan) setTradingPlan(plan);
      } catch (e) {
        console.error("Plan update failed", e);
      }
    };

    updatePlan(); // run immediately
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const id = setInterval(updatePlan, FOUR_HOURS);
    return () => clearInterval(id);
  }, [btcPrice]);

  // Fetch latest crypto news (with CORS-friendly proxy fallback)
  useEffect(() => {
    const fetchNews = async () => {
      setNewsLoading(true);
      const endpoints = [
        "https://min-api.cryptocompare.com/data/v2/news/?lang=EN",
        "https://api.allorigins.win/raw?url=" + encodeURIComponent("https://min-api.cryptocompare.com/data/v2/news/?lang=EN"),
      ];

      let items = [];
      for (const url of endpoints) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json();
          const list = data.Data || data.data || [];
          if (!list.length) continue;

          items = list.slice(0, 12).map((n) => ({
            id: n.id || n.guid || Math.random().toString(36).slice(2),
            title: n.title,
            url: n.url || n.link || "#",
            source: n.source_info?.name || n.source || "Crypto",
            image: n.imageurl || n.image || "",
            time: n.published_on
              ? new Date(n.published_on * 1000).toLocaleString("en-IN", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })
              : n.publishedAt
              ? new Date(n.publishedAt).toLocaleString("en-IN", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })
              : "",
            body: (n.body || n.description || "").slice(0, 120) + ((n.body || n.description) ? "..." : ""),
          }));
          break;
        } catch (e) {
          console.warn("News endpoint failed:", url, e);
        }
      }

      // Fallback curated headlines if APIs fail
      if (!items.length) {
        items = [
          { id: "1", title: "Bitcoin consolidates as traders watch key support levels", url: "https://www.coindesk.com", source: "Market", image: "", time: "Today", body: "BTC price action remains range-bound while volume stays muted across major exchanges." },
          { id: "2", title: "Ethereum network activity rises ahead of next upgrade cycle", url: "https://www.theblock.co", source: "Market", image: "", time: "Today", body: "On-chain metrics show increasing activity as developers prepare for upcoming changes." },
          { id: "3", title: "Silver and metals traders react to macro uncertainty", url: "https://www.investing.com", source: "Macro", image: "", time: "Today", body: "Precious metals see mixed flows as risk sentiment shifts in global markets." },
          { id: "4", title: "Solana and high-throughput chains attract fresh capital", url: "https://cointelegraph.com", source: "Crypto", image: "", time: "Today", body: "Ecosystem growth continues as developers and traders rotate into faster L1s." },
        ];
      }

      setNews(items);
      setNewsLoading(false);
    };
    fetchNews();
  }, []);

  const filtered = useMemo(() => {
    return TRADES.filter((t) => {
      if (pairFilter !== "all" && t.pair !== pairFilter) return false;
      if (resultFilter === "Win" && t.pnl < 0) return false;
      if (resultFilter === "Loss" && t.pnl >= 0) return false;
      return true;
    });
  }, [pairFilter, resultFilter]);

  const totalPnl = filtered.reduce((s, t) => s + t.pnl, 0);
  const wins = filtered.filter((t) => t.pnl > 0).length;
  const winRate = filtered.length ? Math.round((wins / filtered.length) * 100) : 0;

  // Cumulative chart data
  const cumulativeData = useMemo(() => {
    const sorted = [...TRADES].sort((a, b) => a.date.localeCompare(b.date));
    let sum = 0;
    return sorted.map((t) => {
      sum += t.pnl;
      return { date: t.date.slice(5), pnl: sum, name: t.name };
    });
  }, []);

  // Pair PnL
  const pairData = useMemo(() => {
    const map = {};
    filtered.forEach((t) => {
      map[t.pair] = (map[t.pair] || 0) + t.pnl;
    });
    return Object.entries(map).map(([name, value]) => ({
      name,
      value,
      abs: Math.abs(value),
      color: PAIR_COLORS[name] || "#64748b",
    }));
  }, [filtered]);

  // Daily PnL
  const dailyData = useMemo(() => {
    const map = {};
    filtered.forEach((t) => {
      map[t.date] = (map[t.date] || 0) + t.pnl;
    });
    return Object.keys(map)
      .sort()
      .map((date) => ({
        date,
        label: new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        pnl: map[date],
      }));
  }, [filtered]);

  // Calendar
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const dayPnl = {};
    TRADES.forEach((t) => {
      const [y, m, d] = t.date.split("-").map(Number);
      if (y === calYear && m - 1 === calMonth) {
        dayPnl[d] = (dayPnl[d] || 0) + t.pnl;
      }
    });
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, pnl: dayPnl[d] });
    }
    return days;
  }, [calMonth, calYear]);

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => setToast(null), 2200);
  };

  // Borderless tooltip that sits inside the chart
  const tooltipStyle = {
    backgroundColor: dark ? "#1e293b" : "#ffffff",
    border: "none",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 500,
    color: dark ? "#f1f5f9" : "#0f172a",
    boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
    padding: "10px 14px",
  };

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 40, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 20, x: "-50%" }}
            className="fixed bottom-8 left-1/2 z-[100] px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-medium shadow-2xl pointer-events-none"
            style={{ maxWidth: "90vw" }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed top-0 left-0 z-50 w-72 h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform duration-300 lg:static lg:translate-x-0 lg:shrink-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="font-bold text-lg">Market</div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>

        <nav className="p-3 space-y-1 flex-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSection(s.id);
                setSidebarOpen(false);
              }}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                section === s.id
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
            >
              <span className="text-base">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 space-y-1.5">
          <div>1 USD ≈ <span className="font-semibold text-slate-800 dark:text-slate-200">₹{USD_RATE}</span></div>
          <div>1 USDT ≈ <span className="font-semibold text-slate-800 dark:text-slate-200">₹{USDT_RATE}</span></div>
          <div className="pt-1">Balance: <span className="font-semibold text-slate-900 dark:text-white">${BALANCE}</span></div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-950/90 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-lg font-bold leading-tight">Mydeen's Trading Journal</h1>
              <p className="text-[11px] text-slate-500">Synced from Notion</p>
            </div>
          </div>
          <button
            onClick={() => setDark(!dark)}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        <main className="p-4 sm:p-6 lg:p-8 flex-1 max-w-7xl mx-auto w-full">
          <AnimatePresence mode="wait">
            {section === "crypto" && (
              <motion.div
                key="crypto"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="space-y-5"
              >
                {/* BTC Card */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.05 }}
                  className="card p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-orange-500/15 flex items-center justify-center overflow-hidden">
                      <img src={PAIR_ICONS.Bitcoin} alt="Bitcoin" className="w-7 h-7 object-contain" />
                    </div>
                    <div>
                      <div className="font-semibold">Bitcoin</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <span className="live-dot" /> Live
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">
                      {btcPrice ? `$${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {btcPrice ? `₹${Math.round(btcPrice * USD_RATE).toLocaleString("en-IN")}` : "—"}
                    </div>
                  </div>
                </motion.div>

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Balance", value: `$${BALANCE}`, sub: `≈ ₹${(BALANCE * USD_RATE).toLocaleString("en-IN")}`, span: true },
                    { label: "PnL (USDT)", value: formatPnl(totalPnl), color: totalPnl >= 0 ? "positive" : "negative" },
                    { label: "PnL (INR)", value: formatInr(totalPnl), color: totalPnl >= 0 ? "positive" : "negative" },
                    { label: "Win Rate", value: `${winRate}%` },
                    { label: "1 USD", value: `₹${USD_RATE}`, color: "positive" },
                    { label: "1 USDT", value: `₹${USDT_RATE}`, color: "positive" },
                  ].map((s, i) => (
                    <motion.div
                      key={s.label}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.08 + i * 0.04 }}
                      className={clsx("card p-3.5", s.span && "col-span-2 sm:col-span-1")}
                    >
                      <div className="text-xs text-slate-500">{s.label}</div>
                      <div className={clsx("text-xl font-bold mt-0.5", s.color)}>{s.value}</div>
                      {s.sub && <div className="text-xs text-slate-500">{s.sub}</div>}
                    </motion.div>
                  ))}
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="card p-4"
                  >
                    <div className="text-sm font-semibold mb-3">Cumulative PnL</div>
                    <div className="h-52 lg:h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={cumulativeData}>
                          <defs>
                            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{ fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                          <Tooltip
                            contentStyle={tooltipStyle}
                            itemStyle={{ color: dark ? "#f1f5f9" : "#0f172a" }}
                            formatter={(v) => [formatPnl(v), "PnL"]}
                            cursor={{ stroke: dark ? "#475569" : "#cbd5e1", strokeWidth: 1 }}
                          />
                          <Area type="monotone" dataKey="pnl" stroke="#ef4444" fill="url(#pnlGrad)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="card p-4"
                  >
                    <div className="text-sm font-semibold mb-3">PnL by Pair</div>
                    <div className="h-52 lg:h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pairData}
                            dataKey="abs"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={85}
                            paddingAngle={3}
                          >
                            {pairData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={tooltipStyle}
                            itemStyle={{ color: dark ? "#f1f5f9" : "#0f172a" }}
                            formatter={(value, name, props) => {
                              const pnl = props?.payload?.pnl ?? props?.payload?.value ?? value;
                              return [formatPnl(Number(pnl) || 0), props?.payload?.name || name];
                            }}
                          />
                          <Legend
                            verticalAlign="bottom"
                            height={36}
                            formatter={(value) => <span style={{ color: dark ? "#94a3b8" : "#64748b", fontSize: 12 }}>{value}</span>}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </motion.div>
                </div>

                {/* Daily PnL */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28 }}
                  className="card p-4"
                >
                  <div className="text-sm font-semibold mb-3">Daily PnL</div>
                  <div className="h-52 lg:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData}>
                        <XAxis
                          dataKey="label"
                          tick={{ fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `$${v}`}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          itemStyle={{ color: dark ? "#f1f5f9" : "#0f172a" }}
                          formatter={(v) => [formatPnl(v), "PnL"]}
                          labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ""}
                          cursor={{ fill: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                        />
                        <Bar dataKey="pnl" radius={[6, 6, 0, 0]} maxBarSize={48}>
                          {dailyData.map((entry, i) => (
                            <Cell key={i} fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>

                {/* Calendar */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="card p-4"
                >
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                      <ChevronLeft size={18} />
                    </button>
                    <div className="text-sm font-semibold">{monthNames[calMonth]} {calYear}</div>
                    <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs">
                    {["S","M","T","W","T","F","S"].map((d) => (
                      <div key={d} className="text-slate-400 font-medium py-1">{d}</div>
                    ))}
                    {calendarDays.map((item, i) => (
                      <div
                        key={i}
                        className={clsx(
                          "min-h-[48px] rounded-lg p-1 flex flex-col items-center justify-center",
                          item?.pnl !== undefined && (item.pnl >= 0 ? "bg-emerald-500/15" : "bg-red-500/15")
                        )}
                      >
                        {item && (
                          <>
                            <div className="font-medium text-xs">{item.day}</div>
                            {item.pnl !== undefined && (
                              <div className={clsx("text-[10px] font-bold", item.pnl >= 0 ? "positive" : "negative")}>
                                {formatPnl(item.pnl)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* Trades List */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  className="card p-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div className="text-sm font-semibold">Crypto Trades</div>
                    <div className="flex gap-2">
                      <select value={pairFilter} onChange={(e) => setPairFilter(e.target.value)} className="rounded-lg px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                        <option value="all">All Pairs</option>
                        {["Bitcoin","Eth","Solana","Sui","Silver"].map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} className="rounded-lg px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                        <option value="all">All</option>
                        <option value="Win">Win</option>
                        <option value="Loss">Loss</option>
                      </select>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    <AnimatePresence>
                      {filtered.map((t, i) => (
                        <motion.div
                          key={t.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="flex items-center justify-between py-3.5 gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center shrink-0"
                              style={{
                                background: PAIR_ICONS[t.pair]
                                  ? undefined
                                  : `${PAIR_COLORS[t.pair] || "#64748b"}22`,
                              }}
                            >
                              {PAIR_ICONS[t.pair] ? (
                                <img
                                  src={PAIR_ICONS[t.pair]}
                                  alt={t.pair}
                                  className="w-6 h-6 object-contain"
                                  onError={(e) => { e.target.style.display = "none"; }}
                                />
                              ) : (
                                <span className="text-[11px] font-bold" style={{ color: PAIR_COLORS[t.pair] || "#64748b" }}>
                                  {t.pair === "Silver" ? "Ag" : t.pair === "Gold" ? "Au" : t.pair[0]}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{t.name}</div>
                              <div className="text-xs text-slate-500">{t.pair} · {new Date(t.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
                            </div>
                          </div>
                          <div className={clsx("font-semibold shrink-0", t.pnl >= 0 ? "positive" : "negative")}>
                            {formatPnl(t.pnl)}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {filtered.length === 0 && (
                      <div className="py-10 text-center text-slate-500 text-sm">No trades match filters</div>
                    )}
                  </div>
                </motion.div>

                {/* Spot Holdings placeholder */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="card p-4"
                >
                  <div className="text-sm font-semibold mb-3">Spot Holdings</div>
                  <div className="text-center py-8 text-slate-500">
                    <div className="text-3xl mb-2">🪙</div>
                    <div className="font-medium">No spot holdings yet</div>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Other sections */}
            {["us-stocks", "indian", "forex"].includes(section) && (
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="card p-12 text-center"
              >
                <div className="text-5xl mb-4">
                  {section === "us-stocks" ? "🏴‍☠️" : section === "indian" ? "🚀" : "🌊"}
                </div>
                <h2 className="text-xl font-bold mb-2">
                  {section === "us-stocks" ? "US Stocks" : section === "indian" ? "Indian Stocks" : "Forex"}
                </h2>
                <p className="text-slate-500 text-sm">No positions yet.</p>
              </motion.div>
            )}

            {section === "news" && (
              <motion.div key="news" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-semibold">Market News</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <span className="live-dot" /> Live · CryptoCompare
                    </div>
                  </div>
                </div>

                {newsLoading && (
                  <div className="card p-10 text-center text-slate-500 text-sm">Loading latest news...</div>
                )}

                {!newsLoading && news.length === 0 && (
                  <div className="card p-10 text-center text-slate-500 text-sm">Could not load news. Try again later.</div>
                )}

                <div className="space-y-3">
                  {news.map((n, i) => (
                    <motion.a
                      key={n.id || i}
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="card p-4 flex gap-4 hover:border-emerald-500/40 transition block"
                    >
                      {n.image && (
                        <img
                          src={n.image}
                          alt=""
                          className="w-16 h-16 rounded-xl object-cover shrink-0 bg-slate-100 dark:bg-slate-800"
                          onError={(e) => { e.target.style.display = "none"; }}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm leading-snug line-clamp-2">{n.title}</div>
                        <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-2">
                          <span className="font-medium text-slate-600 dark:text-slate-400">{n.source}</span>
                          <span>·</span>
                          <span>{n.time}</span>
                        </div>
                        {n.body && (
                          <div className="text-xs text-slate-500 mt-1.5 line-clamp-2">{n.body}</div>
                        )}
                      </div>
                    </motion.a>
                  ))}
                </div>
              </motion.div>
            )}

            {section === "plan" && (
              <motion.div key="plan" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-semibold">Trading Plan · BTCUSDT</div>
                  {tradingPlan?.updatedAt && (
                    <div className="text-[11px] text-slate-500">
                      Updated {tradingPlan.updatedAt} · every 4h
                    </div>
                  )}
                </div>
                {tradingPlan ? (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Bias</div>
                        <div className="font-medium">{tradingPlan.bias}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Entry Idea</div>
                        <div className="font-medium">{tradingPlan.entry}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Support</div>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {tradingPlan.support.map((l) => (
                            <span key={l} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{l}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Resistance</div>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {tradingPlan.resistance.map((l) => (
                            <span key={l} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500/15 text-red-600 dark:text-red-400">{l}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Stop Loss</div>
                        <div className="font-medium negative">{tradingPlan.stop}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Take Profit</div>
                        <div className="space-y-0.5 font-medium positive">
                          {tradingPlan.tps.map((tp) => (
                            <div key={tp}>{tp}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                      {tradingPlan.note}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500 py-6 text-center">Loading trading plan…</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
