/**
 * CoinDCX → Notion
 * Env: COINDCX_API_KEY, COINDCX_API_SECRET, NOTION_TOKEN
 *
 * ?mode=probe | sync | month&month=YYYY-MM
 */
import crypto from "crypto";

const NOTION_DB_ID =
  process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";
const BASE_URL = "https://api.coindcx.com";

const SYMBOL_TO_PAIR = {
  BTCUSDT: "Bitcoin", BTC_USDT: "Bitcoin", "B-BTC_USDT": "Bitcoin",
  ETHUSDT: "Eth", ETH_USDT: "Eth",
  SOLUSDT: "Solana", SOL_USDT: "Solana",
  XAGUSDT: "Silver", XAG_USDT: "Silver", "B-XAG_USDT": "Silver",
  XRPUSDT: "XRP", ADAUSDT: "ADA", AVAXUSDT: "AVAX", BNBUSDT: "BNB", DOGEUSDT: "DOGE",
};

function mapPair(symbol = "") {
  const s = String(symbol).toUpperCase().replace(/\//g, "_");
  if (SYMBOL_TO_PAIR[s]) return SYMBOL_TO_PAIR[s];
  const cleaned = s.replace(/^B-/, "").replace(/^I-/, "").replace(/_/g, "");
  if (SYMBOL_TO_PAIR[cleaned]) return SYMBOL_TO_PAIR[cleaned];
  return cleaned.replace("USDT", "").replace("INR", "") || "Other";
}

/** Compact JSON — CoinDCX signs this exact string */
function compactJson(obj) {
  return JSON.stringify(obj);
}

function signBody(bodyObj, secret) {
  return crypto
    .createHmac("sha256", secret.trim())
    .update(compactJson(bodyObj))
    .digest("hex");
}

async function coindcxPost(path, body = {}, opts = {}) {
  const key = process.env.COINDCX_API_KEY;
  const secret = process.env.COINDCX_API_SECRET;
  if (!key || !secret) throw new Error("Missing COINDCX_API_KEY or COINDCX_API_SECRET");

  // Some futures endpoints want seconds; default ms
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
    payloadKeys: Object.keys(payload),
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

function asList(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.trades)) return json.trades;
  if (Array.isArray(json.transactions)) return json.transactions;
  if (Array.isArray(json.orders)) return json.orders;
  return [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const key = process.env.COINDCX_API_KEY;
    const secret = process.env.COINDCX_API_SECRET;
    if (!key || !secret) {
      return res.status(500).json({
        ok: false,
        error: "Missing COINDCX_API_KEY or COINDCX_API_SECRET",
        hasKey: !!key,
        hasSecret: !!secret,
      });
    }

    const mode = req.query?.mode || "probe";
    const month = (req.query?.month || "").trim();

    if (mode === "probe") {
      // Try several endpoints to see which auth/data works
      const trials = {};

      trials.user_info = await coindcxPost("/exchange/v1/users/info", {});
      trials.balances = await coindcxPost("/exchange/v1/users/balances", {});
      trials.spot_trades = await coindcxPost("/exchange/v1/orders/trade_history", {
        limit: 50,
        sort: "desc",
      });
      trials.spot_trades_from_ts = await coindcxPost(
        "/exchange/v1/orders/trade_history",
        {
          limit: 50,
          from_timestamp: Date.now() - 90 * 24 * 60 * 60 * 1000,
          to_timestamp: Date.now(),
        }
      );
      trials.active_orders = await coindcxPost("/exchange/v1/orders/active_orders", {});
      trials.futures_tx_ms = await coindcxPost(
        "/exchange/v1/derivatives/futures/positions/transactions",
        {
          stage: "all",
          page: "1",
          size: "50",
          margin_currency_short_name: ["USDT"],
        }
      );
      trials.futures_tx_sec = await coindcxPost(
        "/exchange/v1/derivatives/futures/positions/transactions",
        {
          stage: "all",
          page: "1",
          size: "50",
          margin_currency_short_name: ["USDT"],
        },
        { seconds: true }
      );
      trials.margin_orders = await coindcxPost("/exchange/v1/margin/fetch_orders", {
        status: "close",
        size: 50,
        details: true,
      });

      const summary = {};
      for (const [name, r] of Object.entries(trials)) {
        const list = asList(r.json);
        summary[name] = {
          status: r.status,
          ok: r.ok,
          count: list.length,
          message:
            r.json?.message ||
            r.json?.error ||
            r.json?.code ||
            (typeof r.json === "string" ? r.json : null) ||
            r.text,
          sampleKeys:
            list[0] && typeof list[0] === "object"
              ? Object.keys(list[0]).slice(0, 12)
              : r.json && typeof r.json === "object"
                ? Object.keys(r.json).slice(0, 12)
                : null,
        };
      }

      return res.status(200).json({
        ok: true,
        source: "coindcx",
        mode: "probe",
        keyPrefix: key.trim().slice(0, 8) + "...",
        secretLen: secret.trim().length,
        summary,
        // raw samples for the most useful endpoints
        raw: {
          user_info: trials.user_info.json || trials.user_info.text,
          spot_trades: trials.spot_trades.json || trials.spot_trades.text,
          futures_tx_ms: trials.futures_tx_ms.json || trials.futures_tx_ms.text,
          futures_tx_sec: trials.futures_tx_sec.json || trials.futures_tx_sec.text,
          balances: trials.balances.json || trials.balances.text,
        },
      });
    }

    if (mode === "sync" || mode === "month") {
      if (!process.env.NOTION_TOKEN) {
        return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN" });
      }

      const rows = [];
      const seen = new Set();
      const errors = [];

      const spot = await coindcxPost("/exchange/v1/orders/trade_history", {
        limit: 500,
        sort: "desc",
      });
      if (spot.ok) {
        for (const t of asList(spot.json)) {
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

      // Futures transactions — try ms then sec
      let fut = await coindcxPost(
        "/exchange/v1/derivatives/futures/positions/transactions",
        {
          stage: "all",
          page: "1",
          size: "100",
          margin_currency_short_name: ["USDT"],
        }
      );
      if (!fut.ok) {
        fut = await coindcxPost(
          "/exchange/v1/derivatives/futures/positions/transactions",
          {
            stage: "all",
            page: "1",
            size: "100",
            margin_currency_short_name: ["USDT"],
          },
          { seconds: true }
        );
      }
      if (fut.ok) {
        for (const t of asList(fut.json)) {
          const ts = Number(t.created_at || t.timestamp || t.updated_at || 0);
          if (month && !inMonth(ts, month)) continue;
          const pair = mapPair(t.pair || t.symbol || t.market || "");
          const pnl = parseFloat(t.amount ?? t.realised_pnl ?? t.pnl ?? 0);
          const stage = String(t.stage || "").toLowerCase();
          if (stage === "funding") continue; // skip funding fees
          const id = String(t.id || `fut-${t.position_id}-${ts}-${pnl}`);
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
          });
        }
      } else {
        errors.push({ futures: fut.json || fut.text });
      }

      // Margin closed orders with pnl
      const margin = await coindcxPost("/exchange/v1/margin/fetch_orders", {
        status: "close",
        size: 100,
        details: true,
      });
      if (margin.ok) {
        for (const t of asList(margin.json)) {
          const ts = Number(t.updated_at || t.created_at || t.timestamp || 0);
          if (month && !inMonth(ts, month)) continue;
          const pair = mapPair(t.market || t.pair || t.symbol || "");
          const pnl = parseFloat(t.pnl ?? t.realised_pnl ?? 0);
          const id = String(t.id || t.order_id || `margin-${ts}`);
          if (seen.has(id)) continue;
          seen.add(id);
          const ms = ts < 1e12 ? ts * 1000 : ts;
          rows.push({
            pair,
            pnl: pnl || 0,
            date: new Date(ms || Date.now()).toISOString().slice(0, 10),
            name: pair,
            id,
            source: "margin",
          });
        }
      } else {
        errors.push({ margin: margin.json || margin.text });
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
        errors: errors.slice(0, 8),
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
