export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const id = (req.query?.id || "").replace(/-/g, "");
    if (id.length !== 32) {
      return res.status(400).json({ ok: false, error: "id required (32 hex)" });
    }
    const uuid = `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
    const token = process.env.NOTION_TOKEN;
    if (!token) return res.status(500).json({ ok: false, error: "NOTION_TOKEN missing" });
    const r = await fetch(`https://api.notion.com/v1/pages/${uuid}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0,200) }; }
    if (!r.ok) return res.status(r.status).json({ ok: false, error: json });
    return res.status(200).json({ ok: true, archived: true, id: uuid });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
