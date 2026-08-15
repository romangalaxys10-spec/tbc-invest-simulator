// Balanced investment packages: curated instrument groups with live entry
// signals and intra-package correlation, computed from real candles.

import { fetchChart, chartToCandles } from "../lib/yahoo.js";

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

export default async function handler(req, res) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = now - 200 * 86400, p2 = now + 86400;
  const symbols = [...new Set(PACKAGES.flatMap((p) => p.components.map((c) => c.sym)))];

  const settled = await Promise.allSettled(symbols.map((s) => fetchChart(s, p1, p2)));
  const data = {};
  symbols.forEach((s, i) => {
    if (settled[i].status === "fulfilled") {
      const result = settled[i].value;
      const scale = result.meta?.currency === "GBp" ? 100 : 1;
      data[s] = chartToCandles(result).map((k) => ({ ...k, o: k.o / scale, h: k.h / scale, l: k.l / scale, c: k.c / scale, ac: k.ac / scale }));
    }
  });

  const packages = PACKAGES.map((pkg) => {
    const components = pkg.components.map((c) => {
      const candles = data[c.sym];
      if (!candles || candles.length < 60) return { ...c, error: true };
      return { ...c, ...analyze(candles) };
    });

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
    return {
      ...pkg,
      components,
      avgCorr,
      entries: ok.filter((c) => c.verdict === "Entry now").length,
      dca: ok.filter((c) => c.verdict === "DCA in").length,
      waits: ok.filter((c) => c.verdict === "Wait").length,
      packageScore: ok.length ? Math.round((ok.reduce((s, c) => s + c.score, 0) / ok.length) * 20) : null,
    };
  });

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({ packages, fetchedAt: Date.now() });
}
