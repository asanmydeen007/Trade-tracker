/**
 * Vercel serverless: fetch trades from Notion Trade PnL Tracker.
 * Requires env: NOTION_TOKEN, optionally NOTION_TRADES_DB_ID
 */
const DB_ID = process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: "NOTION_TOKEN not configured",
      trades: null,
      source: "missing_token",
    });
  }

  try {
    const all = [];
    let cursor = undefined;

    do {
      const body = {
        page_size: 100,
        sorts: [{ property: "Date", direction: "descending" }],
      };
      if (cursor) body.start_cursor = cursor;

      const r = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const err = await r.text();
        let hint = "";
        try {
          const j = JSON.parse(err);
          if (j?.code === "object_not_found") {
            hint = "Share Trade PnL Tracker with your Notion integration (··· → Connections).";
          }
        } catch {}
        return res.status(r.status).json({
          error: err,
          hint,
          trades: null,
          source: "notion_error",
        });
      }

      const data = await r.json();
      for (const page of data.results || []) {
        const p = page.properties || {};
        const name =
          p.Name?.title?.map((t) => t.plain_text).join("") ||
          p.Name?.rich_text?.map((t) => t.plain_text).join("") ||
          "Trade";
        const pair = p.Pair?.select?.name || "Other";
        const pnl = p["PnL USDT"]?.number ?? 0;
        const date = p.Date?.date?.start || null;
        if (!date) continue;
        all.push({
          id: page.id,
          name,
          pair,
          pnl,
          date,
        });
      }
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return res.status(200).json({
      trades: all,
      source: "notion",
      syncedAt: new Date().toISOString(),
      count: all.length,
    });
  } catch (e) {
    return res.status(500).json({
      error: String(e?.message || e),
      trades: null,
      source: "exception",
    });
  }
}
