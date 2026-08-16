import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { Menu, X, Sun, Moon, ChevronLeft, ChevronRight } from "lucide-react";
import { TRADES, PAIR_COLORS, SECTIONS } from "./data";
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

  const tooltipStyle = {
    backgroundColor: dark ? "#0f172a" : "#fff",
    border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
    borderRadius: 10,
    fontSize: 12,
  };

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
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
              <h1 className="text-lg font-bold leading-tight">Asan's Trading Journey</h1>
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
                    <div className="w-11 h-11 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-500 font-bold text-lg">₿</div>
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
                          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatPnl(v), "PnL"]} />
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
                        <BarChart data={pairData} layout="vertical">
                          <XAxis type="number" tick={{ fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" width={70} tick={{ fill: dark ? "#94a3b8" : "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, _, props) => [formatPnl(props.payload.value), "PnL"]} />
                          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
                            {pairData.map((entry, i) => (
                              <Cell key={i} fill={entry.value >= 0 ? "#22c55e" : "#ef4444"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </motion.div>
                </div>

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
                              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                              style={{ background: `${t.color}22`, color: t.color }}
                            >
                              {t.icon}
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
              <motion.div key="news" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-semibold">Market News</div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <span className="live-dot" /> Auto · Fed · PPI · Inflation
                  </div>
                </div>
                <div className="text-center py-12 text-slate-500 text-sm">News feed coming soon</div>
              </motion.div>
            )}

            {section === "plan" && (
              <motion.div key="plan" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
                <div className="text-sm font-semibold mb-4">Trading Plan · BTCUSDT</div>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Bias</div>
                    <div className="font-medium">Neutral-Bearish short-term</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Entry Idea</div>
                    <div className="font-medium">Watch reclaim of 63,200–63,500 with volume</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Support</div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {["61,500", "59,800", "58,000"].map((l) => (
                        <span key={l} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{l}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Resistance</div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {["64,500", "66,200", "68,500"].map((l) => (
                        <span key={l} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500/15 text-red-600 dark:text-red-400">{l}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Stop Loss</div>
                    <div className="font-medium negative">Below 61,200</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Take Profit</div>
                    <div className="space-y-0.5 font-medium positive">
                      <div>TP1: 64,800</div>
                      <div>TP2: 66,200</div>
                      <div>TP3: 68,500</div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-3 rounded-xl text-xs bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                  Portfolio is deep red after Silver -$400. Prefer waiting for clear structure. Risk only 0.5–1% per idea until equity recovers.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
