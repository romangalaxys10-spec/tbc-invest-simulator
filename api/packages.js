// Balanced investment packages: curated instrument groups with live entry
// signals and intra-package correlation, computed from real candles.

import { fetchChart, chartToCandles } from "../lib/yahoo.js";
import { CATALOG } from "../instruments.js";
import { analyzeWaves } from "../waves.js";

const PACKAGES = [
  {
    id: "balanced6040", name: "Balanced 60/40", risk: "Low–Medium",
    thesis: "The classic: 60% global equities for growth, 40% aggregate bonds as the shock absorber. Bonds historically cushion equity drawdowns when macro stress hits.",
    components: [{ sym: "VTI", w: 0.6 }, { sym: "BND", w: 0.4 }],
  },
  {
    id: "stability", name: "Stability Shield", risk: "Low",
    thesis: "Short treasuries + consumer staples + a payments bank: cash-like duration combined with companies whose demand barely flinches in recessions.",
    components: [{ sym: "SHY", w: 0.35 }, { sym: "KO", w: 0.22 }, { sym: "WMT", w: 0.22 }, { sym: "JPM", w: 0.21 }],
  },
  {
    id: "growth", name: "Growth Engine", risk: "High",
    thesis: "US large-cap growth core plus the two AI heavyweights. High expected growth, high drawdowns — size accordingly.",
    components: [{ sym: "QQQ", w: 0.35 }, { sym: "VTI", w: 0.25 }, { sym: "NVDA", w: 0.2 }, { sym: "MSFT", w: 0.2 }],
  },
  {
    id: "georgian", name: "Georgian Banking Duo", risk: "Medium",
    thesis: "Both Georgian banks listed in London: TBC Bank and Bank of Georgia. High local ROE, cheap P/E, one economy — country concentration is the risk you're paid for.",
    components: [{ sym: "TBCG.L", w: 0.55 }, { sym: "BGEO.L", w: 0.45 }],
  },
  {
    id: "global", name: "Global Diversified", risk: "Medium",
    thesis: "World equities (accumulating UCITS) + emerging markets + international bonds + EM sovereign USD debt: four return engines across regions and asset classes.",
    components: [{ sym: "VWRA.L", w: 0.4 }, { sym: "EIMI.L", w: 0.2 }, { sym: "BNDX", w: 0.22 }, { sym: "EMB", w: 0.18 }],
  },
  {
    id: "income", name: "Income Hunter", risk: "Medium",
    thesis: "Corporate high-yield + investment grade + EM sovereigns + EM government bonds — built for cash flow, accepts credit-cycle drawdowns.",
    components: [{ sym: "HYG", w: 0.3 }, { sym: "LQD", w: 0.3 }, { sym: "EMB", w: 0.22 }, { sym: "VWOB", w: 0.18 }],
  },
  {
    id: "geols", name: "Georgian Banks Long/Short", risk: "Medium", mode: "fixed",
    thesis: "Relative-value pair on the two Georgian banks listed in London: long the stronger chart, short the weaker one. Same economy, same regulator — the hedge strips out country risk and keeps only the stock-specific edge.",
    components: [{ sym: "TBCG.L", w: 0.55, role: "long" }, { sym: "BGEO.L", w: 0.45, role: "short" }],
  },
  {
    id: "techhedge", name: "Tech Hedge (Long/Short)", risk: "Medium–High", mode: "fixed",
    thesis: "Long the broad market engine, short the most crowded AI name as the funding leg. When tech sells off, the short pays; when tech rips, the core index participates. Designed to survive both regimes.",
    components: [{ sym: "QQQ", w: 0.4, role: "long" }, { sym: "VTI", w: 0.25, role: "long" }, { sym: "NVDA", w: 0.35, role: "short" }],
  },
  {
    id: "ratespair", name: "Rates Regime Pair", risk: "Low–Medium", mode: "fixed",
    thesis: "Duration pair: long short-duration treasuries (carry + safety), short long-duration treasuries (bleed in a steepener). Profits when the curve steepens; flat-ish when it flattens.",
    components: [{ sym: "SHY", w: 0.5, role: "long" }, { sym: "TLT", w: 0.5, role: "short" }],
  },
  {
    id: "smartbalance", name: "Smart Balance (Dynamic L/S)", risk: "Medium", mode: "dynamic",
    thesis: "One instrument from each asset class — stock, world ETF, bond, EM debt — with sides assigned LIVE by signal: the strongest signal goes long, the weakest goes short, the middle stays long. Rebalances its mind on every refresh to maximize balance.",
    components: [{ sym: "AAPL", w: 0.3 }, { sym: "VWRA.L", w: 0.3 }, { sym: "BND", w: 0.2 }, { sym: "EMB", w: 0.2 }],
  },
  {
    id: "bearkit", name: "Risk-Off Short Kit", risk: "High", mode: "fixed",
    thesis: "Pure short package for risk-off regimes: short the growth index, short long-duration treasuries (inflation/rate risk), short EM local debt. Every leg profits when markets fall — the inverse of a diversified long book.",
    components: [{ sym: "QQQ", w: 0.4, role: "short" }, { sym: "TLT", w: 0.3, role: "short" }, { sym: "EMB", w: 0.3, role: "short" }],
  },
  {
    id: "cryptocore", name: "Crypto Core", risk: "High", mode: "fixed",
    thesis: "The 80/20 of crypto: Bitcoin as the reserve asset, Ethereum as the platform, Solana as the growth satellite. Highest volatility in the app — size accordingly.",
    components: [{ sym: "BTC-USD", w: 0.5, role: "long" }, { sym: "ETH-USD", w: 0.3, role: "long" }, { sym: "SOL-USD", w: 0.2, role: "long" }],
  },
  {
    id: "dollardown", name: "Dollar-Down FX Book", risk: "Medium", mode: "fixed",
    thesis: "FX pair trade: long the two majors against USD (EUR, GBP), short USD via the yen cross as the funding leg. Profits when the dollar weakens; the JPY short cushions a risk-off dollar bid.",
    components: [{ sym: "EURUSD=X", w: 0.35, role: "long" }, { sym: "GBPUSD=X", w: 0.35, role: "long" }, { sym: "USDJPY=X", w: 0.3, role: "short" }],
  },
  {
    id: "commoditypack", name: "Commodity Futures Pack", risk: "High", mode: "fixed",
    thesis: "Hard assets via liquid futures: gold as the monetary anchor, copper as the growth tell, crude as the inflation engine. Classic real-asset inflation hedge.",
    components: [{ sym: "GC=F", w: 0.4, role: "long" }, { sym: "HG=F", w: 0.3, role: "long" }, { sym: "CL=F", w: 0.3, role: "long" }],
  },
  {
    id: "worldindices", name: "World Indices Pack", risk: "Medium", mode: "fixed",
    thesis: "One ticket, five economies: US large caps (S&P 500), Europe (DAX), UK (FTSE), Japan (Nikkei), India (Nifty). Geographic diversification in its purest index form.",
    components: [{ sym: "^GSPC", w: 0.35, role: "long" }, { sym: "^GDAXI", w: 0.2, role: "long" }, { sym: "^FTSE", w: 0.15, role: "long" }, { sym: "^N225", w: 0.15, role: "long" }, { sym: "^NSEI", w: 0.15, role: "long" }],
  },
];

function sma(a, n) { return a.length >= n ? a.slice(-n).reduce((s, v) => s + v, 0) / n : null; }

function rsi14(closes) {
  if (closes.length < 15) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / 14, al = l / 14;
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * 13 + Math.max(0, d)) / 14;
    al = (al * 13 + Math.max(0, -d)) / 14;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function analyze(candles) {
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const s20 = sma(closes, 20), s50 = sma(closes, 50), s200 = sma(closes, 200);
  const rsi = rsi14(closes);
  const mom3 = closes.length > 63 ? last / closes[closes.length - 64] - 1 : null;
  const prev = candles[candles.length - 2]?.c ?? last;

  const checks = [
    s20 != null && last > s20,
    s50 != null && last > s50,
    s200 != null && last > s200,
    rsi != null && rsi >= 45 && rsi <= 70,
    mom3 != null && mom3 > 0,
  ];
  const score = checks.filter(Boolean).length;
  const verdict = score >= 4 ? "Entry now" : score >= 2 ? "DCA in" : "Wait";
  const reasons = [
    s20 != null ? `${last > s20 ? "✓" : "✗"} above SMA20` : "",
    s50 != null ? `${last > s50 ? "✓" : "✗"} above SMA50` : "",
    s200 != null ? `${last > s200 ? "✓" : "✗"} above SMA200` : "",
    rsi != null ? `RSI ${rsi.toFixed(0)}` : "",
    mom3 != null ? `3M ${(mom3 * 100).toFixed(1)}%` : "",
  ].filter(Boolean).join(" · ");

  return { price: last, prevClose: prev, change: last / prev - 1, rsi, mom3, s20, s50, s200, score, verdict, reasons };
}

function corr(a, b) {
  const n = Math.min(a.length, b.length);
  const ra = [], rb = [];
  for (let i = 1; i < n; i++) {
    if (a[i - 1] > 0 && b[i - 1] > 0) { ra.push(Math.log(a[i] / a[i - 1])); rb.push(Math.log(b[i] / b[i - 1])); }
  }
  const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
  const mb = rb.reduce((s, v) => s + v, 0) / rb.length;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = now - 200 * 86400, p2 = now + 86400;
  const symbols = [...new Set([...CATALOG.map((i) => i.sym), ...PACKAGES.flatMap((p) => p.components.map((c) => c.sym))])];

  const settled = await Promise.allSettled(symbols.map((s) => fetchChart(s, p1, p2)));
  const data = {};
  symbols.forEach((s, i) => {
    if (settled[i].status === "fulfilled") {
      const result = settled[i].value;
      const scale = result.meta?.currency === "GBp" ? 100 : 1;
      data[s] = chartToCandles(result).map((k) => ({ ...k, o: k.o / scale, h: k.h / scale, l: k.l / scale, c: k.c / scale, ac: k.ac / scale }));
    }
  });

  // ---------- real-time market curation ----------
  const universe = CATALOG.map((inst) => {
    const candles = data[inst.sym];
    if (!candles || candles.length < 60) return null;
    const a = analyze(candles);
    const w = analyzeWaves(candles);
    const patBoost = (w?.patterns || []).reduce((s, p) => s + (p.dir === "bullish" ? 0.8 : p.dir === "bearish" ? -0.8 : 0), 0);
    return { inst, ...a, adjScore: a.score + patBoost, cat: inst.cat };
  }).filter(Boolean);

  const breadth = universe.filter((u) => u.verdict === "Entry now").length;
  const bearishN = universe.filter((u) => u.verdict === "Wait").length;
  const regime = breadth >= universe.length * 0.5 ? "Risk-On" : bearishN >= universe.length * 0.4 ? "Risk-Off" : "Mixed";

  // greedy selection: best score first, penalize candidates correlated > 0.7 with picks
  const corrOf = (symA, symB) => {
    const a = data[symA].slice(-91).map((x) => x.c), b = data[symB].slice(-91).map((x) => x.c);
    const c = corr(a, b);
    return c == null ? 0 : c;
  };
  const pick = (dir) => {
    const pool = universe
      .filter((u) => (dir === "long" ? u.adjScore >= 3.5 : u.adjScore <= 1.5))
      .sort((a, b) => (dir === "long" ? b.adjScore - a.adjScore : a.adjScore - b.adjScore));
    const chosen = [];
    for (const cand of pool) {
      if (chosen.length >= (dir === "long" ? 3 : 2)) break;
      const catCount = chosen.filter((c) => c.cat === cand.cat).length;
      if (catCount >= 2) continue; // diversify across asset classes
      const tooCorrelated = chosen.some((c) => corrOf(c.inst.sym, cand.inst.sym) > 0.7);
      if (tooCorrelated && chosen.length >= 2) continue;
      chosen.push(cand);
    }
    return chosen;
  };
  const longs = pick("long"), shorts = regime === "Risk-Off" ? pick("short") : (pick("short") || []).slice(0, 1);
  const picks = [...longs.map((u) => ({ u, role: "long" })), ...shorts.map((u) => ({ u, role: "short" }))];
  const totalW = picks.reduce((s, p) => s + Math.max(1, p.u.adjScore), 0) || 1;
  const liveComponents = picks.map(({ u, role }) => ({
    sym: u.inst.sym, w: +(Math.max(1, u.adjScore) / totalW).toFixed(3), role,
    ...u, price: u.price, prevClose: u.prevClose, change: u.change, score: u.score, verdict: u.verdict, reasons: u.reasons,
  }));
  const liveType = liveComponents.length
    ? (liveComponents.every((c) => c.role === "long") ? "buy" : liveComponents.every((c) => c.role === "short") ? "sell" : "mixed")
    : "buy";
  const liveNet = liveComponents.reduce((s, c) => s + (c.role === "short" ? -c.w : c.w), 0);

  const livePackage = {
    id: "livebook", name: "⚡ Live Market Curation", risk: regime === "Risk-Off" ? "High" : "Medium", mode: "live",
    thesis: `Auto-curated seconds ago from all ${universe.length} instruments: ${breadth} bullish / ${universe.length - breadth - bearishN} neutral / ${bearishN} bearish → regime <b>${regime}</b>. Longs = strongest trend + pattern confirmation, diversified across asset classes and correlation-screened. Shorts = weakest momentum as the hedge leg.`,
    components: liveComponents, type: liveType,
    longs: liveComponents.filter((c) => c.role === "long").length,
    shorts: liveComponents.filter((c) => c.role === "short").length,
    netExposure: +liveNet.toFixed(2),
    avgCorr: (() => {
      const pairs = [];
      for (let i = 0; i < liveComponents.length; i++)
        for (let j = i + 1; j < liveComponents.length; j++)
          pairs.push(corrOf(liveComponents[i].sym, liveComponents[j].sym));
      return pairs.length ? +(pairs.reduce((s, v) => s + v, 0) / pairs.length).toFixed(2) : null;
    })(),
    entries: liveComponents.filter((c) => c.verdict === "Entry now").length,
    dca: liveComponents.filter((c) => c.verdict === "DCA in").length,
    waits: liveComponents.filter((c) => c.verdict === "Wait").length,
    packageScore: liveComponents.length ? Math.round((liveComponents.reduce((s, c) => s + c.score, 0) / liveComponents.length) * 20) : null,
    regime,
  };

  const packages = [livePackage, ...PACKAGES.map((pkg) => {
    const components = pkg.components.map((c) => {
      const candles = data[c.sym];
      if (!candles || candles.length < 60) return { ...c, error: true };
      return { ...c, ...analyze(candles) };
    });

    // dynamic mode: assign sides live — strongest signal long, weakest short
    if (pkg.mode === "dynamic") {
      const scored = components.filter((c) => !c.error).sort((a, b) => b.score - a.score);
      if (scored.length >= 2) {
        scored[scored.length - 1].role = "short";
        scored.forEach((c, i) => { if (c.role !== "short") c.role = "long"; });
      } else components.forEach((c) => (c.role = "long"));
    }

    // average pairwise correlation (last 90 daily closes)
    const pairs = [];
    for (let i = 0; i < pkg.components.length; i++) {
      for (let j = i + 1; j < pkg.components.length; j++) {
        const a = data[pkg.components[i].sym], b = data[pkg.components[j].sym];
        if (a && b) {
          const c = corr(a.slice(-91).map((x) => x.c), b.slice(-91).map((x) => x.c));
          if (c != null) pairs.push(c);
        }
      }
    }
    const avgCorr = pairs.length ? pairs.reduce((s, v) => s + v, 0) / pairs.length : null;

    const ok = components.filter((c) => !c.error);
    const longs = ok.filter((c) => (c.role || "long") === "long").length;
    const shorts = ok.length - longs;
    const type = shorts === 0 ? "buy" : longs === 0 ? "sell" : "mixed";
    const netExposure = ok.reduce((s, c) => s + (c.role === "short" ? -c.w : c.w), 0);
    return {
      ...pkg,
      components, type, longs, shorts, netExposure,
      avgCorr,
      entries: ok.filter((c) => c.verdict === "Entry now").length,
      dca: ok.filter((c) => c.verdict === "DCA in").length,
      waits: ok.filter((c) => c.verdict === "Wait").length,
      packageScore: ok.length ? Math.round((ok.reduce((s, c) => s + c.score, 0) / ok.length) * 20) : null,
    };
  })];

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({ packages, fetchedAt: Date.now() });
}
