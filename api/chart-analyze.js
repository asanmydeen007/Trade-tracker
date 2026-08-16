/**
 * POST /api/chart-analyze
 * body: { imageBase64: string, mimeType?: string, symbol?: string }
 * Uses Anthropic vision if ANTHROPIC_API_KEY is set.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(503).json({
      error: "ANTHROPIC_API_KEY not set",
      hint: "Add ANTHROPIC_API_KEY in Vercel env for Claude vision chart analysis.",
    });
  }

  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    const imageBase64 = body?.imageBase64;
    const mimeType = body?.mimeType || "image/png";
    const symbol = body?.symbol || "BTC";

    if (!imageBase64) return res.status(400).json({ error: "imageBase64 required" });

    // strip data URL prefix if present
    const b64 = String(imageBase64).replace(/^data:[^;]+;base64,/, "");

    const prompt = `You are a trading analyst. Analyze this chart screenshot for ${symbol}.
Return ONLY valid JSON (no markdown) with this shape:
{
  "bias": "Bullish" | "Bearish" | "Neutral",
  "entry": number or null,
  "stop_loss": number or null,
  "take_profit": [number, number],
  "confidence": "low" | "medium" | "high",
  "summary": "2-4 sentences",
  "key_levels": ["..."]
}
Use visible price axis if readable. If levels cannot be read, use null and explain in summary.
Not financial advice.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mimeType, data: b64 },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t.slice(0, 400) });
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    let parsed = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      parsed = null;
    }

    return res.status(200).json({
      method: "claude_vision",
      raw: text,
      analysis: parsed,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
