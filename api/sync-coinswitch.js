/**
 * CoinSwitch Futures → Notion
 *
 * ?mode=probe&month=2026-01  → raw diagnostic for that month
 * ?mode=month&month=2026-01  → sync that month to Notion
 * ?mode=closed|transactions|balance
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const nacl = require("../lib/nacl.cjs");

const NOTION_DB_ID =
  process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";
const BASE_URL = "https://coinswitch.co";

const SYMBOL_TO_PAIR = {
  BTCUSDT: "Bitcoin", ETHUSDT: "Eth", SOLUSDT: "Solana", SUIUSDT: "Sui",
  XRPUSDT: "XRP", ADAUSDT: "ADA", AVAXUSDT: "AVAX", BNBUSDT: "BNB",
  DOGEUSDT: "DOGE", LINKUSDT: "LINK", MATICUSDT: "MATIC", NEARUSDT: "NEAR",
  ATOMUSDT: "ATOM", AAVEUSDT: "AAVE", DOTUSDT: "DOT", LTCUSDT: "LTC",
  UNIUSDT: "UNI", APTUSDT: "APT", ARBUSDT: "ARB", OPUSDT: "OP",
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
  // Body is NOT part of signature when epoch is sent
  const message = method.toUpperCase() + fullPath + epoch;
  const messageBytes = new TextEncoder().encode(message);

  const seed = Uint8Array.from(Buffer.from(secretHex.trim(), "hex"));
  const secretKey =
    seed.length === 32
      ? nacl.sign.keyPair.fromSeed(seed).secretKey
      : seed.length === 64
        ? seed
        : null;
  if (!secretKey) throw new Error(`Bad secret length ${seed.length}`);

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
    debug: { method, fullPath, epoch, body: bodyObj },
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
    const e = new Error(`Non-JSON ${res.status}: ${text.slice(0, 300)}`);
    e.debug = signed.debug;
    throw e;
  }
  return {
    ok: res.ok,
    status: res.status,
    json,
    debug: signed.debug,
    text: text.slice(0, 500),
  };
}

function monthBounds(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const from = Date.UTC(y, m - 1, 1, 0, 0, 0, 0);
  const to = Date.UTC(y, m, 0, 23, 59, 59, 999);
  return { from, to };
}

/** Split month into 7-day windows */
function windowsForMonth(yyyyMm) {
  const { from, to } = monthBounds(yyyyMm);
  const wins = [];
  for (let t = from; t <= to; t += 7 * 24 * 60 * 60 * 1000) {
    wins.push({ from: t, to: Math.min(t + 7 * 24 * 60 * 60 * 1000 - 1, to) });
  }
  return wins;
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
  if (!res.ok) throw new Error(`Notion ${(await res.text()).slice(0, 250)}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!process.env.COINSWITCH_API_KEY || !process.env.COINSWITCH_API_SECRET) {
      return res.status(500).json({ ok: false, error: "Missing CoinSwitch keys" });
    }

    const mode = req.query?.mode || "probe";
    const month = (req.query?.month || "2026-01").trim();

    // -------- PROBE: try every combination and return raw results --------
    if (mode === "probe") {
      const { from, to } = monthBounds(month);
      const results = {};

      // A) closed orders — no time filter (last 7 days only)
      results.closed_no_time = await csFetch(
        "POST",
        "/trade/api/v2/futures/orders/closed",
        {},
        { exchange: "EXCHANGE_2", limit: 50 }
      );

      // B) closed orders — with from_time/to_time in body for full month
      results.closed_with_time = await csFetch(
        "POST",
        "/trade/api/v2/futures/orders/closed",
        {},
        {
          exchange: "EXCHANGE_2",
          limit: 50,
          from_time: from,
          to_time: to,
        }
      );

      // C) closed — first 7-day window of the month only
      const firstWin = windowsForMonth(month)[0];
      results.closed_7day = await csFetch(
        "POST",
        "/trade/api/v2/futures/orders/closed",
        {},
        {
          exchange: "EXCHANGE_2",
          limit: 50,
          from_time: firstWin.from,
          to_time: firstWin.to,
        }
      );

      // D) transactions no time
      results.tx_no_time = await csFetch(
        "GET",
        "/trade/api/v2/futures/transactions",
        { exchange: "EXCHANGE_2" }
      );

      // E) transactions with time (query)
      results.tx_with_time = await csFetch(
        "GET",
        "/trade/api/v2/futures/transactions",
        {
          exchange: "EXCHANGE_2",
          from_time: firstWin.from,
          to_time: firstWin.to,
          limit: 50,
        }
      );

      // F) open orders (sanity)
      results.open = await csFetch(
        "POST",
        "/trade/api/v2/futures/orders/open",
        {},
        { exchange: "EXCHANGE_2", limit: 20 }
      );

      // G) positions
      results.positions = await csFetch(
        "GET",
        "/trade/api/v2/futures/positions",
        { exchange: "EXCHANGE_2" }
      );

      // Summarize counts
      const summary = {};
      for (const [k, v] of Object.entries(results)) {
        const d = v.json?.data;
        let count = 0;
        if (Array.isArray(d)) count = d.length;
        else if (d?.orders) count = d.orders.length;
        else if (d && typeof d === "object") count = Object.keys(d).length;
        summary[k] = { status: v.status, ok: v.ok, count, message: v.json?.message || null };
      }

      return res.status(200).json({
        ok: true,
        mode: "probe",
        month,
        monthMs: { from, to },
        summary,
        // full raw for the most useful ones (truncated)
        closed_with_time: results.closed_with_time.json,
        closed_7day: results.closed_7day.json,
        tx_with_time: results.tx_with_time.json,
        closed_no_time: results.closed_no_time.json,
      });
    }

    // -------- MONTH SYNC --------
    if (mode === "month") {
      if (!process.env.NOTION_TOKEN) {
        return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN" });
      }
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ ok: false, error: "month=YYYY-MM required" });
      }

      const wins = windowsForMonth(month);
      const all = [];
      const seen = new Set();
      const errors = [];

      for (const w of wins) {
        // Closed orders
        const closed = await csFetch(
          "POST",
          "/trade/api/v2/futures/orders/closed",
          {},
          {
            exchange: "EXCHANGE_2",
            limit: 50,
            from_time: w.from,
            to_time: w.to,
          }
        );
        if (!closed.ok) {
          errors.push({ window: w, closed: closed.json });
        } else {
          const orders = closed.json?.data?.orders || closed.json?.data || [];
          for (const o of orders) {
            const pnl = parseFloat(o.realised_pnl || o.realized_pnl || 0);
            if (!pnl) continue;
            const id = o.order_id || `o-${o.symbol}-${o.updated_at}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const ts = Number(o.updated_at || o.created_at || w.to);
            all.push({
              pair: mapPair(o.symbol),
              pnl,
              date: new Date(ts > 1e11 ? ts : w.to).toISOString().slice(0, 10),
              source: "order",
              id,
            });
          }
        }

        // Transactions
        const tx = await csFetch(
          "GET",
          "/trade/api/v2/futures/transactions",
          {
            exchange: "EXCHANGE_2",
            from_time: w.from,
            to_time: w.to,
            limit: 100,
          }
        );
        if (tx.ok) {
          for (const t of tx.json?.data || []) {
            const typ = String(t.type || "").toUpperCase().replace(/\s+/g, "");
            if (!typ.includes("PNL")) continue;
            const pnl = parseFloat(t.amount);
            if (!pnl) continue;
            const id = t.transaction_id || `t-${t.symbol}-${t.amount}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const ts = Number(t.timestamp || t.created_at || w.to);
            all.push({
              pair: mapPair(t.symbol),
              pnl,
              date: new Date(ts > 1e11 ? ts : w.to).toISOString().slice(0, 10),
              source: "tx",
              id,
            });
          }
        } else {
          errors.push({ window: w, tx: tx.json });
        }

        await new Promise((r) => setTimeout(r, 150));
      }

      let created = 0;
      const results = [];
      for (const row of all) {
        try {
          await createNotionPage(row);
          created++;
          results.push(row);
        } catch (e) {
          results.push({ error: e.message, ...row });
        }
      }

      return res.status(200).json({
        ok: true,
        mode: "month",
        month,
        windows: wins.length,
        uniquePnl: all.length,
        created,
        results,
        errors: errors.slice(0, 5),
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Use mode=probe|month|closed|transactions|balance",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      debug: err.debug || null,
    });
  }
}
