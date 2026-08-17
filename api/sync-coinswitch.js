/**
 * Sync realised P&L from CoinSwitch Futures → Notion Trade PnL Tracker
 * Vendored tweetnacl (lib/nacl.cjs)
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const nacl = require("../lib/nacl.cjs");

const NOTION_DB_ID =
  process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";
const BASE_URL = "https://coinswitch.co";

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

  if (!apiKey || !secretHex) {
    throw new Error("Missing COINSWITCH_API_KEY or COINSWITCH_API_SECRET");
  }

  const pairs = Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`);
  const qs = pairs.join("&");
  const fullPath = qs ? `${path}?${qs}` : path;

  const epoch = String(Date.now());
  // CoinSwitch: METHOD + path_with_query + epoch  (body NOT included when epoch is used)
  const message = method.toUpperCase() + fullPath + epoch;
  const messageBytes = new TextEncoder().encode(message);

  const seed = Uint8Array.from(Buffer.from(secretHex.trim(), "hex"));
  if (seed.length !== 32 && seed.length !== 64) {
    throw new Error(
      `COINSWITCH_API_SECRET unexpected length ${seed.length} bytes (want 32 seed or 64 expanded)`
    );
  }

  let secretKey;
  if (seed.length === 32) {
    secretKey = nacl.sign.keyPair.fromSeed(seed).secretKey;
  } else {
    secretKey = seed; // already 64-byte secret key
  }
  const signature = nacl.sign.detached(messageBytes, secretKey);

  const headers = {
    "Content-Type": "application/json",
    "X-AUTH-APIKEY": apiKey.trim(),
    "X-AUTH-SIGNATURE": Buffer.from(signature).toString("hex"),
    "X-AUTH-EPOCH": epoch,
  };

  return {
    headers,
    url: BASE_URL + fullPath,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    debug: {
      method,
      fullPath,
      message: message.slice(0, 160),
      epoch,
      apiKeyPrefix: apiKey.trim().slice(0, 10) + "...",
      secretBytes: seed.length,
    },
  };
}

async function coinswitchFetch(method, path, query = {}, bodyObj = null) {
  const signed = signRequest(method, path, query, bodyObj);
  const opts = { method, headers: signed.headers };
  if (bodyObj && method !== "GET") {
    opts.body = signed.body;
  }
  const res = await fetch(signed.url, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(`Non-JSON ${res.status}: ${text.slice(0, 300)}`);
    err.debug = signed.debug;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`CoinSwitch ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    err.debug = signed.debug;
    err.raw = json;
    throw err;
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
  if (!res.ok) {
    throw new Error(`Notion ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!process.env.COINSWITCH_API_KEY || !process.env.COINSWITCH_API_SECRET) {
      return res.status(500).json({ ok: false, error: "Missing CoinSwitch env keys" });
    }
    if (!process.env.NOTION_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN" });
    }

    const mode = req.query?.mode || "transactions";

    // Mode 1: minimal transactions (only exchange)
    if (mode === "transactions") {
      const { json, debug } = await coinswitchFetch(
        "GET",
        "/trade/api/v2/futures/transactions",
        { exchange: "EXCHANGE_2" }
      );
      const list = Array.isArray(json.data) ? json.data : [];
      return res.status(200).json({
        ok: true,
        mode: "transactions",
        fetched: list.length,
        sample: list.slice(0, 5),
        debug,
      });
    }

    // Mode 2: closed orders (POST body)
    if (mode === "closed") {
      const body = { exchange: "EXCHANGE_2", limit: 50 };
      const { json, debug } = await coinswitchFetch(
        "POST",
        "/trade/api/v2/futures/orders/closed",
        {},
        body
      );
      const orders = json?.data?.orders || json?.data || [];
      return res.status(200).json({
        ok: true,
        mode: "closed",
        fetched: Array.isArray(orders) ? orders.length : 0,
        sample: Array.isArray(orders) ? orders.slice(0, 3) : orders,
        debug,
      });
    }

    // Mode 3: wallet balance (simple GET)
    if (mode === "balance") {
      const { json, debug } = await coinswitchFetch(
        "GET",
        "/trade/api/v2/futures/wallet_balance",
        { exchange: "EXCHANGE_2" }
      );
      return res.status(200).json({ ok: true, mode: "balance", data: json, debug });
    }

    // Mode 4: full sync — closed orders with realised_pnl → Notion
    if (mode === "sync") {
      const body = { exchange: "EXCHANGE_2", limit: 50 };
      const { json, debug } = await coinswitchFetch(
        "POST",
        "/trade/api/v2/futures/orders/closed",
        {},
        body
      );
      const orders = json?.data?.orders || [];
      const results = [];
      let created = 0;
      let skipped = 0;

      for (const o of orders) {
        const pnl = parseFloat(o.realised_pnl || o.realized_pnl || 0);
        if (!pnl || pnl === 0) {
          skipped++;
          continue;
        }
        const pair = mapPair(o.symbol);
        const ts = Number(o.updated_at || o.created_at || Date.now());
        const date = new Date(ts > 1e11 ? ts : Date.now()).toISOString().slice(0, 10);
        try {
          await createNotionPage({ pair, pnl, date });
          created++;
          results.push({ pair, pnl, date, order_id: o.order_id });
        } catch (e) {
          results.push({ error: e.message, symbol: o.symbol });
        }
      }

      return res.status(200).json({
        ok: true,
        mode: "sync",
        fetched: orders.length,
        created,
        skipped,
        results,
        debug,
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Use ?mode=transactions | closed | balance | sync",
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
