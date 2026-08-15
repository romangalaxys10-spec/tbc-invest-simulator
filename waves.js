// Elliott Wave (heuristic) + classical chart-pattern detection.
// Pure functions over daily candles: {t, o, h, l, c, v, ac}

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));

// ---- pivots (fractal swings) ----
export function pivots(candles, k = 4) {
  const raw = [];
  for (let i = k; i < candles.length - k; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k; j++) {
      if (candles[i].h < candles[i - j].h || candles[i].h < candles[i + j].h) isH = false;
      if (candles[i].l > candles[i - j].l || candles[i].l > candles[i + j].l) isL = false;
    }
    if (isH) raw.push({ i, p: candles[i].h, t: "H" });
    if (isL) raw.push({ i, p: candles[i].l, t: "L" });
  }
  raw.sort((a, b) => a.i - b.i);
  // enforce alternation, keep the more extreme of consecutive same-type pivots
  const out = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (!last || last.t !== p.t) out.push({ ...p });
    else if ((p.t === "H" && p.p >= last.p) || (p.t === "L" && p.p <= last.p)) out[out.length - 1] = { ...p };
  }
  // adaptive minimum swing: 3× average daily move, clamped 1.2%–6%
  const rets = [];
  for (let i = 1; i < candles.length; i++) rets.push(Math.abs(candles[i].c / candles[i - 1].c - 1));
  const avgRet = rets.reduce((s, v) => s + v, 0) / rets.length;
  const minSwing = Math.min(0.06, Math.max(0.008, 3 * avgRet));
  const zz = [];
  for (const p of out) {
    const last = zz[zz.length - 1];
    if (!last || Math.abs(p.p / last.p - 1) >= minSwing) zz.push(p);
  }
  return zz;
}

function sma(a, n) { return a.length >= n ? a.slice(-n).reduce((s, v) => s + v, 0) / n : null; }

// ---- Elliott wave heuristic ----
export function elliott(candles, zig) {
  if (!zig || zig.length < 4) return null;
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const s200 = sma(closes, 200) ?? sma(closes, closes.length);
  const uptrend = last > s200;

  const win = zig.slice(-11);
  let start;
  if (uptrend) {
    const lows = win.filter((p) => p.t === "L");
    if (!lows.length) return null;
    start = lows.reduce((a, b) => (b.p < a.p ? b : a));
  } else {
    const highs = win.filter((p) => p.t === "H");
    if (!highs.length) return null;
    start = highs.reduce((a, b) => (b.p > a.p ? b : a));
  }
  const seq = win.filter((p) => p.i >= start.i);
  if (seq.length < 3) return null;

  const labels = seq.map((p, idx) => ({ ...p, label: idx === 0 ? "0" : String(idx) }));
  const P = (n) => labels[n]; // P(0)=start, P(1)=wave1 end, ...
  const m = labels.length - 1; // pivots after start
  const impulseDone = m >= 5;

  // rule checks when enough points
  const rules = [];
  if (m >= 3) {
    const ok2 = uptrend ? P(2).p > P(0).p : P(2).p < P(0).p;
    rules.push({ label: "Wave 2 does not retrace past the start", ok: ok2 });
  }
  if (m >= 5) {
    const len = (a, b) => Math.abs(P(b).p - P(a).p);
    const l1 = len(0, 1), l3 = len(2, 3), l5 = len(4, 5);
    rules.push({ label: "Wave 3 is not the shortest of 1/3/5", ok: !(l3 < l1 && l3 < l5) });
    const ok4 = uptrend ? P(4).p > P(1).p : P(4).p < P(1).p;
    rules.push({ label: "Wave 4 does not overlap wave 1 territory", ok: ok4 });
  }
  const passed = rules.filter((r) => r.ok).length;
  const confidence = rules.length ? Math.round((passed / rules.length) * 100) : null;

  let phase, currentWave, targets = [], note;
  if (!impulseDone) {
    currentWave = `wave ${m + 1}`;
    phase = `${uptrend ? "Up" : "Down"}trend impulse — building`;
    if (m >= 4) {
      const w1 = Math.abs(P(1).p - P(0).p);
      const anchor = P(3).p;
      targets = uptrend ? [anchor + w1 * 0.618, anchor + w1] : [anchor - w1 * 0.618, anchor - w1];
      note = `Wave-5 projection using 0.618× and 1× wave-1 length from the wave-4 extreme.`;
    } else if (m >= 2) {
      const w1 = Math.abs(P(1).p - P(0).p);
      const anchor = P(1).p;
      targets = uptrend ? [anchor + w1 * 1.618] : [anchor - w1 * 1.618];
      note = `Wave-3 projection at the classic 1.618× wave-1 extension.`;
    }
  } else {
    phase = `Impulse complete — ${uptrend ? "ABC correction" : "ABC rally"} phase`;
    currentWave = "correction (A-B-C)";
    const span = Math.abs(P(5).p - P(0).p);
    const extreme = P(5).p;
    targets = uptrend
      ? [extreme - span * 0.382, extreme - span * 0.618]
      : [extreme + span * 0.382, extreme + span * 0.618];
    note = `Typical retracement zones of the full impulse (38.2% / 61.8%).`;
  }

  return {
    context: `${uptrend ? "Price above SMA200 → bullish Elliott context" : "Price below SMA200 → bearish Elliott context"}`,
    phase, currentWave, labels, rules, confidence, targets, note,
    trendDir: uptrend ? "up" : "down",
  };
}

// ---- classical patterns with trade plans ----
export function patterns(candles, zig) {
  if (!zig) return [];
  const out = [];
  const last = candles[candles.length - 1].c;
  const H = zig.filter((p) => p.t === "H");
  const L = zig.filter((p) => p.t === "L");
  const near = (a, b, tol) => Math.abs(a / b - 1) <= tol;

  // Double Top / Bottom
  if (H.length >= 2) {
    const [a, b] = H.slice(-2);
    const troughs = L.filter((l) => l.i > a.i && l.i < b.i);
    const trough = troughs.reduce((x, y) => (y.p < x.p ? y : x), troughs[0]);
    if (trough && near(a.p, b.p, 0.04) && b.i - a.i >= 6 && trough.p < Math.min(a.p, b.p) * 0.965) {
      const neck = trough.p;
      out.push(p("Double Top", "bearish", last < neck ? "confirmed" : "forming", a.i, b.i, neck,
        neck - (Math.max(a.p, b.p) - neck),
        near(a.p, b.p, 0.015) ? "high" : "medium",
        `Twin highs ${fmt(a.p)} / ${fmt(b.p)}, neckline ${fmt(neck)}`));
    }
  }
  if (L.length >= 2) {
    const [a, b] = L.slice(-2);
    const peaks = H.filter((h) => h.i > a.i && h.i < b.i);
    const peak = peaks.reduce((x, y) => (y.p > x.p ? y : x), peaks[0]);
    if (peak && near(a.p, b.p, 0.04) && b.i - a.i >= 6 && peak.p > Math.max(a.p, b.p) * 1.035) {
      const neck = peak.p;
      out.push(p("Double Bottom", "bullish", last > neck ? "confirmed" : "forming", a.i, b.i, neck,
        neck + (neck - Math.min(a.p, b.p)),
        near(a.p, b.p, 0.015) ? "high" : "medium",
        `Twin lows ${fmt(a.p)} / ${fmt(b.p)}, neckline ${fmt(neck)}`));
    }
  }

  // Head & Shoulders / Inverse
  if (H.length >= 3) {
    const [s1, head, s2] = H.slice(-3);
    const mids = L.filter((l) => l.i > s1.i && l.i < s2.i);
    if (mids.length >= 2 && head.p > s1.p * 1.015 && head.p > s2.p * 1.015 && near(s1.p, s2.p, 0.05)) {
      const neck = (mids[0].p + mids[mids.length - 1].p) / 2;
      out.push(p("Head & Shoulders", "bearish", last < neck ? "confirmed" : "forming", s1.i, s2.i, neck,
        neck - (head.p - neck), "high" ,
        `Head ${fmt(head.p)} above shoulders ${fmt(s1.p)}/${fmt(s2.p)}, neckline ${fmt(neck)}`));
    }
  }
  if (L.length >= 3) {
    const [s1, head, s2] = L.slice(-3);
    const mids = H.filter((h) => h.i > s1.i && h.i < s2.i);
    if (mids.length >= 2 && head.p < s1.p * 0.985 && head.p < s2.p * 0.985 && near(s1.p, s2.p, 0.05)) {
      const neck = (mids[0].p + mids[mids.length - 1].p) / 2;
      out.push(p("Inverse H&S", "bullish", last > neck ? "confirmed" : "forming", s1.i, s2.i, neck,
        neck + (neck - head.p), "high",
        `Head ${fmt(head.p)} below shoulders ${fmt(s1.p)}/${fmt(s2.p)}, neckline ${fmt(neck)}`));
    }
  }

  // Triangles (last 3 highs vs last 3 lows)
  if (H.length >= 3 && L.length >= 3) {
    const hs = H.slice(-3), ls = L.slice(-3);
    const flatTop = (Math.max(...hs.map((x) => x.p)) - Math.min(...hs.map((x) => x.p))) / Math.max(...hs.map((x) => x.p)) < 0.025;
    const flatBot = (Math.max(...ls.map((x) => x.p)) - Math.min(...ls.map((x) => x.p))) / Math.max(...ls.map((x) => x.p)) < 0.025;
    const risingLows = ls[0].p < ls[1].p && ls[1].p < ls[2].p;
    const fallingHighs = hs[0].p > hs[1].p && hs[1].p > hs[2].p;
    const start = Math.min(hs[0].i, ls[0].i), end = Math.max(hs[2].i, ls[2].i);
    if (flatTop && risingLows) out.push(p("Ascending Triangle", "bullish", last > hs[2].p ? "confirmed" : "forming", start, end, hs[2].p,
      hs[2].p + (hs[2].p - ls[0].p), "medium", `Flat resistance ${fmt(hs[2].p)} with rising lows — buyers pressing up`));
    if (flatBot && fallingHighs) out.push(p("Descending Triangle", "bearish", last < ls[2].p ? "confirmed" : "forming", start, end, ls[2].p,
      ls[2].p - (hs[0].p - ls[2].p), "medium", `Flat support ${fmt(ls[2].p)} with falling highs — sellers pressing down`));
    if (fallingHighs && risingLows) out.push(p("Symmetrical Triangle", "neutral", "forming", start, end,
      Math.max(hs[2].p, ls[2].p), Math.max(hs[2].p, ls[2].p) * 1.05, "medium", `Converging trendlines — breakout pending`));
  }

  // Wedges & channels
  if (H.length >= 3 && L.length >= 3) {
    const hs = H.slice(-3), ls = L.slice(-3);
    const wStart = Math.max(hs[0].p, ls[0].p) - Math.min(hs[0].p, ls[0].p);
    const wEnd = Math.max(hs[2].p, ls[2].p) - Math.min(hs[2].p, ls[2].p);
    const rising = ls[0].p < ls[1].p && ls[1].p < ls[2].p;
    const falling = ls[0].p > ls[1].p && ls[1].p > ls[2].p;
    const upSlope = hs[0].p < hs[1].p && hs[1].p < hs[2].p;
    const downSlope = hs[0].p > hs[1].p && hs[1].p > hs[2].p;
    const converging = wEnd < wStart * 0.7;
    const parallel = Math.abs(wEnd - wStart) < wStart * 0.35;
    if (converging && upSlope && rising) {
      // Rising wedge — bearish reversal
      out.push(p("Rising Wedge", "bearish", last < ls[2].p ? "confirmed" : "forming", hs[0].i, hs[2].i, ls[2].p,
        ls[0].p - wStart, "medium",
        `Both lines rising but converging (width ${fmt(wStart)} → ${fmt(wEnd)}) — momentum dying into resistance`));
    }
    if (converging && downSlope && falling) {
      out.push(p("Falling Wedge", "bullish", last > ls[2].p ? "confirmed" : "forming", hs[0].i, hs[2].i, hs[2].p,
        hs[0].p + wStart, "medium",
        `Both lines falling but converging (width ${fmt(wStart)} → ${fmt(wEnd)}) — selling pressure exhausting`));
    }
    if (parallel && upSlope && rising) {
      out.push(p("Rising Channel", "bullish", "forming", hs[0].i, hs[2].i, ls[2].p,
        hs[2].p, "medium",
        `Higher highs and higher lows in a parallel channel — buy the lower line, sell the upper`));
    }
    if (parallel && downSlope && falling) {
      out.push(p("Falling Channel", "bearish", "forming", hs[0].i, hs[2].i, hs[2].p,
        ls[2].p, "medium",
        `Lower highs and lower lows in a parallel channel — sell rallies to the upper line`));
    }
  }

  // Cup & Handle / Inverse Cup & Handle
  if (H.length >= 2 && L.length >= 3) {
    const rim = H.slice(-2)[0]; // left rim: the high before the last one
    const lows = L.filter((l) => l.i > rim.i);
    if (lows.length >= 2) {
      const cupLow = lows.reduce((a, b) => (b.p < a.p ? b : a));
      const depth = rim.p - cupLow.p;
      const rimRecovery = lows.some((l) => l.i > cupLow.i && l.p > rim.p * 0.93);
      if (depth > rim.p * 0.12 && depth < rim.p * 0.5 && rimRecovery) {
        const recent = candles.slice(-10);
        const handleHigh = Math.max(...recent.map((c) => c.h));
        const handleLow = Math.min(...recent.map((c) => c.l));
        const handleDepth = rim.p - handleLow;
        if (handleDepth < depth * 0.5 && handleDepth > depth * 0.08) {
          out.push(p("Cup & Handle", "bullish", last > handleHigh ? "confirmed" : "forming", rim.i, candles.length - 1, handleHigh,
            rim.p + depth, "high",
            `Rim ${fmt(rim.p)}, cup depth ${fmt(depth)} (${(depth / rim.p * 100).toFixed(0)}%), shallow handle to ${fmt(handleLow)}`));
        }
      }
      // Inverse (inverted) cup: high pivot between two rims
      const invRim = L.slice(-2)[0];
      const highs = H.filter((h) => h.i > invRim.i);
      if (highs.length >= 2) {
        const cupHigh = highs.reduce((a, b) => (b.p > a.p ? b : a));
        const iDepth = cupHigh.p - invRim.p;
        if (iDepth > invRim.p * 0.12 && iDepth < invRim.p * 0.5) {
          out.push(p("Inverted Cup", "bearish", "forming", invRim.i, candles.length - 1, invRim.p,
            invRim.p - iDepth, "medium",
            `Dome top: rim ${fmt(invRim.p)}, peak ${fmt(cupHigh.p)} — distribution rounding off`));
        }
      }
    }
  }

  // Flags (impulse + tight consolidation)
  if (candles.length >= 30) {
    const imp = candles.slice(-22, -8);
    const cons = candles.slice(-8);
    const impMove = imp[imp.length - 1].c / imp[0].c - 1;
    const consHigh = Math.max(...cons.map((c) => c.h));
    const consLow = Math.min(...cons.map((c) => c.l));
    const consRange = consHigh / consLow - 1;
    const consDrift = cons[cons.length - 1].c / cons[0].c - 1;
    if (impMove > 0.06 && consRange < 0.05 && consDrift < 0.025) {
      out.push(p("Bull Flag", "bullish", "forming", candles.length - 22, candles.length - 1, consLow,
        cons[cons.length - 1].c * (1 + impMove), "medium",
        `+${(impMove * 100).toFixed(1)}% impulse, tight ${(consRange * 100).toFixed(1)}% consolidation`));
    }
    if (impMove < -0.06 && consRange < 0.05 && consDrift > -0.025) {
      out.push(p("Bear Flag", "bearish", "forming", candles.length - 22, candles.length - 1, consHigh,
        cons[cons.length - 1].c * (1 + impMove), "medium",
        `${(impMove * 100).toFixed(1)}% impulse down, tight ${(consRange * 100).toFixed(1)}% consolidation`));
    }
  }

  // 60-day range breakout
  if (candles.length >= 75) {
    const win = candles.slice(-60, -1);
    const hi = Math.max(...win.map((c) => c.h)), lo = Math.min(...win.map((c) => c.l));
    if (last > hi) out.push(p("Range Breakout", "bullish", "confirmed", candles.length - 1, candles.length - 1, hi,
      hi * 1.05, "high", `Closed above the 60-day high ${fmt(hi)}`));
    if (last < lo) out.push(p("Range Breakdown", "bearish", "confirmed", candles.length - 1, candles.length - 1, lo,
      lo * 0.95, "high", `Closed below the 60-day low ${fmt(lo)}`));
  }

  // compute classical trade plans (entry / stop / targets / R:R)
  const planned = out.slice(0, 5).map((pat) => {
    const long = pat.dir === "bullish";
    const entry = pat.level; // trigger = break of the key level (or pole/rim projection for flags)
    let stop, t1 = pat.target, t2 = null;
    switch (pat.name) {
      case "Double Top": stop = pat.level + (pat.level - pat.target) * 0.35; t2 = pat.level - (pat.level - pat.target) * 1.5; break;
      case "Double Bottom": stop = pat.level - (pat.target - pat.level) * 0.35; t2 = pat.level + (pat.target - pat.level) * 1.5; break;
      case "Head & Shoulders": case "Inverse H&S": stop = long ? pat.level - (pat.target - pat.level) * 0.4 : pat.level + (pat.level - pat.target) * 0.4; t2 = long ? pat.level + (pat.target - pat.level) * 1.5 : pat.level - (pat.level - pat.target) * 1.5; break;
      case "Bull Flag": case "Bear Flag": stop = long ? entry * 0.975 : entry * 1.025; t2 = long ? entry + (pat.target - entry) * 1.27 : entry - (entry - pat.target) * 1.27; break;
      case "Cup & Handle": stop = entry - (pat.target - entry) * 0.45; t2 = entry + (pat.target - entry) * 1.27; break;
      default: stop = long ? entry * 0.975 : entry * 1.025; t2 = long ? pat.target * 1.05 : pat.target * 0.95;
    }
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(t1 - entry);
    const rr = risk > 0 ? reward / risk : null;
    return { ...pat, plan: { entry, stop, t1, t2, rr } };
  });
  return planned;

  function p(name, dir, status, start, end, level, target, conf, detail) {
    return { name, dir, status, start, end, level, target, conf, detail };
  }
}

// ---- Bill Williams toolkit: fractals, Alligator, AO, Williams %R ----
export function williams(candles) {
  if (!candles || candles.length < 40) return null;
  const n = candles.length;
  const up = [], down = [];
  for (let i = 2; i < n - 2; i++) {
    const c = candles[i];
    if (c.h > candles[i - 1].h && c.h > candles[i - 2].h && c.h > candles[i + 1].h && c.h > candles[i + 2].h) up.push({ i, p: c.h });
    if (c.l < candles[i - 1].l && c.l < candles[i - 2].l && c.l < candles[i + 1].l && c.l < candles[i + 2].l) down.push({ i, p: c.l });
  }

  const smma = (src, len) => {
    const out = new Array(src.length).fill(null);
    let s = src.slice(0, len).reduce((a, b) => a + b, 0) / len;
    out[len - 1] = s;
    for (let i = len; i < src.length; i++) {
      s = (s * (len - 1) + src[i]) / len;
      out[i] = s;
    }
    return out;
  };
  const hl2 = candles.map((c) => (c.h + c.l) / 2);
  const jaw = smma(hl2, 13), teeth = smma(hl2, 8), lips = smma(hl2, 5);
  const i = n - 1;
  const j = jaw[i], t = teeth[i], l = lips[i], price = candles[i].c;
  let alligator;
  if (j == null || t == null || l == null) alligator = "insufficient data";
  else if (Math.abs(j - t) / price < 0.004 && Math.abs(t - l) / price < 0.004) alligator = "sleeping (lines intertwined — no trade zone)";
  else if (l > t && t > j && price > l) alligator = "opening bullish (price above all lines)";
  else if (l < t && t < j && price < l) alligator = "opening bearish (price below all lines)";
  else if (price > l) alligator = "waking bullish";
  else alligator = "waking bearish";

  // Awesome Oscillator
  const sma = (src, len) => src.map((_, k) => (k >= len - 1 ? src.slice(k - len + 1, k + 1).reduce((a, b) => a + b, 0) / len : null));
  const s5 = sma(hl2, 5), s34 = sma(hl2, 34);
  const ao = s5.map((v, k) => (v != null && s34[k] != null ? v - s34[k] : null)).filter((v) => v != null);
  const aoLast = ao.at(-1), aoPrev = ao.at(-2), aoPrev2 = ao.at(-3);
  let aoState = "flat";
  if (aoLast != null && aoPrev != null && aoPrev2 != null) {
    if (aoLast > 0 && aoLast > aoPrev && aoPrev > aoPrev2) aoState = "bullish saucer (3 rising green bars)";
    else if (aoLast < 0 && aoLast < aoPrev && aoPrev < aoPrev2) aoState = "bearish saucer (3 falling red bars)";
    else if (aoLast > 0) aoState = "above zero — bullish momentum";
    else aoState = "below zero — bearish momentum";
  }

  // Williams %R (14)
  const win = candles.slice(-14);
  const hh = Math.max(...win.map((c) => c.h)), ll = Math.min(...win.map((c) => c.l));
  const wr = hh === ll ? -50 : ((hh - candles[i].c) / (hh - ll)) * -100;
  const wrState = wr > -20 ? "overbought" : wr < -80 ? "oversold" : "neutral";

  return {
    fractals: {
      upCount: up.slice(-8).length, downCount: down.slice(-8).length,
      lastUp: up.at(-1) || null, lastDown: down.at(-1) || null,
    },
    alligator, alligatorLevels: { jaw: j, teeth: t, lips: l },
    ao: { last: aoLast, state: aoState },
    williamsR: { value: wr, state: wrState },
  };
}

export function analyzeWaves(candles) {
  if (!candles || candles.length < 60) return null;
  const zig = pivots(candles);
  return { zig, elliott: elliott(candles, zig), patterns: patterns(candles, zig), williams: williams(candles) };
}
