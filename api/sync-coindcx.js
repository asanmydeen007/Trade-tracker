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

async function createNotionPage({ pair, pnl, pnlInr, date, name }) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing");
  const properties = {
    Name: { title: [{ text: { content: name || pair } }] },
    Date: { date: { start: date } },
    "PnL USDT": { number: pnl ?? 0 },
  };
  // Only set Pair select if it matches a known option — unknown pairs omit select
  const KNOWN = new Set([
    "Bitcoin","Gold","Silver","Eth","Solana","Sui","XRP","NVDA","GOOGL","AMZN",
    "TSLA","META","ATOM","AAVE","AVAX","NEAR","BNB","ADA","XLM","WLD","UNI",
    "ZEC","HYPE","FARTCOIN","LIT","EWY","SPCX","WTIOIL","CRV",
  ]);
  if (KNOWN.has(pair)) {
    properties.Pair = { select: { name: pair } };
  }
  if (pnlInr != null && !Number.isNaN(pnlInr)) {
    properties["PnL INR"] = { number: pnlInr };
  }
  const body = {
    parent: { database_id: NOTION_DB_ID },
    properties,
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


/** Paginated futures orders for one side */
async function fetchFuturesOrdersSide(side, maxPages = 3) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await coindcxPost(
      "/exchange/v1/derivatives/futures/orders",
      {
        status: "filled,partially_filled,partially_cancelled,cancelled",
        side,
        page: String(page),
        size: "100",
        margin_currency_short_name: ["USDT", "INR"],
      },
      { seconds: true }
    );
    if (!r.ok) return { list: all, error: r.json || r.text, status: r.status };
    const batch = asList(r.json);
    all.push(...batch);
    if (batch.length < 100) break;
    await new Promise((x) => setTimeout(x, 50));
  }
  return { list: all, error: null, status: 200 };
}

/** Paginated futures position transactions */
async function fetchFuturesTx(maxPages = 5) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await coindcxPost(
      "/exchange/v1/derivatives/futures/positions/transactions",
      {
        stage: "all",
        page: String(page),
        size: "100",
        margin_currency_short_name: ["USDT", "INR"],
      },
      { seconds: true }
    );
    if (!r.ok) return { list: all, error: r.json || r.text, status: r.status };
    const batch = asList(r.json);
    all.push(...batch);
    if (batch.length < 100) break;
    await new Promise((x) => setTimeout(x, 50));
  }
  return { list: all, error: null, status: 200 };
}

/** Collect rows — multi-page so history goes beyond this month */
async function collectRows(month) {
  const rows = [];
  const seen = new Set();
  const errors = [];
  const meta = {};

  const maxPages = Math.min(Number(globalThis.__CDX_PAGES) || 3, 10);
  const buy = await fetchFuturesOrdersSide("buy", maxPages);
  meta.buy = { status: buy.status, count: buy.list.length, error: buy.error };
  if (buy.error && buy.list.length === 0) errors.push({ buy: buy.error });
  for (const o of buy.list) {
    const ts = o.updated_at || o.created_at || o.timestamp;
    if (month && !inMonth(ts, month)) continue;
    const pnl = parseFloat(o.realised_pnl ?? o.realized_pnl ?? o.pnl ?? o.profit ?? 0);
    const pair = mapPair(o.pair || o.symbol || "");
    const id = String(o.id || `buy-${o.pair}-${ts}`);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      pair, pnl, date: toDate(ts), name: pair, id,
      source: "futures_order_buy", status: o.status, side: o.side,
    });
  }

  const sell = await fetchFuturesOrdersSide("sell", maxPages);
  meta.sell = { status: sell.status, count: sell.list.length, error: sell.error };
  if (sell.error && sell.list.length === 0) errors.push({ sell: sell.error });
  for (const o of sell.list) {
    const ts = o.updated_at || o.created_at || o.timestamp;
    if (month && !inMonth(ts, month)) continue;
    const pnl = parseFloat(o.realised_pnl ?? o.realized_pnl ?? o.pnl ?? o.profit ?? 0);
    const pair = mapPair(o.pair || o.symbol || "");
    const id = String(o.id || `sell-${o.pair}-${ts}`);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      pair, pnl, date: toDate(ts), name: pair, id,
      source: "futures_order_sell", status: o.status, side: o.side,
    });
  }

  const tx = await fetchFuturesTx(Math.min(maxPages + 2, 10));
  meta.tx = { status: tx.status, count: tx.list.length, error: tx.error };
  if (tx.error && tx.list.length === 0) errors.push({ tx: tx.error });
  const amountSamples = [];
  for (const t of tx.list) {
    const ts = t.created_at || t.updated_at || t.timestamp;
    if (month && !inMonth(ts, month)) continue;
    const stage = String(t.stage || "").toLowerCase();
    // Keep exit / default / tpsl / liquidation; skip pure funding rows with 0 amount
    const rawAmount = t.amount ?? t.settlement_amount ?? t.realised_pnl ?? t.pnl ?? t.profit;
    let pnlInr = parseFloat(rawAmount);
    if (Number.isNaN(pnlInr)) pnlInr = 0;
    if (stage === "funding" && pnlInr === 0) continue;

    // INR-margined: amount is typically in INR; convert to USDT via conversion price
    const conv = parseFloat(
      t.settlement_currency_conversion_price ||
      t.price_in_usdt ||
      0
    );
    // Docs: for INR futures fee is in USDT; amount is PnL in margin currency
    const margin = String(t.margin_currency_short_name || "INR").toUpperCase();
    let pnlUsdt = pnlInr;
    if (margin === "INR" && conv > 1) {
      // conversion price looks like INR per USDT (~100)
      pnlUsdt = pnlInr / conv;
    } else if (margin === "INR" && (!conv || conv <= 1)) {
      // fallback ~102 INR/USDT from recent fills
      pnlUsdt = pnlInr / 102;
    }

    if (amountSamples.length < 8) {
      amountSamples.push({
        pair: t.pair,
        stage,
        amount: t.amount,
        settlement_amount: t.settlement_amount,
        fee_amount: t.fee_amount,
        margin,
        conv,
        pnlInr,
        pnlUsdt,
      });
    }

    const pair = mapPair(t.pair || t.symbol || "");
    const id = String(
      t.id || t.fill_id || t.parent_id || `tx-${t.position_id}-${ts}-${pnlInr}`
    );
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      pair,
      pnl: pnlUsdt,
      pnlInr,
      date: toDate(ts),
      name: pair,
      id,
      source: "futures_tx",
      stage,
    });
  }
  meta.amountSamples = amountSamples;

  // Spot (single call, higher limit)
  const spot = await coindcxPost("/exchange/v1/orders/trade_history", {
    limit: 1000,
    sort: "desc",
  });
  const spotList = asList(spot.json);
  meta.spot = { status: spot.status, ok: spot.ok, count: spotList.length };
  if (spot.ok) {
    for (const t of spotList) {
      const ts = t.timestamp || t.T || t.time || t.created_at;
      if (month && !inMonth(ts, month)) continue;
      const pnl = parseFloat(t.realised_pnl ?? t.realized_pnl ?? t.pnl ?? t.profit ?? 0);
      const pair = mapPair(t.symbol || t.market || t.pair || "");
      const id = String(t.id || t.trade_id || `spot-${t.order_id}-${ts}`);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        pair, pnl, date: toDate(ts), name: pair, id, source: "spot",
      });
    }
  }

  // Date range in result for visibility
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  meta.dateRange = dates.length
    ? { from: dates[0], to: dates[dates.length - 1] }
    : null;

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
    globalThis.__CDX_PAGES = Math.min(Number(req.query?.pages) || 3, 10);

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

      // Default fast path: transactions only (has real PnL). ?full=1 includes orders too.
      const full = req.query?.full === "1";
      let rows, errors, meta;
      if (!full) {
        globalThis.__CDX_PAGES = Math.min(Number(req.query?.pages) || 5, 15);
        // Only fetch tx — much faster and is the PnL source
        const onlyTx = await (async () => {
          const r = [];
          const seen = new Set();
          const errors = [];
          const meta = {};
          const tx = await fetchFuturesTx(globalThis.__CDX_PAGES);
          meta.tx = { status: tx.status, count: tx.list.length, error: tx.error };
          const amountSamples = [];
          for (const t of tx.list) {
            const ts = t.created_at || t.updated_at || t.timestamp;
            if (mode === "month" && month && !inMonth(ts, month)) continue;
            const stage = String(t.stage || "").toLowerCase();
            const rawAmount = t.amount ?? t.settlement_amount ?? t.realised_pnl ?? t.pnl ?? 0;
            let pnlInr = parseFloat(rawAmount);
            if (Number.isNaN(pnlInr)) pnlInr = 0;
            if (stage === "funding" && pnlInr === 0) continue;
            const conv = parseFloat(t.settlement_currency_conversion_price || 0);
            const margin = String(t.margin_currency_short_name || "INR").toUpperCase();
            let pnlUsdt = pnlInr;
            if (margin === "INR") pnlUsdt = pnlInr / (conv > 1 ? conv : 102);
            if (amountSamples.length < 10) {
              amountSamples.push({ pair: t.pair, stage, amount: t.amount, settlement_amount: t.settlement_amount, pnlInr, pnlUsdt, margin });
            }
            const pair = mapPair(t.pair || t.symbol || "");
            const id = String(t.id || t.fill_id || t.parent_id || `tx-${t.position_id}-${ts}-${pnlInr}`);
            if (seen.has(id)) continue;
            seen.add(id);
            r.push({ pair, pnl: pnlUsdt, pnlInr, date: toDate(ts), name: pair, id, source: "futures_tx", stage });
          }
          meta.amountSamples = amountSamples;
          const dates = r.map((x) => x.date).filter(Boolean).sort();
          meta.dateRange = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
          return { rows: r, errors, meta };
        })();
        rows = onlyTx.rows;
        errors = onlyTx.errors;
        meta = onlyTx.meta;
      } else {
        const collected = await collectRows(mode === "month" ? month : null);
        rows = collected.rows;
        errors = collected.errors;
        meta = collected.meta;
      }

      // Prefer writing rows that have PnL; if none have PnL, write filled orders as 0? 
      // User asked realised pnl only earlier — write non-zero only, but if all zero report clearly
      const toWrite = rows.filter((r) => {
        const p = Number(r.pnl);
        return !Number.isNaN(p) && Math.abs(p) > 1e-10;
      });
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
