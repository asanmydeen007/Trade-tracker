/**
 * Archive duplicate Trade PnL Tracker rows.
 * Key: Name + Date + rounded PnL USDT
 * Keeps the oldest page, archives the rest.
 *
 * GET /api/dedupe-notion?dry=1  → preview only
 * GET /api/dedupe-notion         → archive duplicates
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
  if (!res.ok) throw new Error(`Notion ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
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

    const duplicateGroups = [];
    const toArchive = [];
    for (const [key, list] of groups) {
      if (list.length <= 1) continue;
      // keep first (oldest by sort), archive rest
      const keep = list[0];
      const extras = list.slice(1);
      duplicateGroups.push({
        key,
        count: list.length,
        keep: keep.id,
        archive: extras.map((p) => p.id),
      });
      toArchive.push(...extras);
    }

    // Process in small batches to avoid Notion rate limits
    const limit = Math.min(Number(req.query?.limit) || 25, 50);
    const offset = Math.max(Number(req.query?.offset) || 0, 0);
    const batch = toArchive.slice(offset, offset + limit);

    let archived = 0;
    const errors = [];
    if (!dry) {
      for (const page of batch) {
        try {
          await notion(`/pages/${page.id}`, {
            method: "PATCH",
            body: JSON.stringify({ archived: true }),
          });
          archived++;
          await new Promise((r) => setTimeout(r, 350));
        } catch (e) {
          errors.push({ id: page.id, error: e.message });
          // backoff on rate limit
          if (String(e.message).includes("rate") || String(e.message).includes("429")) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
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
      offset,
      limit,
      nextOffset: offset + batch.length < toArchive.length ? offset + batch.length : null,
      archived,
      samples: duplicateGroups.slice(0, 10),
      errors: errors.slice(0, 10),
      tip: "If rate limited, wait 1 min then call again with ?offset=NEXT",
    });
  } catch (err) {
    console.error("[dedupe-notion]", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
