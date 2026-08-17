/**
 * CoinDCX → Notion
 * Env: COINDCX_API_KEY, COINDCX_API_SECRET, NOTION_TOKEN
 *
 * ?mode=probe
 * ?mode=sync   → pull working futures endpoints + write PnL to Notion
 * ?mode=month&month=2026-08
 */
import crypto from "crypto";

const NOTION_DB_ID =
  process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";
const BASE_URL = "https://api.coindcx.com";

const SYMBOL_TO_PAIR = {
  BTCUSDT: "Bitcoin", BTC_USDT: "Bitcoin", "B-BTC_USDT": "Bitcoin",
  ETHUSDT: "Eth", ETH_USDT: "Eth", "B-ETH_USDT": "Eth",
  SOLUSDT: "Solana", SOL_USDT: "Solana", "B-SOL_USDT": "Solana",
  XAGUSDT: "Silver", XAG_USDT: "Silver", "B-XAG_USDT": "Silver",
  XRPUSDT: "XRP", "B-XRP_USDT": "XRP",
  ADAUSDT: "ADA", AVAXUSDT: "AVAX", BNBUSDT: "BNB", DOGEUSDT: "DOGE",
};

function mapPair(symbol = "") {
  const s = String(symbol).toUpperCase().replace(/\//g, "_");
  if (SYMBOL_TO_PAIR[s]) return SYMBOL_TO_PAIR[s];
  const cleaned = s.replace(/^B-/, "").replace(/^I-/, "").replace(/_/g, "");
  if (SYMBOL_TO_PAIR[cleaned]) return SYMBOL_TO_PAIR[cleaned];
  return cleaned.replace("USDT", "").replace("INR", "") || "Other";
}

function compactJson(obj) {
  return JSON.stringify(obj);
}

async function coindcxPost(path, body = {}, opts = {}) {
  const key = process.env.COINDCX_API_KEY;
  const secret = process.env.COINDCX_API_SECRET;
  if (!key || !secret) throw new Error("Missing COINDCX_API_KEY or COINDCX_API_SECRET");

  const ts = opts.seconds ? Math.floor(Date.now() / 1000) : Date.now();
  const payload = { ...body, timestamp: ts };
  const bodyStr = compactJson(payload);
  const signature = crypto
    .createHmac("sha256", secret.trim())
    .update(bodyStr)
    .digest("hex");

  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": key.trim(),
      "X-AUTH-SIGNATURE": signature,
    },
    body: bodyStr,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return {
    ok: res.ok,
    status: res.status,
    json,
    text: json ? null : text.slice(0, 500),
    path,
  };
}

function asList(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.trades)) return json.trades;
  if (Array.isArray(json.transactions)) return json.transactions;
  if (Array.isArray(json.orders)) return json.orders;
  return [];
}

async function createNotionPage({ pair, pnl, date, name }) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing");
  const body = {
    parent: { database_id: NOTION_DB_ID },
    properties: {
      Name: { title: [{ text: { content: name || pair } }] },
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

function monthBounds(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  return {
    from: Date.UTC(y, m - 1, 1, 0, 0, 0, 0),
    to: Date.UTC(y, m, 0, 23, 59, 59, 999),
  };
}

function inMonth(ts, month) {
  if (!month) return true;
  const { from, to } = monthBounds(month);
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return ms >= from && ms <= to;
}

function toDate(ts) {
  const n = Number(ts);
  if (!n) return new Date().toISOString().slice(0, 10);
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Collect rows from the same endpoints that probe uses successfully */
async function collectRows(month) {
  const rows = [];
  const seen = new Set();
  const errors = [];
  const meta = {};

  // 1) Futures filled/cancelled orders — buy
  const buy = await coindcxPost(
    "/exchange/v1/derivatives/futures/orders",
    {
      status: "filled,partially_filled,partially_cancelled,cancelled",
      side: "buy",
      page: "1",
      size: "100",
      margin_currency_short_name: ["USDT", "INR"],
    },
    { seconds: true }
  );
  meta.buy = { status: buy.status, ok: buy.ok, count: asList(buy.json).length };
  if (!buy.ok) errors.push({ buy: buy.json || buy.text });
  else {
    for (const o of asList(buy.json)) {
      const ts = o.updated_at || o.created_at || o.timestamp;
      if (month && !inMonth(ts, month)) continue;
      // Prefer realised pnl fields; else 0 (order list may not have PnL)
      const pnl = parseFloat(
        o.realised_pnl ?? o.realized_pnl ?? o.pnl ?? o.profit ?? 0
      );
      const pair = mapPair(o.pair || o.symbol || "");
      const id = String(o.id || `buy-${o.pair}-${ts}`);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        pair,
        pnl,
        date: toDate(ts),
        name: pair,
        id,
        source: "futures_order_buy",
        status: o.status,
        side: o.side,
      });
    }
  }

  // 2) Futures orders — sell
  const sell = await coindcxPost(
    "/exchange/v1/derivatives/futures/orders",
    {
      status: "filled,partially_filled,partially_cancelled,cancelled",
      side: "sell",
      page: "1",
      size: "100",
      margin_currency_short_name: ["USDT", "INR"],
    },
    { seconds: true }
  );
  meta.sell = { status: sell.status, ok: sell.ok, count: asList(sell.json).length };
  if (!sell.ok) errors.push({ sell: sell.json || sell.text });
  else {
    for (const o of asList(sell.json)) {
      const ts = o.updated_at || o.created_at || o.timestamp;
      if (month && !inMonth(ts, month)) continue;
      const pnl = parseFloat(
        o.realised_pnl ?? o.realized_pnl ?? o.pnl ?? o.profit ?? 0
      );
      const pair = mapPair(o.pair || o.symbol || "");
      const id = String(o.id || `sell-${o.pair}-${ts}`);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        pair,
        pnl,
        date: toDate(ts),
        name: pair,
        id,
        source: "futures_order_sell",
        status: o.status,
        side: o.side,
      });
    }
  }

  // 3) Futures position transactions (amount = PnL) — best source for realised PnL
  const tx = await coindcxPost(
    "/exchange/v1/derivatives/futures/positions/transactions",
    {
      stage: "all",
      page: "1",
      size: "100",
      margin_currency_short_name: ["USDT", "INR"],
    },
    { seconds: true }
  );
  meta.tx = { status: tx.status, ok: tx.ok, count: asList(tx.json).length };
  if (!tx.ok) errors.push({ tx: tx.json || tx.text });
  else {
    for (const t of asList(tx.json)) {
      const ts = t.created_at || t.updated_at || t.timestamp;
      if (month && !inMonth(ts, month)) continue;
      const stage = String(t.stage || "").toLowerCase();
      if (stage === "funding") continue;
      const pnl = parseFloat(t.amount ?? t.realised_pnl ?? t.pnl ?? 0);
      const pair = mapPair(t.pair || t.symbol || "");
      const id = String(t.id || t.parent_id || `tx-${t.position_id}-${ts}-${pnl}`);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        pair,
        pnl,
        date: toDate(ts),
        name: pair,
        id,
        source: "futures_tx",
        stage,
      });
    }
  }

  // 4) Spot trade history (backup)
  const spot = await coindcxPost("/exchange/v1/orders/trade_history", {
    limit: 200,
    sort: "desc",
  });
  meta.spot = { status: spot.status, ok: spot.ok, count: asList(spot.json).length };
  if (spot.ok) {
    for (const t of asList(spot.json)) {
      const ts = t.timestamp || t.T || t.time || t.created_at;
      if (month && !inMonth(ts, month)) continue;
      const pnl = parseFloat(
        t.realised_pnl ?? t.realized_pnl ?? t.pnl ?? t.profit ?? 0
      );
      const pair = mapPair(t.symbol || t.market || t.pair || "");
      const id = String(t.id || t.trade_id || `spot-${t.order_id}-${ts}`);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        pair,
        pnl,
        date: toDate(ts),
        name: pair,
        id,
        source: "spot",
      });
    }
  }

  return { rows, errors, meta };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!process.env.COINDCX_API_KEY || !process.env.COINDCX_API_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Missing COINDCX_API_KEY or COINDCX_API_SECRET",
      });
    }

    const mode = req.query?.mode || "probe";
    const month = (req.query?.month || "").trim();

    if (mode === "probe") {
      const { rows, errors, meta } = await collectRows(null);
      return res.status(200).json({
        ok: true,
        source: "coindcx",
        mode: "probe",
        meta,
        totalRows: rows.length,
        withPnl: rows.filter((r) => r.pnl).length,
        sample: rows.slice(0, 10),
        errors,
      });
    }

    if (mode === "sync" || mode === "month") {
      if (!process.env.NOTION_TOKEN) {
        return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN" });
      }
      if (mode === "month" && !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({
          ok: false,
          error: "Use month=YYYY-MM e.g. month=2026-08",
        });
      }

      const { rows, errors, meta } = await collectRows(
        mode === "month" ? month : null
      );

      // Prefer writing rows that have PnL; if none have PnL, write filled orders as 0? 
      // User asked realised pnl only earlier — write non-zero only, but if all zero report clearly
      const toWrite = rows.filter((r) => r.pnl !== 0 && !Number.isNaN(r.pnl));
      // If transactions gave nothing but we have filled orders, still try write non-zero only

      let created = 0;
      const results = [];
      for (const row of toWrite) {
        try {
          await createNotionPage(row);
          created++;
          results.push({
            pair: row.pair,
            pnl: row.pnl,
            date: row.date,
            source: row.source,
          });
        } catch (e) {
          results.push({ error: e.message, pair: row.pair, pnl: row.pnl });
        }
      }

      return res.status(200).json({
        ok: true,
        source: "coindcx",
        mode,
        month: month || null,
        meta,
        fetched: rows.length,
        withPnl: toWrite.length,
        created,
        results: results.slice(0, 60),
        skippedZero: rows.length - toWrite.length,
        errors,
        syncedAt: new Date().toISOString(),
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Use mode=probe | mode=sync | mode=month&month=YYYY-MM",
    });
  } catch (err) {
    console.error("[sync-coindcx]", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
