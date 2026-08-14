// In-app news reader: fetches a Yahoo Finance article and returns clean text.

import https from "node:https";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function allowed(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && /(^|\.)yahoo\.com$/.test(x.hostname);
  } catch {
    return false;
  }
}

// Yahoo responses exceed undici's default max header size — use node:https directly.
function fetchHtml(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
        maxHeaderSize: 131072,
      },
      (res) => {
 if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
          res.resume();
          return resolve(fetchHtml(new URL(res.headers.location, url).toString(), redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.setTimeout(12000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function decode(s) {
  return s
    .replace(/<!--\s*HTML_TAG_(START|END)\s*-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#34;|&#x22;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

const JUNK = /^(skip to|advertisement|listen now|all market data|story continues|photo by|get the|click here|sign in|download the)/i;

function extractParagraphs(html) {
  // New Yahoo DOM: article paragraphs use class "text text-block paragraph"
  const paras = [...html.matchAll(/<p[^>]*class="[^"]*text-block\s+paragraph[^"]*"[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1]));
  if (paras.length >= 3) return paras;
  // Legacy DOM fallback: caas-body container
  const idx = html.indexOf("caas-body");
  const scope = idx >= 0 ? html.slice(idx, idx + 120000) : html;
  return [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1]));
}

export default async function handler(req, res) {
  const url = String(req.query.url || "");
  if (!allowed(url)) return res.status(400).json({ error: "Only Yahoo Finance news URLs are supported" });
  try {
    const html = await fetchHtml(url);
    const title =
      decode((html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/) || [])[1] || "") ||
      decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || "") ||
      "Article";

    const seen = new Set();
    const paragraphs = [...new Set(extractParagraphs(html))].filter((p) => {
      if (p.length < 50 || p.length > 4000 || JUNK.test(p)) return false;
      const key = p.slice(0, 80).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 40);

    if (!paragraphs.length) throw new Error("Article body not found — open the original");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({ title, paragraphs, url, fetchedAt: Date.now() });
  } catch (e) {
    res.status(502).json({ error: e.message === "timeout" ? "Article fetch timed out" : e.message });
  }
}
