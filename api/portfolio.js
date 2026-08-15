// Cloud-synced virtual portfolios via Vercel Blob (private store).
// token -> portfolios/{token}.json — paper trading only, no personal data.

import { put, get } from "@vercel/blob";

const KEY = (t) => `portfolios/${t}.json`;

function valid(t) {
  return typeof t === "string" && /^tbc_[A-Za-z0-9_-]{16,64}$/.test(t);
}

export default async function handler(req, res) {
  // GET: load portfolio for a token
  if (req.method === "GET") {
    const token = String(req.query.token || "");
    if (!valid(token)) return res.status(400).json({ error: "Invalid token" });
    try {
      const blob = await get(KEY(token), { access: "private" });
      if (!blob || blob.statusCode === 404) return res.status(404).json({ error: "No portfolio saved for this token yet" });
      const text = blob.blob instanceof Blob ? await blob.blob.text() : await new Response(blob.stream).text();
      const portfolio = JSON.parse(text);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ token, portfolio, updatedAt: Date.now() });
    } catch (e) {
      return res.status(502).json({ error: `Could not load portfolio (${e.message})` });
    }
  }

  // POST: save portfolio for a token
  if (req.method === "POST") {
    const { token, portfolio } = req.body || {};
    if (!valid(token)) return res.status(400).json({ error: "Invalid token" });
    if (!portfolio || typeof portfolio !== "object" || !Array.isArray(portfolio.positions) || !Array.isArray(portfolio.history)) {
      return res.status(400).json({ error: "Invalid portfolio payload" });
    }
    const size = JSON.stringify(portfolio).length;
    if (size > 128 * 1024) return res.status(413).json({ error: "Portfolio too large" });
    try {
      const clean = {
        cash: Number(portfolio.cash) || 0,
        startEquity: Number(portfolio.startEquity) || 0,
        positions: portfolio.positions.slice(0, 100),
        history: portfolio.history.slice(0, 300),
        orders: (portfolio.orders || []).slice(0, 100),
        prefs: portfolio.prefs && typeof portfolio.prefs === "object" ? {
          hiddenCategories: Array.isArray(portfolio.prefs.hiddenCategories) ? portfolio.prefs.hiddenCategories.filter((c) => typeof c === "string").slice(0, 20) : [],
          hiddenSymbols: Array.isArray(portfolio.prefs.hiddenSymbols) ? portfolio.prefs.hiddenSymbols.filter((s) => typeof s === "string").slice(0, 500) : [],
        } : null,
        broker: portfolio.broker && typeof portfolio.broker === "object" ? {
          provider: typeof portfolio.broker.provider === "string" ? portfolio.broker.provider.slice(0, 40) : "custom_api",
          name: typeof portfolio.broker.name === "string" ? portfolio.broker.name.slice(0, 50) : "",
          apiEndpoint: typeof portfolio.broker.apiEndpoint === "string" ? portfolio.broker.apiEndpoint.slice(0, 200) : "",
          apiKey: typeof portfolio.broker.apiKey === "string" ? portfolio.broker.apiKey.slice(0, 150) : "",
          apiSecret: typeof portfolio.broker.apiSecret === "string" ? portfolio.broker.apiSecret.slice(0, 150) : "",
          accountId: typeof portfolio.broker.accountId === "string" ? portfolio.broker.accountId.slice(0, 80) : "",
          sandbox: portfolio.broker.sandbox !== false,
          enabled: Boolean(portfolio.broker.enabled),
        } : null,
        telegram: portfolio.telegram && typeof portfolio.telegram === "object" ? {
          botToken: typeof portfolio.telegram.botToken === "string" ? portfolio.telegram.botToken.slice(0, 100) : "",
          chatId: typeof portfolio.telegram.chatId === "string" ? portfolio.telegram.chatId.slice(0, 50) : "",
          enabled: Boolean(portfolio.telegram.enabled),
          notifyTrades: portfolio.telegram.notifyTrades !== false,
          notifyOrders: portfolio.telegram.notifyOrders !== false,
          notifyExits: portfolio.telegram.notifyExits !== false,
          notifyRadar: Boolean(portfolio.telegram.notifyRadar),
          connectedAt: Number(portfolio.telegram.connectedAt) || Date.now(),
        } : null,
      };
      await put(KEY(token), JSON.stringify(clean), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
        allowOverwrite: true,
      });
      return res.status(200).json({ ok: true, updatedAt: Date.now() });
    } catch (e) {
      return res.status(502).json({ error: `Could not save portfolio (${e.message})` });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
