// Serverless price API — proxies Yahoo Finance chart data with a browser UA.
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

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
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
