/**
 * CoinDCX → Notion Trade PnL Tracker
 *
 * Env:
 *   COINDCX_API_KEY
 *   COINDCX_API_SECRET
 *   NOTION_TOKEN
 * Optional: NOTION_TRADES_DB_ID
 *
 * ?mode=probe
 * ?mode=sync
 * ?mode=month&month=2026-05
 */
import crypto from "crypto";

const NOTION_DB_ID =
  process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";
const BASE_URL = "https://api.coindcx.com";

const SYMBOL_TO_PAIR = {
  BTCUSDT: "Bitcoin",
  BTC_USDT: "Bitcoin",
  "B-BTC_USDT": "Bitcoin",
  ETHUSDT: "Eth",
  ETH_USDT: "Eth",
  SOLUSDT: "Solana",
  SOL_USDT: "Solana",
  XAGUSDT: "Silver",
  XAG_USDT: "Silver",
  "B-XAG_USDT": "Silver",
  XRPUSDT: "XRP",
  ADAUSDT: "ADA",
  AVAXUSDT: "AVAX",
  BNBUSDT: "BNB",
  DOGEUSDT: "DOGE",
};

function mapPair(symbol = "") {
  const s = String(symbol).toUpperCase().replace(/\//g, "_");
  if (SYMBOL_TO_PAIR[s]) return SYMBOL_TO_PAIR[s];
  const cleaned = s.replace(/^B-/, "").replace(/^I-/, "").replace(/_/g, "");
  if (SYMBOL_TO_PAIR[cleaned]) return SYMBOL_TO_PAIR[cleaned];
  return cleaned.replace("USDT", "").replace("INR", "") || "Other";
}

function signBody(bodyObj, secret) {
  const jsonBody = JSON.stringify(bodyObj);
  return crypto.createHmac("sha256", secret).update(jsonBody).digest("hex");
}

async function coindcxPost(path, body = {}) {
  const key = process.env.COINDCX_API_KEY;
  const secret = process.env.COINDCX_API_SECRET;
  if (!key || !secret) throw new Error("Missing COINDCX_API_KEY or COINDCX_API_SECRET");

  const payload = { ...body, timestamp: Date.now() };
  const signature = signBody(payload, secret.trim());

  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": key.trim(),
      "X-AUTH-SIGNATURE": signature,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, json: null, text: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json, text: null };
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

/** Spot/margin account trade history */
async function fetchSpotTrades(limit = 500) {
  return coindcxPost("/exchange/v1/orders/trade_history", {
    limit,
    sort: "desc",
  });
}

/** Futures position transactions (includes amount = PnL) */
async function fetchFuturesTransactions(page = "1", size = "50") {
  return coindcxPost(
    "/exchange/v1/derivatives/futures/positions/transactions",
    {
      stage: "all",
      page: String(page),
      size: String(size),
      margin_currency_short_name: ["USDT"],
    }
  );
}

async function fetchUserInfo() {
  return coindcxPost("/exchange/v1/users/info", {});
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

    // -------- PROBE --------
    if (mode === "probe") {
      const [user, spot, fut] = await Promise.all([
        fetchUserInfo(),
        fetchSpotTrades(20),
        fetchFuturesTransactions("1", "20"),
      ]);

      const spotList = Array.isArray(spot.json)
        ? spot.json
        : spot.json?.data || spot.json?.trades || [];
      const futList = Array.isArray(fut.json)
        ? fut.json
        : fut.json?.data || fut.json?.transactions || [];

      return res.status(200).json({
        ok: true,
        source: "coindcx",
        mode: "probe",
        user: {
          status: user.status,
          ok: user.ok,
          keys: user.json ? Object.keys(user.json).slice(0, 15) : null,
          error: user.ok ? null : user.json || user.text,
        },
        spot_trades: {
          status: spot.status,
          ok: spot.ok,
          count: Array.isArray(spotList) ? spotList.length : 0,
          sample: Array.isArray(spotList) ? spotList.slice(0, 2) : spot.json,
        },
        futures_transactions: {
          status: fut.status,
          ok: fut.ok,
          count: Array.isArray(futList) ? futList.length : 0,
          sample: Array.isArray(futList) ? futList.slice(0, 2) : fut.json,
        },
      });
    }

    // -------- SYNC / MONTH --------
    if (mode === "sync" || mode === "month") {
      if (!process.env.NOTION_TOKEN) {
        return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN" });
      }

      const rows = [];
      const seen = new Set();
      const errors = [];

      // 1) Spot trade history
      const spot = await fetchSpotTrades(500);
      if (spot.ok) {
        const list = Array.isArray(spot.json)
          ? spot.json
          : spot.json?.data || spot.json?.trades || [];
        for (const t of list) {
          const ts = Number(t.timestamp || t.T || t.time || t.created_at || 0);
          if (month && !inMonth(ts, month)) continue;
          const pair = mapPair(t.symbol || t.market || t.pair || "");
          const pnl = parseFloat(
            t.realised_pnl ?? t.realized_pnl ?? t.pnl ?? t.profit ?? 0
          );
          const id = String(t.id || t.trade_id || `spot-${t.order_id}-${ts}`);
          if (seen.has(id)) continue;
          seen.add(id);
          const ms = ts < 1e12 ? ts * 1000 : ts;
          rows.push({
            pair,
            pnl: pnl || 0,
            date: new Date(ms || Date.now()).toISOString().slice(0, 10),
            name: pair,
            id,
            source: "spot",
          });
        }
      } else {
        errors.push({ spot: spot.json || spot.text });
      }

      // 2) Futures position transactions (amount = PnL)
      const fut = await fetchFuturesTransactions("1", "100");
      if (fut.ok) {
        const list = Array.isArray(fut.json)
          ? fut.json
          : fut.json?.data || fut.json?.transactions || [];
        for (const t of list) {
          const ts = Number(
            t.created_at || t.timestamp || t.updated_at || Date.now()
          );
          if (month && !inMonth(ts, month)) continue;
          const pair = mapPair(t.pair || t.symbol || t.market || "");
          const pnl = parseFloat(t.amount ?? t.realised_pnl ?? t.pnl ?? 0);
          // Skip pure funding if stage indicates funding and you only want trading PnL
          const stage = String(t.stage || t.source || "").toLowerCase();
          if (stage.includes("funding") && !pnl) continue;
          const id = String(
            t.id || t.parent_id || `fut-${t.position_id}-${ts}-${pnl}`
          );
          if (seen.has(id)) continue;
          seen.add(id);
          const ms = ts < 1e12 ? ts * 1000 : ts;
          rows.push({
            pair,
            pnl: pnl || 0,
            date: new Date(ms || Date.now()).toISOString().slice(0, 10),
            name: pair,
            id,
            source: "futures",
            stage,
          });
        }
      } else {
        errors.push({ futures: fut.json || fut.text });
      }

      let created = 0;
      const results = [];
      for (const row of rows) {
        if (!row.pnl) {
          results.push({
            skipped: true,
            reason: "zero_pnl",
            pair: row.pair,
            date: row.date,
            source: row.source,
          });
          continue;
        }
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
          results.push({ error: e.message, pair: row.pair });
        }
      }

      return res.status(200).json({
        ok: true,
        source: "coindcx",
        mode,
        month: month || null,
        unique: rows.length,
        withPnl: rows.filter((r) => r.pnl).length,
        created,
        results: results.slice(0, 50),
        errors: errors.slice(0, 5),
        syncedAt: new Date().toISOString(),
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Use mode=probe | mode=sync | mode=month&month=YYYY-MM",
    });
  } catch (err) {
    console.error("[sync-coindcx]", err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
}
