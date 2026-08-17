/**
 * Archive duplicate Trade PnL rows.
 * Key: Name + Pair + Date + PnL USDT (8 decimals)
 * Keeps oldest, archives rest.
 *
 * ?dry=1 preview
 * ?limit=100 batch size (default 80)
 */
const NOTION_DB_ID =
  process.env.NOTION_TRADES_DB_ID || "ec99900ead0d4744a1ecf60598e08f32";

async function notion(path, opts = {}) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing");
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Notion ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = new Error(`Notion ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function fetchAllPages() {
  const pages = [];
  let cursor = undefined;
  do {
    const body = {
      page_size: 100,
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
    };
    if (cursor) body.start_cursor = cursor;
    const data = await notion(`/databases/${NOTION_DB_ID}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    pages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

function propTitle(p) {
  return (p?.title || []).map((t) => t.plain_text).join("") || "";
}
function propNumber(p) {
  return p?.number ?? null;
}
function propDate(p) {
  return p?.date?.start || "";
}
function propSelect(p) {
  return p?.select?.name || "";
}

function dedupeKey(page) {
  const props = page.properties || {};
  const name = propTitle(props.Name);
  const date = propDate(props.Date);
  const pair = propSelect(props.Pair) || name;
  const pnl = propNumber(props["PnL USDT"]);
  const pnlR = pnl == null ? "null" : Number(pnl).toFixed(8);
  return `${name}|${pair}|${date}|${pnlR}`;
}

async function archiveOne(id) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await notion(`/pages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      return { id, ok: true };
    } catch (e) {
      if (e.status === 429 || String(e.message).includes("rate")) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return { id, ok: false, error: e.message };
    }
  }
  return { id, ok: false, error: "rate_limit" };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const dry = req.query?.dry === "1" || req.query?.dry === "true";
    const pages = await fetchAllPages();

    const groups = new Map();
    for (const page of pages) {
      if (page.archived) continue;
      const key = dedupeKey(page);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(page);
    }

    const toArchive = [];
    const duplicateGroups = [];
    for (const [key, list] of groups) {
      if (list.length <= 1) continue;
      duplicateGroups.push({ key, count: list.length, keep: list[0].id });
      toArchive.push(...list.slice(1));
    }

    const limit = Math.min(Number(req.query?.limit) || 80, 120);
    const batch = toArchive.slice(0, limit);

    let archived = 0;
    const errors = [];
    if (!dry && batch.length) {
      // parallel chunks of 4
      for (let i = 0; i < batch.length; i += 4) {
        const chunk = batch.slice(i, i + 4);
        const results = await Promise.all(chunk.map((p) => archiveOne(p.id)));
        for (const r of results) {
          if (r.ok) archived++;
          else errors.push(r);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    return res.status(200).json({
      ok: true,
      dry,
      totalPages: pages.length,
      uniqueKeys: groups.size,
      duplicateGroups: duplicateGroups.length,
      wouldArchive: toArchive.length,
      batchSize: batch.length,
      remaining: Math.max(toArchive.length - batch.length, 0),
      archived,
      samples: duplicateGroups.slice(0, 5),
      errors: errors.slice(0, 8),
      done: !dry && toArchive.length <= limit,
    });
  } catch (err) {
    console.error("[dedupe-notion]", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
