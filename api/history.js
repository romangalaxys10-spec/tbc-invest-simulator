// Serverless price API — proxies Yahoo Finance chart data or Polymarket prediction data.
// Normalizes GBp -> GBP and returns adj-close for total-return simulations.

import { fetchChart, chartToCandles } from "../lib/yahoo.js";

function intParam(v, fallback, min, max) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalizeCurrency(cur, x) {
  if (cur === "GBp" || cur === "ZAc") return { currency: cur === "GBp" ? "GBP" : "ZAR", value: x / 100 };
  return { currency: cur, value: x };
}

async function handlePolymarket(pmId, res) {
  try {
    const mRes = await fetch("https://gamma-api.polymarket.com/markets/" + encodeURIComponent(pmId));
    if (!mRes.ok) throw new Error(`Market not found (${mRes.status})`);
    const m = await mRes.json();
    let clob = [];
    try { clob = typeof m.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds) : (m.clobTokenIds || []); } catch {}
    let outcomes = [];
    try { outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : (m.outcomes || []); } catch {}
    let prices = [];
    try { prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []); } catch {}
    const clobId = clob[0];
    const p0 = Number(prices[0]) || 0.5;
    const p1 = Number(prices[1]) || (1 - p0);

    let candles = [];
    if (clobId) {
      try {
        const cRes = await fetch(`https://clob.polymarket.com/prices-history?market=${clobId}&interval=all&fidelity=60`);
        if (cRes.ok) {
          const cData = await cRes.json();
          const hist = cData.history || [];
          const days = {};
          hist.forEach((pt) => {
            const day = new Date(pt.t * 1000).toISOString().slice(0, 10);
            if (!days[day]) days[day] = [];
            days[day].push(pt);
          });
          candles = Object.entries(days).map(([day, pts]) => {
            const o = pts[0].p;
            const c = pts[pts.length - 1].p;
            let h = -Infinity, l = Infinity;
            pts.forEach((p) => { if (p.p > h) h = p.p; if (p.p < l) l = p.p; });
            const t = new Date(day + "T00:00:00Z").getTime();
            return { t, o, h, l, c, v: pts.length * 1000, ac: c };
          }).sort((a, b) => a.t - b.t);
        }
      } catch (e) {
        console.warn("clob price history fetch failed:", e.message);
      }
    }
    if (!candles.length) {
      const today = new Date().toISOString().slice(0, 10);
      candles = [{ t: new Date(today + "T00:00:00Z").getTime(), o: p0, h: p0, l: p0, c: p0, v: 10000, ac: p0 }];
    }
    const lastC = candles.at(-1);
    const prevC = candles.length > 1 ? candles[candles.length - 2] : lastC;

    return res.status(200).json({
      symbol: "PM:" + m.id,
      name: m.question || m.slug,
      currency: "USD",
      exchange: "Polymarket",
      type: "PREDICTION_MARKET",
      price: p0,
      previousClose: prevC.c,
      marketTime: Date.now(),
      firstTradeDate: candles[0].t,
      candles,
      outcomes,
      prices: [p0, p1],
      volume24hr: Number(m.volume24hr || 0),
      clobTokenId: clobId,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return res.status(502).json({ error: `Polymarket data unavailable (${e.message})` });
  }
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();

  if (symbol.startsWith("PM:")) {
    const pmId = symbol.slice(3);
    if (!/^[0-9a-zA-Z_\-]+$/.test(pmId)) return res.status(400).json({ error: "Invalid Polymarket ID" });
    return handlePolymarket(pmId, res);
  }

  if (!/^[A-Z0-9.\-=^]{1,12}$/.test(symbol)) {
    return res.status(400).json({ error: "Invalid symbol" });
  }

  const now = Math.floor(Date.now() / 1000);
  const period1 = intParam(req.query.period1, now - 400 * 86400, 0, now - 2 * 86400);
  const period2 = intParam(req.query.period2, now + 86400, period1 + 3600, now + 7 * 86400);

  let payload;
  try {
    payload = await fetchChart(symbol, period1, period2);
  } catch (e) {
    return res.status(502).json({ error: `Price provider unavailable (${e.message})` });
  }

  const m = payload.meta || {};
  const candles = chartToCandles(payload);

  const scale = m.currency === "GBp" || m.currency === "ZAc" ? 100 : 1;
  const lastC = candles.at(-1);
  const lastDate = lastC ? new Date(lastC.t).toISOString().slice(0, 10) : "";
  const today = new Date().toISOString().slice(0, 10);
  const prevCandle = candles[candles.length - (lastDate === today ? 2 : 1)] || lastC;

  const norm = normalizeCurrency(m.currency || "USD", m.regularMarketPrice ?? lastC?.c ?? 0);
  const normPrev = normalizeCurrency(m.currency || "USD", prevCandle?.c ?? m.chartPreviousClose ?? lastC?.c ?? 0);

  res.status(200).json({
    symbol,
    name: m.longName || m.shortName || symbol,
    currency: norm.currency,
    exchange: m.fullExchangeName || m.exchangeName || "",
    type: m.instrumentType || "",
    price: norm.value,
    previousClose: normPrev.value,
    marketTime: (m.regularMarketTime || 0) * 1000,
    firstTradeDate: (m.firstTradeDate || 0) * 1000,
    candles: candles.map((k) => ({ ...k, c: k.c / scale, ac: k.ac / scale, o: k.o / scale, h: k.h / scale, l: k.l / scale })),
    fetchedAt: Date.now(),
  });
}
