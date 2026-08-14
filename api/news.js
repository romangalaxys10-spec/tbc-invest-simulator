// Latest news per instrument via Yahoo search endpoint (no crumb needed).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const POS = ["beat", "record", "surge", "soar", "growth", "upgrade", "outperform", "profit", "bullish", "gain", "strong", "raise", "buyback", "dividend", "wins", "expands", "tops"];
const NEG = ["miss", "fall", "drop", "plunge", "slump", "downgrade", "underperform", "loss", "bearish", "lawsuit", "probe", "cuts", "layoff", "warns", "recall", "fraud", "fine", "decline"];

function sentiment(title) {
  const t = title.toLowerCase();
  const p = POS.filter((w) => t.includes(w)).length;
  const n = NEG.filter((w) => t.includes(w)).length;
  if (p > n) return "positive";
  if (n > p) return "negative";
  return "neutral";
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-=^]{1,12}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=12&quotesCount=0`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const j = await r.json();
    const news = (j.news || [])
      .filter((n) => n.type === "STORY")
      .map((n) => ({
        title: n.title,
        publisher: n.publisher,
        link: n.link,
        time: (n.providerPublishTime || 0) * 1000,
        sentiment: sentiment(n.title || ""),
      }));
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ symbol, news, fetchedAt: Date.now() });
  } catch (e) {
    res.status(502).json({ error: `News unavailable (${e.message})` });
  }
}
