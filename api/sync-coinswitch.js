/**
 * Sync realised P&L from CoinSwitch Futures → Notion Trade PnL Tracker
 *
 * Required env vars:
 *   COINSWITCH_API_KEY
 *   COINSWITCH_API_SECRET
 *   NOTION_TOKEN
 * Optional:
 *   NOTION_TRADES_DB_ID
 *
 * Uses a vendored copy of tweetnacl (lib/nacl.js) so Vercel does not
 * need to download anything from the npm registry during build.
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

  const qs = Object.keys(query)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(query[k])}`)
    .join("&");

  const fullPath = qs ? `${path}?${qs}` : path;
  // CoinSwitch signs the URL-decoded path
  const decodedPath = decodeURIComponent(fullPath);

  const epoch = String(Date.now());
  const message = method.toUpperCase() + decodedPath + epoch;
  const messageBytes = new TextEncoder().encode(message);

  // secret is 32-byte seed (hex). Expand to full 64-byte secretKey.
  const seed = Uint8Array.from(Buffer.from(secretHex, "hex"));
  if (seed.length !== 32) {
    throw new Error(
      `COINSWITCH_API_SECRET must be 32-byte hex (got ${seed.length} bytes)`
    );
  }
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const signature = nacl.sign.detached(messageBytes, keyPair.secretKey);

  return {
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": apiKey,
      "X-AUTH-SIGNATURE": Buffer.from(signature).toString("hex"),
      "X-AUTH-EPOCH": epoch,
    },
    url: BASE_URL + fullPath,
  };
}

async function fetchPnlTransactions(days = 30) {
  const to = Date.now();
  const from = to - days * 24 * 60 * 60 * 1000;

  const query = {
    exchange: "EXCHANGE_2",
    type: "P&L",
    limit: 100,
    from_time: from,
    to_time: to,
  };

  const { headers, url } = signRequest(
    "GET",
    "/trade/api/v2/futures/transactions",
    query
  );

  const res = await fetch(url, { headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `CoinSwitch non-JSON response (${res.status}): ${text.slice(0, 300)}`
    );
  }

  if (!res.ok) {
    throw new Error(
      `CoinSwitch error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  return Array.isArray(json.data) ? json.data : [];
}

async function createNotionPage({ pair, pnl, date }) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing");

  const body = {
    parent: { database_id: NOTION_DB_ID },
    properties: {
      Name: {
        title: [{ text: { content: pair } }],
      },
      Date: {
        date: { start: date },
      },
      Pair: {
        select: { name: pair },
      },
      "PnL USDT": {
        number: pnl,
      },
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
    throw new Error(
      `Notion create failed (${res.status}): ${err.slice(0, 400)}`
    );
  }

  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const days = Math.min(Number(req.query?.days) || 30, 90);
    const transactions = await fetchPnlTransactions(days);

    const results = [];
    let created = 0;
    let skipped = 0;

    for (const tx of transactions) {
      const type = String(tx.type || "").toUpperCase().replace(/\s+/g, "");
      if (type !== "P&L" && type !== "PNL" && !type.includes("PNL")) {
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
      if (tx.timestamp || tx.created_at || tx.time) {
        const ts = Number(tx.timestamp || tx.created_at || tx.time);
        if (!Number.isNaN(ts) && ts > 1e11) {
          date = new Date(ts).toISOString().slice(0, 10);
        }
      }

      try {
        await createNotionPage({ pair, pnl: amount, date });
        created++;
        results.push({
          pair,
          pnl: amount,
          date,
          transaction_id: tx.transaction_id || null,
        });
      } catch (e) {
        results.push({
          error: e.message,
          symbol: tx.symbol,
          amount: tx.amount,
        });
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
    });
  }
}
