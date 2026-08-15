// Full instrument analysis: computed technicals + fundamentals + analyst consensus
// (20+ Wall Street analysts) + upcoming events with historical impact reactions.

import { fetchChart, chartToCandles, fetchQuoteSummary } from "../lib/yahoo.js";

const MODULES = [
  "summaryDetail", "financialData", "defaultKeyStatistics", "calendarEvents",
  "recommendationTrend", "upgradeDowngradeHistory", "earnings", "fundProfile",
];

const r = (obj, key) => {
  const v = obj?.[key];
  return typeof v === "object" && v !== null ? ("raw" in v ? v.raw : null) : v ?? null;
};
const f = (obj, key) => obj?.[key]?.fmt ?? null;

// ---- technical indicators ----
function sma(arr, n) {
  if (arr.length < n) return null;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}
function emaSeries(arr, n) {
  const k = 2 / (n + 1);
  const out = [];
  let e = arr[0];
  for (const v of arr) {
    e = v * k + e * (1 - k);
    out.push(e);
  }
  return out;
}
function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / n, al = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (n - 1) + Math.max(0, d)) / n;
    al = (al * (n - 1) + Math.max(0, -d)) / n;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}
function atr14(candles) {
  if (candles.length < 15) return null;
  let sum = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    sum += Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
  }
  return sum / 14;
}

function computeTechnicals(candles, price) {
  const closes = candles.map((c) => c.c);
  const n = closes.length;
  const last = closes[n - 1];
  const s20 = sma(closes, 20), s50 = sma(closes, 50), s200 = sma(closes, 200);

  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const macd = macdLine[n - 1], signal = signalLine[n - 1], hist = macd - signal;

  const rsi14 = rsi(closes);
  const sd20 = Math.sqrt(closes.slice(-20).reduce((a, v) => a + (v - s20) ** 2, 0) / 20);
  const bbUpper = s20 + 2 * sd20, bbLower = s20 - 2 * sd20;
  const pctB = (last - bbLower) / (bbUpper - bbLower || 1);

  const window252 = candles.slice(-252);
  const hi52 = Math.max(...window252.map((c) => c.h));
  const lo52 = Math.min(...window252.map((c) => c.l));
  const rangePct = (last - lo52) / (hi52 - lo52 || 1);

  // 30d realized volatility (annualized)
  const rets30 = [];
  for (let i = Math.max(1, n - 30); i < n; i++) rets30.push(Math.log(closes[i] / closes[i - 1]));
  const mu30 = rets30.reduce((a, b) => a + b, 0) / rets30.length;
  const vol30 = Math.sqrt(rets30.reduce((a, b) => a + (b - mu30) ** 2, 0) / Math.max(1, rets30.length - 1)) * Math.sqrt(252);

  // 1y max drawdown
  let peak = window252[0].h, mdd = 0;
  for (const c of window252) {
    peak = Math.max(peak, c.h);
    mdd = Math.min(mdd, c.l / peak - 1);
  }

  const recent = candles.slice(-60);
  const support = Math.min(...recent.map((c) => c.l));
  const resistance = Math.max(...recent.map((c) => c.h));

  const mom = (days) => (n > days ? last / closes[n - 1 - days] - 1 : null);

  // composite trend score (0-100)
  const signals = [
    { label: `Price > SMA20 (${s20 ? s20.toFixed(2) : "n/a"})`, ok: s20 ? last > s20 : null },
    { label: `Price > SMA50 (${s50 ? s50.toFixed(2) : "n/a"})`, ok: s50 ? last > s50 : null },
    { label: `Price > SMA200 (${s200 ? s200.toFixed(2) : "n/a"})`, ok: s200 ? last > s200 : null },
    { label: "Golden cross (SMA50 > SMA200)", ok: s50 && s200 ? s50 > s200 : null },
    { label: "MACD above signal line", ok: hist > 0 },
    { label: `RSI ${rsi14 ? rsi14.toFixed(0) : ""} in 45–70 zone`, ok: rsi14 ? rsi14 >= 45 && rsi14 <= 70 : null },
    { label: "Above 52w midpoint", ok: rangePct > 0.5 },
    { label: "Positive 3-month momentum", ok: (mom(63) ?? 0) > 0 },
  ].filter((s) => s.ok !== null);
  const score = Math.round((signals.filter((s) => s.ok).length / signals.length) * 100);
  const label = score >= 65 ? "Bullish" : score >= 40 ? "Neutral" : "Bearish";

  return {
    sma20: s20, sma50: s50, sma200: s200,
    rsi14, macd: { macd, signal, hist }, bollinger: { upper: bbUpper, lower: bbLower, pctB },
    atr14: atr14(candles), vol30d: vol30, maxDrawdown1y: mdd,
    range52w: { high: hi52, low: lo52, position: rangePct },
    support, resistance,
    momentum: { w1: mom(5), m1: mom(21), m3: mom(63), m6: mom(126), y1: mom(252) },
    trend: { label, score, signals },
  };
}

// ---- earnings reactions (impact model) ----
function earningsImpact(candles, quarterly) {
  const byDay = new Map(candles.map((c) => [new Date(c.t).toISOString().slice(0, 10), c]));
  const dates = [...byDay.keys()].sort();
  const history = [];
  for (const q of quarterly.slice(0, 8)) {
    const rep = new Date(r(q, "reportedDate") * 1000).toISOString().slice(0, 10);
    const i = dates.findIndex((d) => d >= rep);
    if (i <= 0) continue;
    const after = byDay.get(dates[i]), before = byDay.get(dates[i - 1]);
    const move = after.c / before.c - 1;
    history.push({
      date: rep,
      epsActual: r(q.actual, "raw") ?? q.actual, epsEst: r(q.estimate, "raw") ?? q.estimate,
      surprisePct: r(q, "surprisePct"),
      nextDayMove: move,
    });
  }
  history.reverse(); // newest first
  const beats = history.filter((h) => h.surprisePct > 0);
  const misses = history.filter((h) => h.surprisePct <= 0);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + Math.abs(x.nextDayMove), 0) / a.length : null);
  return {
    history: history.slice(0, 4),
    avgAbsMove: avg(history),
    beatMove: avg(beats), missMove: avg(misses),
    beats: beats.length, misses: misses.length, total: history.length,
  };
}

const gradeChip = (g) => {
  const s = (g || "").toLowerCase();
  if (s.includes("strong buy") || s === "buy" || s.includes("outperform") || s.includes("market outperform") || s.includes("overweight")) return "buy";
  if (s.includes("underperform") || s === "sell" || s.includes("strong sell") || s.includes("underweight")) return "sell";
  return "hold";
};

// ---- special signal engines ----
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Morgan Stanley — equity research style: Overweight/EW/UW ratings driven by
// revisions momentum, risk-reward vs target, valuation and technicals.
function morganStanleySignal({ technicals, analysts, fundamentals, price, isFund }) {
  const factors = [];
  const ratingMap = { strong_buy: 1, buy: 0.75, hold: 0.5, sell: 0.25, strong_sell: 0 };
  const hasAnalysts = !!analysts.count;
  const trendScore = technicals.trend.score / 100;
  const mom3 = technicals.momentum.m3;
  let target = null;

  let composite;
  if (isFund || !hasAnalysts) {
    // Institutional allocation mode for funds: regime + momentum + risk
    const momS = clamp01((mom3 + 0.15) / 0.3);
    const riskS = clamp01(1 - (technicals.vol30d - 0.1) / 0.35);
    composite = Math.round((trendScore * 0.45 + momS * 0.35 + riskS * 0.2) * 100);
    factors.push(
      { label: "Price regime", ok: trendScore >= 0.6, detail: `${technicals.trend.label} (${technicals.trend.score}/100)` },
      { label: "3-month momentum", ok: mom3 > 0, detail: `${(mom3 * 100).toFixed(1)}%` },
      { label: "Risk-adjusted profile", ok: riskS >= 0.5, detail: `${(technicals.vol30d * 100).toFixed(1)}% 30d vol` },
    );
  } else {
    const ratingS = ratingMap[analysts.rating] ?? 0.5;
    const upsideS = clamp01((analysts.targets.upside ?? 0) / 0.2);
    const pe = fundamentals.valuation.peTtm;
    const peg = fundamentals.valuation.peg;
    const valS = peg != null ? (peg < 1.5 ? 1 : peg < 2.5 ? 0.6 : 0.25) : pe == null ? 0.5 : pe < 15 ? 1 : pe < 30 ? 0.6 : 0.3;
    const beta = fundamentals.valuation.beta;
    const riskS = beta == null ? 0.5 : beta < 0.8 ? 1 : beta < 1.3 ? 0.7 : beta < 1.8 ? 0.4 : 0.15;
    const revs = analysts.actions.slice(0, 5);
    const upCount = revs.filter((a) => a.action === "up").length;
    const downCount = revs.filter((a) => a.action === "down").length;
    composite = Math.round((ratingS * 0.2 + upsideS * 0.2 + (upCount > downCount ? 1 : upCount === downCount ? 0.5 : 0) * 0.2 + trendScore * 0.15 + valS * 0.15 + riskS * 0.1) * 100);
    target = analysts.targets.mean != null
      ? analysts.targets.mean * (upCount > downCount ? 1.02 : downCount > upCount ? 0.98 : 1)
      : null;
    factors.push(
      { label: `Consensus (${analysts.count} analysts)`, ok: ratingS >= 0.6, detail: analysts.rating.replace("_", " ") },
      { label: "Risk-reward vs mean target", ok: (analysts.targets.upside ?? 0) > 0.05, detail: `${((analysts.targets.upside ?? 0) * 100).toFixed(1)}%` },
      { label: "Technical regime", ok: trendScore >= 0.6, detail: `${technicals.trend.label} (${technicals.trend.score}/100)` },
      { label: "Valuation vs growth (PEG)", ok: valS >= 0.6, detail: peg != null ? `PEG ${peg.toFixed(2)}` : pe != null ? `P/E ${pe.toFixed(1)}` : "n/a" },
      { label: "Estimate revisions (30d)", ok: upCount > downCount, detail: `${upCount}▲ / ${downCount}▼ — revisions drive MS targets` },
      { label: "Risk profile (beta)", ok: riskS >= 0.6, detail: beta != null ? `β ${beta.toFixed(2)}` : "n/a" },
    );
  }
  const verdict = composite >= 70 ? "OVERWEIGHT" : composite >= 50 ? "EQUAL-WEIGHT" : "UNDERWEIGHT";
  const cls = composite >= 70 ? "buy" : composite >= 50 ? "hold" : "sell";
  return {
    name: "Morgan Stanley", desk: "Equity Research Signal",
    verdict, cls, score: composite, conviction: composite, factors, target,
    note: isFund || !hasAnalysts
      ? "Fund allocation mode — regime, momentum and risk (MS research covers single stocks)."
      : "MS research playbook: estimate revisions, risk-reward vs target, valuation vs growth, risk.",
  };
}

// Goldman Sachs — global macro & momentum style: momentum factor, trend regime,
// growth quality, volatility regime and 52-week positioning.
function goldmanSachsSignal({ technicals, fundamentals, price, isFund }) {
  const factors = [];
  const mom6 = technicals.momentum.m6 ?? 0;
  const mom1 = technicals.momentum.m1 ?? 0;
  const momo = clamp01((mom6 - Math.min(mom1, 0) + 0.15) / 0.45); // 6M momentum, penalize recent blowoff
  const trendScore = technicals.trend.score / 100;
  const eg = fundamentals.growth.earnings;
  const growthS = isFund ? 0.5 : eg == null ? 0.5 : eg > 0.15 ? 1 : eg > 0 ? 0.6 : 0.15;
  const volS = clamp01(1 - (technicals.vol30d - 0.12) / 0.38);
  const pos52 = technicals.range52w.position;
  const posS = pos52 > 0.7 ? 1 : pos52 > 0.4 ? 0.65 : 0.3;

  const composite = Math.round((momo * 0.3 + trendScore * 0.2 + growthS * 0.2 + volS * 0.15 + posS * 0.15) * 100);
  const verdict = composite >= 80 ? "CONVICTION BUY" : composite >= 62 ? "BUY" : composite >= 45 ? "NEUTRAL" : composite <= 25 ? "CONVICTION SELL" : "SELL";
  const cls = composite >= 62 ? "buy" : composite >= 45 ? "hold" : "sell";
  const target = price * (1 + 0.5 * Math.max(-0.4, Math.min(0.4, mom6)));

  factors.push(
    { label: "Momentum (6M factor)", ok: momo >= 0.55, detail: `${(mom6 * 100).toFixed(1)}% 6M · ${(mom1 * 100).toFixed(1)}% 1M` },
    { label: "Trend regime", ok: trendScore >= 0.6, detail: `${technicals.trend.label} (${technicals.trend.score}/100)` },
    { label: "Earnings growth", ok: growthS >= 0.6, detail: isFund ? "n/a for funds" : eg != null ? `${(eg * 100).toFixed(1)}%` : "n/a" },
    { label: "Volatility regime", ok: volS >= 0.5, detail: `${(technicals.vol30d * 100).toFixed(1)}% 30d ann.` },
    { label: "52-week positioning", ok: posS >= 0.65, detail: `${(pos52 * 100).toFixed(0)}% of range` },
  );

  return {
    name: "Goldman Sachs", desk: "Global Macro & Momentum Signal",
    verdict, cls, score: composite, conviction: composite, factors, target,
    note: "GS playbook: momentum with blowoff penalty, trend regime, growth quality, vol-targeted risk, range positioning. Target = 50% decay of 6M momentum.",
  };
}

function warrenBufftSignal({ technicals, fundamentals, price: px, isFund }) {
  const factors = [];
  let score;
  let target = null;
  if (isFund) {
    const fu = { expenseRatio: fundamentals.expenseRatio ?? null };
    // Bufft famously recommends low-cost index funds when he can't find individual value
    const cost = fu.expenseRatio != null ? (fu.expenseRatio < 0.2 ? 1 : fu.expenseRatio < 0.5 ? 0.6 : 0.2) : 0.5;
    const regime = technicals.trend.score / 100;
    score = Math.round((cost * 0.6 + regime * 0.4) * 100);
    factors.push(
      { label: "Low cost (expense ratio)", ok: cost >= 0.6, detail: fu.expenseRatio != null ? `${fu.expenseRatio.toFixed(3)}%` : "n/a" },
      { label: "Diversification", ok: true, detail: "Owns the whole market — Bufft's classic advice for most investors" },
      { label: "Price regime", ok: regime >= 0.6, detail: `${technicals.trend.label} (${technicals.trend.score}/100)` },
    );
  } else {
    const v = fundamentals.valuation, p = fundamentals.profitability, g = fundamentals.growth, h = fundamentals.health;
    const roe = p.roe, margin = p.margin, de = h.debtToEquity, fcf = h.freeCashflow, eg = g.earnings, rg = g.revenue;
    const pe = v.peTtm, peg = v.peg;
    const quality = Math.round(
      ((roe != null && roe > 0.2 ? 1 : roe > 0.1 ? 0.6 : 0.2) +
       (margin != null && margin > 0.2 ? 1 : margin > 0.08 ? 0.6 : 0.2) * 0.8 +
       (de != null && de < 50 ? 1 : de < 120 ? 0.6 : 0.2) * 0.8 +
       (fcf > 0 ? 1 : 0.1) +
       ((eg ?? 0) > 0.1 ? 1 : (eg ?? 0) > 0 ? 0.6 : 0.1) * 0.7 +
       ((rg ?? 0) > 0.1 ? 1 : (rg ?? 0) > 0 ? 0.6 : 0.1) * 0.6) / 5 * 100
    );
    const price = pe == null ? 50 : Math.round(
      ((pe < 15 ? 1 : pe < 25 ? 0.7 : pe < 40 ? 0.4 : 0.15) +
       (peg == null ? 0.5 : peg < 1 ? 1 : peg < 2 ? 0.6 : 0.2)) / 2 * 100
    );
    score = Math.round(quality * 0.6 + price * 0.4);
    // Graham-style fair value: V = EPS × (8.5 + 2g), growth capped at 15
    const peG = fundamentals.valuation.peTtm;
    const egG = fundamentals.growth.earnings;
    if (peG != null && peG > 0 && egG != null) {
      const eps = px / peG;
      const g = Math.max(0, Math.min(15, egG * 100));
      const v = eps * (8.5 + 2 * g);
      target = Math.max(px * 0.6, Math.min(px * 2, v)); // sanity band ±60%
    }
    factors.push(
      { label: "ROE (moat proxy)", ok: roe > 0.15, detail: roe != null ? `${(roe * 100).toFixed(1)}%` : "n/a" },
      { label: "Profit margin", ok: margin > 0.15, detail: margin != null ? `${(margin * 100).toFixed(1)}%` : "n/a" },
      { label: "Debt discipline", ok: de != null && de < 100, detail: de != null ? `D/E ${(de / 100).toFixed(2)}×` : "n/a" },
      { label: "Free cash flow", ok: fcf > 0, detail: fcf != null ? `$${(fcf / 1e9).toFixed(1)}B` : "n/a" },
      { label: "Earnings growth", ok: (eg ?? 0) > 0.1, detail: eg != null ? `${(eg * 100).toFixed(1)}%` : "n/a" },
      { label: "Price vs value (P/E · PEG)", ok: price >= 65, detail: `P/E ${pe != null ? pe.toFixed(1) : "n/a"} · PEG ${peg != null ? peg.toFixed(2) : "n/a"}` },
    );
  }
  const verdict = score >= 80 ? "LOADING THE TRUCK" : score >= 65 ? "BUY" : score >= 50 ? "HOLD & WATCH" : score >= 35 ? "PASS" : "TOO RICH";
  const cls = score >= 65 ? "buy" : score >= 50 ? "hold" : "sell";
  const quotes = {
    "LOADING THE TRUCK": "“Be fearful when others are greedy, and greedy when others are fearful.”",
    BUY: "“It's far better to buy a wonderful company at a fair price than a fair company at a wonderful price.”",
    "HOLD & WATCH": "“The stock market is a device for transferring money from the impatient to the patient.”",
    PASS: "“Risk comes from not knowing what you're doing.”",
    "TOO RICH": "“Price is what you pay. Value is what you get.”",
  };
  return {
    name: "Warren Bufft", desk: "Value & Quality Signal",
    verdict, cls, score, conviction: score, target,
    factors,
    quote: quotes[verdict],
    note: isFund
      ? "Fund mode — Bufft famously recommends low-cost index funds for most investors."
      : "Classic Bufft checklist: durable quality (moat, margins, cash) bought at a sensible price.",
  };
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-=^]{1,12}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });

  const now = Math.floor(Date.now() / 1000);
  let chart, qs;
  try {
    [chart, qs] = await Promise.all([
      fetchChart(symbol, now - 420 * 86400, now + 86400),
      fetchQuoteSummary(symbol, MODULES),
    ]);
  } catch (e) {
    return res.status(502).json({ error: `Analysis data unavailable (${e.message})` });
  }

  const m = chart.meta || {};
  const scale = m.currency === "GBp" || m.currency === "ZAc" ? 100 : 1;
  const ccy = m.currency === "GBp" ? "GBP" : m.currency === "ZAc" ? "ZAR" : m.currency || "USD";
  const candles = chartToCandles(chart);
  if (candles.length < 30) return res.status(422).json({ error: "Not enough price history for analysis" });
  const price = (m.regularMarketPrice ?? candles.at(-1).c) / scale;

  const sd = qs.summaryDetail || {}, fd = qs.financialData || {}, ks = qs.defaultKeyStatistics || {};
  const ce = qs.calendarEvents || {}, rt = qs.recommendationTrend?.trend?.[0] || {};
  const ud = qs.upgradeDowngradeHistory?.history || [];
  const eq = qs.earnings?.earningsChart?.quarterly || [];
  const fund = qs.fundProfile || {};
  const isFund = m.instrumentType === "ETF" || m.instrumentType === "MUTUALFUND" || !!fund.family;

  // earnings event + impact
  const earningsTs = ce.earnings?.earningsDate?.[0]?.raw ? ce.earnings.earningsDate[0].raw * 1000 : null;
  const impact = isFund ? null : earningsImpact(candles, eq);
  const daysUntil = earningsTs ? Math.ceil((earningsTs - Date.now()) / 86400000) : null;

  const dividendYield = r(sd, "dividendYield");
  const divRate = r(sd, "dividendRate");
  const exDivTs = r(ce.exDividendDate, "date") ? r(ce.exDividendDate, "date") * 1000 : null;

  const targetMean = r(fd, "targetMeanPrice");
  const targetHigh = r(fd, "targetHighPrice");
  const targetLow = r(fd, "targetLowPrice");

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  const base = {
    symbol,
    name: m.longName || m.shortName || symbol,
    currency: ccy,
    exchange: m.fullExchangeName || m.exchangeName || "",
    type: m.instrumentType || "",
    isFund,
    price,
    technicals: computeTechnicals(candles.map((c) => ({ ...c, c: c.c / scale, h: c.h / scale, l: c.l / scale })), price),
    fundamentals: {
      marketCap: r(sd, "marketCap"),
      valuation: {
        peTtm: r(sd, "trailingPE"), peFwd: r(sd, "forwardPE"), peg: r(ks, "pegRatio") ?? r(sd, "pegRatio"),
        ps: r(sd, "priceToSalesTrailing12Months"), pb: r(sd, "priceToBook"),
        evEbitda: r(ks, "enterpriseToEbitda"), beta: r(sd, "beta"),
      },
      profitability: {
        margin: r(fd, "profitMargins") ?? r(sd, "profitMargins"), opMargin: r(fd, "operatingMargins") ?? r(sd, "operatingMargins"),
        roe: r(fd, "returnOnEquity"), roa: r(fd, "returnOnAssets"),
        dividendYield, payout: r(sd, "payoutRatio"),
      },
      growth: { revenue: r(fd, "revenueGrowth"), earnings: r(fd, "earningsGrowth") },
      health: {
        debtToEquity: r(fd, "debtToEquity"), currentRatio: r(fd, "currentRatio"),
        freeCashflow: r(fd, "freeCashflow"), totalCash: r(fd, "totalCash"), totalDebt: r(fd, "totalDebt"),
      },
    },
    analysts: {
      rating: r(fd, "recommendationKey"),
      count: r(fd, "numberOfAnalystOpinions"),
      targets: {
        mean: targetMean != null ? targetMean / scale : null,
        high: targetHigh != null ? targetHigh / scale : null,
        low: targetLow != null ? targetLow / scale : null,
        upside: targetMean != null ? targetMean / scale / price - 1 : null,
      },
      breakdown: { strongBuy: rt.strongBuy ?? 0, buy: rt.buy ?? 0, hold: rt.hold ?? 0, sell: rt.sell ?? 0, strongSell: rt.strongSell ?? 0 },
      trend: (qs.recommendationTrend?.trend || []).map((t) => ({ period: t.period, strongBuy: t.strongBuy, buy: t.buy, hold: t.hold, sell: t.sell, strongSell: t.strongSell })),
      actions: ud.slice(0, 8).map((u) => ({
        date: new Date(u.epochGradeDate * 1000).toISOString().slice(0, 10),
        firm: u.firm, from: u.fromGrade, to: u.toGrade, action: u.action,
        target: u.currentPriceTarget != null ? u.currentPriceTarget / scale : null,
        chip: gradeChip(u.toGrade),
      })),
    },
    events: {
      nextEarnings: !earningsTs ? null : {
        date: new Date(earningsTs).toISOString().slice(0, 10),
        daysUntil,
        epsEst: { low: f(ce.earnings, "earningsLow"), avg: f(ce.earnings, "earningsAverage"), high: f(ce.earnings, "earningsHigh") },
        revenueEst: f(ce.earnings, "revenueAverage"),
        impact,
      },
      exDiv: !exDivTs ? null : { date: new Date(exDivTs).toISOString().slice(0, 10), daysUntil: Math.ceil((exDivTs - Date.now()) / 86400000), rate: divRate, yield: dividendYield },
    },
    fund: isFund ? {
      family: fund.family, category: fund.categoryName,
      expenseRatio: r(fund, "feesNetExpenseRatio") ?? r(fund.feesExpensesInvestment, "annualReportExpenseRatio"),
      about: fund.legalType,
    } : null,
  };
  const signalsCtx = { technicals: base.technicals, analysts: base.analysts, fundamentals: base.fundamentals, price, isFund };
  base.signals = {
    morganStanley: morganStanleySignal(signalsCtx),
    goldmanSachs: goldmanSachsSignal(signalsCtx),
    warrenBufft: warrenBufftSignal({ ...signalsCtx, fundamentals: { ...base.fundamentals, expenseRatio: base.fund?.expenseRatio ?? null } }),
  };
  res.status(200).json({ ...base, fetchedAt: Date.now() });
}
