// Hourly market scan across the whole TBC universe: signal + pattern alerts
// with actionable suggestions. Cached 30 min at the edge.

import { fetchChart, chartToCandles } from "../lib/yahoo.js";
import { CATALOG } from "../instruments.js";
import { analyzeWaves } from "../waves.js";

function sma(a, n) { return a.length >= n ? a.slice(-n).reduce((s, v) => s + v, 0) / n : null; }

function rsi14(c) {
  if (c.length < 16) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / 14, al = l / 14;
  for (let i = 15; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * 13 + Math.max(0, d)) / 14;
    al = (al * 13 + Math.max(0, -d)) / 14;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = now - 120 * 86400, p2 = now + 86400;
  const syms = CATALOG.filter((i) => i.cat !== "polymarket").map((i) => i.sym);

  const settled = await Promise.allSettled(syms.map((s) => fetchChart(s, p1, p2)));
  const alerts = [];

  syms.forEach((sym, idx) => {
    if (settled[idx].status !== "fulfilled") return;
    const raw = settled[idx].value;
    const scale = raw.meta?.currency === "GBp" ? 100 : 1;
    const candles = chartToCandles(raw).map((k) => ({ ...k, c: k.c / scale, h: k.h / scale, l: k.l / scale }));
    if (candles.length < 65) return;
    const closes = candles.map((c) => c.c);
    const price = closes[closes.length - 1];
    const inst = CATALOG.find((i) => i.sym === sym);
    const push = (type, dir, detail, action, strength = 2) =>
      alerts.push({ sym, name: inst.name, cat: inst.cat, price, type, dir, detail, action, strength });

    const rsi = rsi14(closes);
    const s50 = sma(closes, 50), s200 = sma(closes, 200);
    const prev = closes[closes.length - 2];

    if (rsi != null && rsi < 30) push("RSI oversold", "bullish", `RSI ${rsi.toFixed(0)} — washed out, watch for reversal`, `Wait for RSI to recover above 30, then buy; stop below the recent low.`, 2);
    if (rsi != null && rsi > 70) push("RSI overbought", "bearish", `RSI ${rsi.toFixed(0)} — extended`, `Tighten stops or take partial profit; avoid fresh longs.`, 1);
    if (s50 && prev <= s50 && price > s50) push("SMA50 break", "bullish", `Closed above the 50-day average (${s50.toFixed(2)})`, `Momentum shift up — buy the breakout, stop below SMA50.`, 2);
    if (s50 && prev >= s50 && price < s50) push("SMA50 break", "bearish", `Closed below the 50-day average (${s50.toFixed(2)})`, `Momentum shift down — reduce, stop on reclaim of SMA50.`, 2);
    if (s50 && s200) {
      const pS50 = sma(closes.slice(0, -1), 50), pS200 = sma(closes.slice(0, -1), 200);
      if (pS50 && pS200 && pS50 <= pS200 && s50 > s200) push("Golden cross", "bullish", `SMA50 crossed above SMA200`, `Classic long-term buy signal — position with stop below SMA200.`, 3);
      if (pS50 && pS200 && pS50 >= pS200 && s50 < s200) push("Death cross", "bearish", `SMA50 crossed below SMA200`, `Classic long-term sell signal — cut exposure.`, 3);
    }
    const w60 = candles.slice(-61, -1);
    if (w60.length === 60) {
      const hi = Math.max(...w60.map((c) => c.h)), lo = Math.min(...w60.map((c) => c.l));
      if (price > hi) push("60-day breakout", "bullish", `New 60-day high above ${hi.toFixed(2)}`, `Breakout entry: buy, stop back inside the range.`, 3);
      if (price < lo) push("60-day breakdown", "bearish", `New 60-day low below ${lo.toFixed(2)}`, `Breakdown: avoid longs / consider short, stop above the range.`, 3);
    }

    // Pattern trigger proximity
    const w = analyzeWaves(candles);
    for (const pat of w?.patterns || []) {
      const entry = pat.plan?.entry;
      if (entry != null && Math.abs(price / entry - 1) < 0.015) {
        push(`Pattern: ${pat.name}`, pat.dir, `${pat.status} — trigger ${entry.toFixed(2)} is ${((price / entry - 1) * 100).toFixed(1)}% away. ${pat.detail}`, `Plan: ${pat.dir === "bullish" ? "buy" : "sell"} the ${entry.toFixed(2)} trigger · stop ${pat.plan.stop?.toFixed(2)} · target ${pat.plan.t1?.toFixed(2)} (R:R ${pat.plan.rr?.toFixed(1)}).`, 3);
      }
    }
  });

  alerts.sort((a, b) => b.strength - a.strength);
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=1800");
  res.status(200).json({ alerts: alerts.slice(0, 30), scanned: syms.length, fetchedAt: Date.now() });
}
