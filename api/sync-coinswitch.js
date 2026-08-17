/**
 * CoinSwitch → Notion Trade PnL Tracker (month-by-month)
 *
 * ?mode=month&month=2026-07   → sync that month (default: current month)
 * ?mode=transactions|closed|balance → probe
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const nacl = require("../lib/nacl.cjs");

const NOTION_DB_ID =
  process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";
const BASE_URL = "https://coinswitch.co";
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const SYMBOL_TO_PAIR = {
  BTCUSDT: "Bitcoin",
  ETHUSDT: "Eth",
  SOLUSDT: "Solana",
  SUIUSDT: "Sui",
  XRPUSDT: "XRP",
  ADAUSDT: "ADA",
  AVAXUSDT: "AVAX",
  BNBUSDT: "BNB",
  DOGEUSDT: "DOGE",
  LINKUSDT: "LINK",
  MATICUSDT: "MATIC",
  NEARUSDT: "NEAR",
  ATOMUSDT: "ATOM",
  AAVEUSDT: "AAVE",
  DOTUSDT: "DOT",
  LTCUSDT: "LTC",
  UNIUSDT: "UNI",
  APTUSDT: "APT",
  ARBUSDT: "ARB",
  OPUSDT: "OP",
};

function mapPair(symbol = "") {
  const s = String(symbol).toUpperCase().replace("/", "");
  return SYMBOL_TO_PAIR[s] || s.replace("USDT", "") || "Other";
}

function signRequest(method, path, query = {}, bodyObj = null) {
  const apiKey = process.env.COINSWITCH_API_KEY;
  const secretHex = process.env.COINSWITCH_API_SECRET;
  if (!apiKey || !secretHex) throw new Error("Missing CoinSwitch keys");

  const pairs = Object.keys(query).sort().map((k) => `${k}=${query[k]}`);
  const qs = pairs.join("&");
  const fullPath = qs ? `${path}?${qs}` : path;
  const epoch = String(Date.now());
  const message = method.toUpperCase() + fullPath + epoch;
  const messageBytes = new TextEncoder().encode(message);

  const seed = Uint8Array.from(Buffer.from(secretHex.trim(), "hex"));
  let secretKey;
  if (seed.length === 32) secretKey = nacl.sign.keyPair.fromSeed(seed).secretKey;
  else if (seed.length === 64) secretKey = seed;
  else throw new Error(`Bad secret length ${seed.length}`);

  const signature = nacl.sign.detached(messageBytes, secretKey);
  return {
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": apiKey.trim(),
      "X-AUTH-SIGNATURE": Buffer.from(signature).toString("hex"),
      "X-AUTH-EPOCH": epoch,
    },
    url: BASE_URL + fullPath,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    debug: { method, fullPath, epoch },
  };
}

async function csFetch(method, path, query = {}, bodyObj = null) {
  const signed = signRequest(method, path, query, bodyObj);
  const opts = { method, headers: signed.headers };
  if (bodyObj && method !== "GET") opts.body = signed.body;
  const res = await fetch(signed.url, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const e = new Error(`Non-JSON ${res.status}: ${text.slice(0, 250)}`);
    e.debug = signed.debug;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`CoinSwitch ${res.status}: ${JSON.stringify(json).slice(0, 350)}`);
    e.debug = signed.debug;
    e.raw = json;
    throw e;
  }
  return { json, debug: signed.debug };
}

async function createNotionPage({ pair, pnl, date }) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing");
  const body = {
    parent: { database_id: NOTION_DB_ID },
    properties: {
      Name: { title: [{ text: { content: pair } }] },
      Date: { date: { start: date } },
      Pair: { select: { name: pair } },
      "PnL USDT": { number: pnl },
    },
  };
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function isPnlType(type) {
  const t = String(type || "").toUpperCase().replace(/\s+/g, "");
  return t.includes("PNL") || t === "P&L";
}

/** Month start/end in ms (UTC) */
function monthRange(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const from = Date.UTC(y, m - 1, 1, 0, 0, 0, 0);
  const to = Date.UTC(y, m, 0, 23, 59, 59, 999); // last day of month
  return { from, to, label: yyyyMm };
}

async function fetchTxWindow(fromMs, toMs) {
  try {
    const { json } = await csFetch("GET", "/trade/api/v2/futures/transactions", {
      exchange: "EXCHANGE_2",
      from_time: fromMs,
      to_time: toMs,
      limit: 100,
    });
    return Array.isArray(json.data) ? json.data : [];
  } catch (e) {
    if (String(e.message).includes("400")) {
      const { json } = await csFetch("GET", "/trade/api/v2/futures/transactions", {
        exchange: "EXCHANGE_2",
      });
      return Array.isArray(json.data) ? json.data : [];
    }
    throw e;
  }
}

async function fetchClosedWindow(fromMs, toMs) {
  try {
    const body = {
      exchange: "EXCHANGE_2",
      limit: 50,
      from_time: fromMs,
      to_time: toMs,
    };
    const { json } = await csFetch("POST", "/trade/api/v2/futures/orders/closed", {}, body);
    return json?.data?.orders || json?.data || [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!process.env.COINSWITCH_API_KEY || !process.env.COINSWITCH_API_SECRET) {
      return res.status(500).json({ ok: false, error: "Missing CoinSwitch keys" });
    }
    if (!process.env.NOTION_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN" });
    }

    const mode = req.query?.mode || "month";

    if (mode === "transactions") {
      const { json, debug } = await csFetch("GET", "/trade/api/v2/futures/transactions", {
        exchange: "EXCHANGE_2",
      });
      const list = Array.isArray(json.data) ? json.data : [];
      return res.status(200).json({ ok: true, mode, fetched: list.length, sample: list.slice(0, 5), debug });
    }

    if (mode === "closed") {
      const body = { exchange: "EXCHANGE_2", limit: 50 };
      const { json, debug } = await csFetch("POST", "/trade/api/v2/futures/orders/closed", {}, body);
      const orders = json?.data?.orders || json?.data || [];
      return res.status(200).json({
        ok: true,
        mode,
        fetched: Array.isArray(orders) ? orders.length : 0,
        sample: Array.isArray(orders) ? orders.slice(0, 3) : orders,
        debug,
      });
    }

    if (mode === "balance") {
      const { json, debug } = await csFetch("GET", "/trade/api/v2/futures/wallet_balance", {
        exchange: "EXCHANGE_2",
      });
      return res.status(200).json({ ok: true, mode, data: json, debug });
    }

    // --- MONTH sync ---
    const now = new Date();
    const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthStr = (req.query?.month || defaultMonth).trim();
    if (!/^\d{4}-\d{2}$/.test(monthStr)) {
      return res.status(400).json({
        ok: false,
        error: "Use month=YYYY-MM e.g. month=2026-07",
      });
    }

    const { from: monthStart, to: monthEnd } = monthRange(monthStr);
    const allPnl = [];
    const seen = new Set();
    let txTotal = 0;
    let orderTotal = 0;
    const errors = [];

    // Walk the month in 7-day windows
    for (let to = monthEnd; to > monthStart; to -= WINDOW_MS) {
      const from = Math.max(monthStart, to - WINDOW_MS + 1);

      try {
        const txs = await fetchTxWindow(from, to);
        txTotal += txs.length;
        for (const tx of txs) {
          if (!isPnlType(tx.type)) continue;
          const amount = parseFloat(tx.amount);
          if (!amount || Number.isNaN(amount)) continue;
          const id = tx.transaction_id || `tx-${tx.symbol}-${tx.amount}-${tx.type}`;
          if (seen.has(id)) continue;
          seen.add(id);
          let date = new Date(to).toISOString().slice(0, 10);
          const ts = Number(tx.timestamp || tx.created_at || tx.time);
          if (ts > 1e11) date = new Date(ts).toISOString().slice(0, 10);
          allPnl.push({ pair: mapPair(tx.symbol), pnl: amount, date, source: "tx", id });
        }
      } catch (e) {
        errors.push({ type: "tx", error: e.message });
      }

      try {
        const orders = await fetchClosedWindow(from, to);
        orderTotal += Array.isArray(orders) ? orders.length : 0;
        for (const o of orders || []) {
          const amount = parseFloat(o.realised_pnl || o.realized_pnl || 0);
          if (!amount || Number.isNaN(amount)) continue;
          const id = o.order_id || `ord-${o.symbol}-${o.updated_at}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const ts = Number(o.updated_at || o.created_at || to);
          const date = new Date(ts > 1e11 ? ts : to).toISOString().slice(0, 10);
          allPnl.push({ pair: mapPair(o.symbol), pnl: amount, date, source: "order", id });
        }
      } catch (e) {
        errors.push({ type: "order", error: e.message });
      }

      await new Promise((r) => setTimeout(r, 150));
    }

    let created = 0;
    let failed = 0;
    const results = [];
    for (const row of allPnl) {
      try {
        await createNotionPage(row);
        created++;
        results.push({ pair: row.pair, pnl: row.pnl, date: row.date, source: row.source });
      } catch (e) {
        failed++;
        results.push({ error: e.message, pair: row.pair, pnl: row.pnl });
      }
    }

    return res.status(200).json({
      ok: true,
      mode: "month",
      month: monthStr,
      txFetched: txTotal,
      ordersFetched: orderTotal,
      uniquePnl: allPnl.length,
      created,
      failed,
      results,
      errors: errors.slice(0, 5),
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[sync-coinswitch]", err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      debug: err.debug || null,
      raw: err.raw || null,
    });
  }
}
