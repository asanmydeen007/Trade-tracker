/**
 * CoinSwitch Spot + Futures history → Notion
 *
 * Env (either name works for secret):
 *   COINSWITCH_API_KEY
 *   COINSWITCH_API_SECRET  or  COINSWITCH_SECRET_KEY
 *   NOTION_TOKEN
 *
 * ?mode=probe&month=2026-01&date=2026-01-30
 * ?mode=month&month=2026-01
 * ?mode=spot&month=2026-01
 */
import crypto from "crypto";

const NOTION_DB_ID =
  process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";
const BASE_URL = "https://coinswitch.co";

const SYMBOL_TO_PAIR = {
  BTCUSDT: "Bitcoin", "BTC/USDT": "Bitcoin", BTCINR: "Bitcoin",
  ETHUSDT: "Eth", "ETH/USDT": "Eth", ETHINR: "Eth",
  SOLUSDT: "Solana", "SOL/USDT": "Solana",
  SUIUSDT: "Sui", XRPUSDT: "XRP", ADAUSDT: "ADA",
  AVAXUSDT: "AVAX", BNBUSDT: "BNB", DOGEUSDT: "DOGE",
};

function mapPair(symbol = "") {
  const s = String(symbol).toUpperCase();
  if (SYMBOL_TO_PAIR[s]) return SYMBOL_TO_PAIR[s];
  const base = s.replace("/", "").replace("USDT", "").replace("INR", "");
  return base || "Other";
}

function getSecret() {
  return (
    process.env.COINSWITCH_API_SECRET ||
    process.env.COINSWITCH_SECRET_KEY ||
    ""
  );
}

/** Ed25519 via Node crypto (PKCS8-wrapped 32-byte seed) */
function loadEd25519PrivateKey(secretHex) {
  const rawSeed = Buffer.from(secretHex.trim(), "hex");
  if (rawSeed.length !== 32) {
    throw new Error(
      `Secret must be 32-byte hex (got ${rawSeed.length} bytes)`
    );
  }
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const der = Buffer.concat([pkcs8Prefix, rawSeed]);
  return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function signRequest(method, path, params = {}) {
  const apiKey = process.env.COINSWITCH_API_KEY;
  const secretHex = getSecret();
  if (!apiKey || !secretHex) throw new Error("Missing CoinSwitch API key/secret");

  const url = new URL(path, BASE_URL);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
  });

  // CoinSwitch signs URL-DECODED path + query
  const decodedPath = decodeURIComponent(url.pathname + url.search);
  const epoch = Date.now().toString();
  const message = method.toUpperCase() + decodedPath + epoch;

  const privateKey = loadEd25519PrivateKey(secretHex);
  const signature = crypto
    .sign(null, Buffer.from(message, "utf8"), privateKey)
    .toString("hex");

  return {
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": apiKey.trim(),
      "X-AUTH-SIGNATURE": signature,
      "X-AUTH-EPOCH": epoch,
    },
    path: decodedPath,
    url: BASE_URL + decodedPath,
    debug: { method, decodedPath, epoch },
  };
}

async function csGet(path, params = {}) {
  const signed = signRequest("GET", path, params);
  const res = await fetch(signed.url, { method: "GET", headers: signed.headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, json: null, text: text.slice(0, 400), debug: signed.debug };
  }
  return { ok: res.ok, status: res.status, json, debug: signed.debug };
}

async function csPost(path, body = {}) {
  // POST: sign path WITHOUT body (epoch present)
  const signed = signRequest("POST", path, {});
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: signed.headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, json: null, text: text.slice(0, 400), debug: signed.debug };
  }
  return { ok: res.ok, status: res.status, json, debug: signed.debug };
}

function monthBounds(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  return {
    from: Date.UTC(y, m - 1, 1, 0, 0, 0, 0),
    to: Date.UTC(y, m, 0, 23, 59, 59, 999),
  };
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
  if (!res.ok) throw new Error(`Notion ${(await res.text()).slice(0, 250)}`);
  return res.json();
}

/** Spot orders with pagination */
async function fetchSpotOrders(fromMs, toMs) {
  const all = [];
  let cursor = null;
  let pages = 0;
  do {
    const params = {
      from_time: fromMs,
      to_time: toMs,
      count: 100,
    };
    if (cursor) params.cursor = cursor;

    const r = await csGet("/trade/api/v2/orders", params);
    if (!r.ok) {
      return { orders: all, error: r.json || r.text, status: r.status, debug: r.debug };
    }
    const orders = r.json?.data?.orders ?? r.json?.data ?? [];
    if (Array.isArray(orders)) all.push(...orders);
    cursor = r.json?.data?.cursor ?? null;
    pages++;
    if (pages > 50) break;
    if (cursor) await new Promise((x) => setTimeout(x, 150));
  } while (cursor);

  return { orders: all, error: null };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!process.env.COINSWITCH_API_KEY || !getSecret()) {
      return res.status(500).json({
        ok: false,
        error: "Missing COINSWITCH_API_KEY or COINSWITCH_API_SECRET / COINSWITCH_SECRET_KEY",
      });
    }

    const mode = req.query?.mode || "probe";
    const month = (req.query?.month || "2026-01").trim();
    const dateStr = (req.query?.date || "").trim();

    // -------- PROBE --------
    if (mode === "probe") {
      const { from, to } = monthBounds(month);
      const summary = {};
      const raw = {};

      // Spot: full month (may work — Spot often allows longer ranges)
      const spotMonth = await csGet("/trade/api/v2/orders", {
        from_time: from,
        to_time: to,
        count: 50,
      });
      summary.spot_month = {
        status: spotMonth.status,
        ok: spotMonth.ok,
        count: (spotMonth.json?.data?.orders ?? spotMonth.json?.data ?? [])?.length || 0,
        message: spotMonth.json?.message || null,
      };
      raw.spot_month = spotMonth.json;

      // Spot: 7 days ending on date if provided
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [yy, mm, dd] = dateStr.split("-").map(Number);
        const dayEnd = Date.UTC(yy, mm - 1, dd, 23, 59, 59, 999);
        const dayFrom = dayEnd - 6 * 24 * 60 * 60 * 1000;
        const spotDay = await csGet("/trade/api/v2/orders", {
          from_time: dayFrom,
          to_time: dayEnd,
          count: 50,
        });
        summary.spot_on_date = {
          status: spotDay.status,
          ok: spotDay.ok,
          count: (spotDay.json?.data?.orders ?? spotDay.json?.data ?? [])?.length || 0,
          message: spotDay.json?.message || null,
        };
        raw.spot_on_date = spotDay.json;
      }

      // Spot: list without time (recent)
      const spotRecent = await csGet("/trade/api/v2/orders", { count: 20 });
      summary.spot_recent = {
        status: spotRecent.status,
        ok: spotRecent.ok,
        count: (spotRecent.json?.data?.orders ?? spotRecent.json?.data ?? [])?.length || 0,
        message: spotRecent.json?.message || null,
      };
      raw.spot_recent = spotRecent.json;

      // Futures closed 7d around date (for comparison)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [yy, mm, dd] = dateStr.split("-").map(Number);
        const dayEnd = Date.UTC(yy, mm - 1, dd, 23, 59, 59, 999);
        const dayFrom = dayEnd - 6 * 24 * 60 * 60 * 1000;
        const fut = await csPost("/trade/api/v2/futures/orders/closed", {
          exchange: "EXCHANGE_2",
          limit: 50,
          from_time: dayFrom,
          to_time: dayEnd,
        });
        summary.futures_on_date = {
          status: fut.status,
          ok: fut.ok,
          count: (fut.json?.data?.orders ?? [])?.length || 0,
          message: fut.json?.message || null,
        };
        raw.futures_on_date = fut.json;
      }

      return res.status(200).json({
        ok: true,
        mode: "probe",
        month,
        date: dateStr || null,
        summary,
        raw,
      });
    }

    // -------- SPOT / MONTH SYNC → Notion --------
    if (mode === "month" || mode === "spot") {
      if (!process.env.NOTION_TOKEN) {
        return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN" });
      }
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ ok: false, error: "month=YYYY-MM required" });
      }

      const { from, to } = monthBounds(month);
      const { orders, error, status, debug } = await fetchSpotOrders(from, to);

      if (error && orders.length === 0) {
        return res.status(200).json({
          ok: false,
          mode,
          month,
          error,
          status,
          debug,
          hint: "Spot /trade/api/v2/orders returned no data. Check API key permissions and that history is Spot.",
        });
      }

      // Map orders → PnL rows (best-effort)
      // Spot orders may not have realised_pnl; use filled value heuristics
      const rows = [];
      const seen = new Set();
      for (const o of orders) {
        const id = o.order_id || o.id || JSON.stringify(o).slice(0, 80);
        if (seen.has(id)) continue;
        seen.add(id);

        // Prefer explicit pnl fields
        let pnl = parseFloat(
          o.realised_pnl ?? o.realized_pnl ?? o.pnl ?? o.profit ?? NaN
        );

        // If no pnl, skip pure open orders; for filled, try quote delta
        if (Number.isNaN(pnl)) {
          const side = String(o.side || "").toLowerCase();
          const avg = parseFloat(o.avg_execution_price || o.average_price || o.price || 0);
          const qty = parseFloat(o.exec_quantity || o.filled_quantity || o.quantity || 0);
          // Without cost basis we cannot invent PnL — store 0 and still log the trade name
          if (!qty) continue;
          pnl = 0; // structural log only
        }

        const ts = Number(o.updated_at || o.created_at || o.timestamp || to);
        const date = new Date(ts > 1e11 ? ts : to).toISOString().slice(0, 10);
        const pair = mapPair(o.symbol || o.market || o.pair || "");
        rows.push({
          pair,
          pnl,
          date,
          name: pair,
          id,
          side: o.side,
          status: o.status,
        });
      }

      // Only write rows with non-zero pnl to Notion (realised)
      let created = 0;
      const results = [];
      for (const row of rows) {
        if (!row.pnl) {
          results.push({ skipped: true, reason: "no_pnl", pair: row.pair, date: row.date });
          continue;
        }
        try {
          await createNotionPage(row);
          created++;
          results.push({ pair: row.pair, pnl: row.pnl, date: row.date });
        } catch (e) {
          results.push({ error: e.message, pair: row.pair });
        }
      }

      return res.status(200).json({
        ok: true,
        mode,
        month,
        ordersFetched: orders.length,
        withPnl: rows.filter((r) => r.pnl).length,
        created,
        results: results.slice(0, 40),
        sampleOrder: orders[0] || null,
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Use mode=probe|month|spot",
    });
  } catch (err) {
    console.error("[sync-coinswitch]", err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
}
