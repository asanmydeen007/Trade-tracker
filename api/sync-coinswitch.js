/**
 * Sync realised P&L from CoinSwitch Futures → Notion Trade PnL Tracker
 * Vendored tweetnacl (lib/nacl.cjs) — no npm crypto deps.
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

function signRequest(method, path, query = {}) {
  const apiKey = process.env.COINSWITCH_API_KEY;
  const secretHex = process.env.COINSWITCH_API_SECRET;

  if (!apiKey || !secretHex) {
    throw new Error("Missing COINSWITCH_API_KEY or COINSWITCH_API_SECRET");
  }

  // Build query string exactly like CoinSwitch examples (no extra encoding surprises)
  const pairs = Object.keys(query)
    .sort()
    .map((k) => {
      const v = query[k];
      // numbers as plain decimal strings, no scientific notation
      const val = typeof v === "number" ? String(Math.trunc(v)) : String(v);
      return `${k}=${val}`;
    });
  const qs = pairs.join("&");
  const fullPath = qs ? `${path}?${qs}` : path;

  // Signed string uses the path as-is (already plain, no % encoding needed)
  const epoch = String(Date.now());
  const message = method.toUpperCase() + fullPath + epoch;
  const messageBytes = new TextEncoder().encode(message);

  const seed = Uint8Array.from(Buffer.from(secretHex.trim(), "hex"));
  if (seed.length !== 32) {
    throw new Error(
      `COINSWITCH_API_SECRET must be 32-byte hex (got ${seed.length} bytes). Check the key format.`
    );
  }
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);

  return {
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": apiKey.trim(),
      "X-AUTH-SIGNATURE": Buffer.from(signature).toString("hex"),
      "X-AUTH-EPOCH": epoch,
    },
    url: BASE_URL + fullPath,
    debug: {
      method,
      fullPath,
      messagePreview: message.slice(0, 120) + "...",
      epoch,
      apiKeyPrefix: apiKey.trim().slice(0, 8) + "...",
      secretLen: seed.length,
    },
  };
}

async function fetchPnlTransactions(days = 7, debug = false) {
  const to = Date.now();
  const from = to - days * 24 * 60 * 60 * 1000;

  // Minimal required params first
  const query = {
    exchange: "EXCHANGE_2",
  };

  // Optional filters — only add if needed
  query.from_time = from;
  query.to_time = to;
  query.limit = 50;

  const signed = signRequest(
    "GET",
    "/trade/api/v2/futures/transactions",
    query
  );

  const res = await fetch(signed.url, { headers: signed.headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `CoinSwitch non-JSON (${res.status}): ${text.slice(0, 400)} | debug=${JSON.stringify(signed.debug)}`
    );
  }

  if (!res.ok) {
    // Include debug so we can see what was signed
    const err = new Error(
      `CoinSwitch ${res.status}: ${JSON.stringify(json).slice(0, 300)}`
    );
    err.debug = signed.debug;
    err.raw = json;
    throw err;
  }

  return { data: Array.isArray(json.data) ? json.data : [], debug: signed.debug };
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
    const err = await res.text();
    throw new Error(`Notion create failed (${res.status}): ${err.slice(0, 400)}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  // Health / debug mode: ?debug=1 returns signed path without calling CoinSwitch write
  const isDebug = req.query?.debug === "1";

  try {
    // Quick env check
    if (!process.env.COINSWITCH_API_KEY || !process.env.COINSWITCH_API_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Missing COINSWITCH_API_KEY or COINSWITCH_API_SECRET in Vercel env",
      });
    }
    if (!process.env.NOTION_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Missing NOTION_TOKEN in Vercel env",
      });
    }

    // CoinSwitch rejects windows longer than ~7 days with "Malformed request data"
    const days = Math.min(Number(req.query?.days) || 7, 7);
    const { data: transactions, debug } = await fetchPnlTransactions(days, isDebug);

    if (isDebug) {
      return res.status(200).json({
        ok: true,
        mode: "debug",
        fetched: transactions.length,
        sample: transactions.slice(0, 3),
        debug,
      });
    }

    const results = [];
    let created = 0;
    let skipped = 0;

    for (const tx of transactions) {
      const type = String(tx.type || "").toUpperCase().replace(/\s+/g, "");
      // Keep only realised P&L style rows
      if (!type.includes("PNL") && type !== "P&L") {
        skipped++;
        continue;
      }

      const amount = parseFloat(tx.amount);
      if (Number.isNaN(amount) || amount === 0) {
        skipped++;
        continue;
      }

      const pair = mapPair(tx.symbol);
      let date = new Date().toISOString().slice(0, 10);
      const rawTs = tx.timestamp || tx.created_at || tx.time;
      if (rawTs) {
        const ts = Number(rawTs);
        if (!Number.isNaN(ts) && ts > 1e11) {
          date = new Date(ts).toISOString().slice(0, 10);
        }
      }

      try {
        await createNotionPage({ pair, pnl: amount, date });
        created++;
        results.push({ pair, pnl: amount, date, transaction_id: tx.transaction_id || null });
      } catch (e) {
        results.push({ error: e.message, symbol: tx.symbol, amount: tx.amount });
      }
    }

    return res.status(200).json({
      ok: true,
      source: "coinswitch",
      fetched: transactions.length,
      created,
      skipped,
      results,
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
