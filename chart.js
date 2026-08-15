// Candlestick chart with indicator overlays, sub-panels and on-chart signals.
import { analyzeWaves } from "./waves.js";

const W = 940;
const PAD = { l: 8, r: 78 };
const P = { price: [14, 330], vol: [344, 402], rsi: [414, 482], macd: [494, 586] };
const H = 604;
const UP = "#34d399", DOWN = "#f87171";

const state = { range: 66, overlays: { sma20: true, sma50: true, sma200: true, bb: false, waves: true }, candles: [], meta: {}, hover: -1, waves: null };
let els = {};

const fmt = (v, d = 2) => (v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const dstr = (ts) => new Date(ts).toISOString().slice(0, 10);

function sma(a, n) {
  const o = new Array(a.length).fill(null);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    if (i >= n - 1) o[i] = s / n;
  }
  return o;
}
function ema(a, n) {
  const k = 2 / (n + 1);
  const o = [];
  let e = a[0];
  for (const v of a) { e = v * k + e * (1 - k); o.push(e); }
  return o;
}
function rsiArr(c, n = 14) {
  const o = new Array(c.length).fill(null);
  if (c.length < n + 1) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / n, al = l / n;
  o[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (n - 1) + Math.max(0, d)) / n;
    al = (al * (n - 1) + Math.max(0, -d)) / n;
    o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return o;
}

function computeIndicators(candles) {
  const c = candles.map((k) => k.c);
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const macd = e12.map((v, i) => v - e26[i]);
  const signal = ema(macd, 9);
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200);
  const r14 = rsiArr(c);
  const bbU = [], bbL = [];
  for (let i = 0; i < c.length; i++) {
    if (i < 19 || s20[i] == null) { bbU.push(null); bbL.push(null); continue; }
    const win = c.slice(i - 19, i + 1);
    const m = s20[i];
    const sd = Math.sqrt(win.reduce((a, v) => a + (v - m) ** 2, 0) / 20);
    bbU.push(m + 2 * sd); bbL.push(m - 2 * sd);
  }
  return { c, s20, s50, s200, r14, macd, signal, hist: macd.map((v, i) => v - signal[i]), bbU, bbL };
}

function detectSignals(candles, ind) {
  const out = [];
  const cross = (a, b, i) => {
    if (a[i - 1] == null || b[i - 1] == null || a[i] == null || b[i] == null) return null;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) return "up";
    if (a[i - 1] >= b[i - 1] && a[i] < b[i]) return "down";
    return null;
  };
  for (let i = 1; i < candles.length; i++) {
    const d = dstr(candles[i].t);
    let x = cross(ind.s50, ind.s200, i);
    if (x) out.push({ i, dir: x, label: x === "up" ? "Golden cross" : "Death cross", detail: `SMA50 crossed ${x === "up" ? "above" : "below"} SMA200 · ${d}` });
    x = cross(ind.s20, ind.s50, i);
    if (x) out.push({ i, dir: x, label: x === "up" ? "SMA20>50 cross" : "SMA20<50 cross", detail: `SMA20 crossed ${x === "up" ? "above" : "below"} SMA50 · ${d}` });
    x = cross(ind.macd, ind.signal, i);
    if (x) out.push({ i, dir: x, label: x === "up" ? "MACD buy cross" : "MACD sell cross", detail: `MACD crossed ${x === "up" ? "above" : "below"} signal · ${d}` });
    if (ind.r14[i - 1] != null && ind.r14[i] != null) {
      if (ind.r14[i - 1] < 30 && ind.r14[i] >= 30) out.push({ i, dir: "up", label: "RSI oversold exit", detail: `RSI recovered above 30 (${ind.r14[i].toFixed(0)}) · ${d}` });
      if (ind.r14[i - 1] > 70 && ind.r14[i] <= 70) out.push({ i, dir: "down", label: "RSI overbought exit", detail: `RSI fell below 70 (${ind.r14[i].toFixed(0)}) · ${d}` });
    }
    if (i > 252) {
      const win = ind.c.slice(i - 252, i);
      const hi = Math.max(...win), lo = Math.min(...win);
      if (ind.c[i] > hi) out.push({ i, dir: "up", label: "New 52w high", detail: `Broke to a new 52-week high · ${d}` });
      if (ind.c[i] < lo) out.push({ i, dir: "down", label: "New 52w low", detail: `Broke to a new 52-week low · ${d}` });
    }
  }
  return out;
}

function render() {
  const { candles, meta } = state;
  if (!candles || candles.length < 30) {
    els.svgWrap.innerHTML = `<p class="hint">Not enough price history for the candle chart.</p>`;
    els.legend.innerHTML = "";
    return;
  }
  const ind = computeIndicators(candles);
  const signals = detectSignals(candles, ind);
  state.ind = ind; state.signals = signals;

  const n = Math.min(state.range, candles.length);
  const start = candles.length - n;
  const view = candles.slice(start);
  const vi = (k) => start + k;
  const plotW = W - PAD.l - PAD.r;
  const step = plotW / n;
  const bw = Math.max(1.5, Math.min(11, step * 0.66));
  const x = (k) => PAD.l + (k + 0.5) * step;

  let lo = Math.min(...view.map((k) => k.l));
  let hi = Math.max(...view.map((k) => k.h));
  if (state.overlays.bb) {
    for (let k = 0; k < n; k++) { const u = ind.bbU[vi(k)], l = ind.bbL[vi(k)]; if (u != null) hi = Math.max(hi, u); if (l != null) lo = Math.min(lo, l); }
  }
  if (state.overlays.sma200) {
    for (let k = 0; k < n; k++) { const v = ind.s200[vi(k)]; if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } }
  }
  const padP = (hi - lo) * 0.06 || 1;
  lo -= padP; hi += padP;
  const [pt, pb] = P.price;
  const py = (v) => pt + (1 - (v - lo) / (hi - lo)) * (pb - pt);

  const vmax = Math.max(...view.map((k) => k.v || 0), 1);
  const [vt, vb] = P.vol;
  const vy = (v) => vb - (v / vmax) * (vb - vt);

  const [rt, rb] = P.rsi;
  const ry = (v) => rb - (v / 100) * (rb - rt);

  let mm = 0.001;
  for (let k = 0; k < n; k++) {
    mm = Math.max(mm, Math.abs(ind.macd[vi(k)]), Math.abs(ind.signal[vi(k)]), Math.abs(ind.hist[vi(k)]));
  }
  const [mt, mb] = P.macd;
  const mZero = (mt + mb) / 2;
  const my = (v) => mZero - (v / mm) * ((mb - mt) / 2);

  const line = (arr, color, width = 1.6, dash = "") => {
    const pts = [];
    for (let k = 0; k < n; k++) { const v = arr[vi(k)]; if (v != null) pts.push(`${x(k).toFixed(1)},${py(v).toFixed(1)}`); }
    return pts.length > 1 ? `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` : "";
  };
  const subLine = (arr, yf, color, width = 1.5) => {
    const pts = [];
    for (let k = 0; k < n; k++) { const v = arr[vi(k)]; if (v != null) pts.push(`${x(k).toFixed(1)},${yf(v).toFixed(1)}`); }
    return pts.length > 1 ? `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="${width}"/>` : "";
  };

  const candlesSvg = view.map((k, j) => {
    const col = k.c >= k.o ? UP : DOWN;
    const cx = x(j).toFixed(1);
    const bodyTop = py(Math.max(k.o, k.c)).toFixed(1);
    const bodyH = Math.max(1, Math.abs(py(k.o) - py(k.c))).toFixed(1);
    return `<g><line x1="${cx}" x2="${cx}" y1="${py(k.h).toFixed(1)}" y2="${py(k.l).toFixed(1)}" stroke="${col}" stroke-width="1"/><rect x="${(x(j) - bw / 2).toFixed(1)}" y="${bodyTop}" width="${bw.toFixed(1)}" height="${bodyH}" fill="${col}" rx="0.8"/></g>`;
  }).join("");

  const volSvg = view.map((k, j) => {
    const col = k.c >= k.o ? "rgba(52,211,153,.45)" : "rgba(248,113,113,.45)";
    const vv = k.v || 0;
    return `<rect x="${(x(j) - bw / 2).toFixed(1)}" y="${vy(vv).toFixed(1)}" width="${bw.toFixed(1)}" height="${(vb - vy(vv)).toFixed(1)}" fill="${col}"/>`;
  }).join("");

  const macdHist = view.map((_, j) => {
    const h = ind.hist[vi(j)];
    const y0 = my(0), y1 = my(h);
    const col = h >= 0 ? "rgba(52,211,153,.5)" : "rgba(248,113,113,.5)";
    return `<rect x="${(x(j) - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" fill="${col}"/>`;
  }).join("");

  const markers = signals.filter((s) => s.i >= start).map((s) => {
    const j = s.i - start;
    const cx = x(j);
    const bull = s.dir === "up";
    const y = bull ? py(view[j].l) + 14 : py(view[j].h) - 14;
    const tri = bull
      ? `${cx - 5},${y + 7} ${cx + 5},${y + 7} ${cx},${y}`
      : `${cx - 5},${y - 7} ${cx + 5},${y - 7} ${cx},${y}`;
    return `<g><polygon points="${tri}" fill="${bull ? UP : DOWN}" opacity="0.95"><title>${s.label} — ${s.detail}</title></polygon><circle cx="${cx}" cy="${y}" r="9" fill="transparent"><title>${s.label} — ${s.detail}</title></circle></g>`;
  }).join("");

  // ---- Elliott zigzag + wave labels + pattern lines ----
  let wavesSvg = "";
  if (state.overlays.waves && state.waves) {
    const wz = state.waves;
    const zzPts = wz.zig.filter((p) => p.i >= start && p.i < start + n).map((p) => `${x(p.i - start).toFixed(1)},${py(p.p).toFixed(1)}`).join(" ");
    wavesSvg += `<polyline points="${zzPts}" fill="none" stroke="rgba(229,231,235,.55)" stroke-width="1.3" stroke-dasharray="5 4"/>`;

    const el = wz.elliott;
    if (el) {
      wavesSvg += el.labels.filter((p) => p.i >= start && p.i < start + n).map((p) => {
        const cx = x(p.i - start), cy = py(p.p) + (p.t === "H" ? -16 : 16);
        return `<g><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="rgba(139,92,246,.85)" stroke="#c4b5fd" stroke-width="1"/><text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" font-size="10" font-weight="800" text-anchor="middle" fill="#fff">${p.label}</text><title>Elliott ${p.label} · ${fmt(p.p)} · ${dstr(view[p.i - start]?.t || 0)}</title></g>`;
      }).join("");
    }

    const dirColor = { bullish: "#34d399", bearish: "#f87171", neutral: "#fbbf24" };
    wavesSvg += wz.patterns.filter((pat) => pat.end >= start).map((pat) => {
      const y = py(pat.level);
      const x1 = x(Math.max(0, pat.start - start));
      const col = dirColor[pat.dir] || "#fbbf24";
      return `<line x1="${x1.toFixed(1)}" x2="${W - PAD.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="1.6" stroke-dasharray="8 5" opacity="0.85"/>
      <text x="${(W - PAD.r - 4).toFixed(1)}" y="${(y - 5).toFixed(1)}" font-size="10" font-weight="700" text-anchor="end" fill="${col}">${pat.name}${pat.status === "confirmed" ? " ✓" : ""}</text>
      <title>${pat.name} (${pat.dir}, ${pat.status}) — ${pat.detail}. Level ${fmt(pat.level)}, target ${fmt(pat.target)}</title>`;
    }).join("");

    // trade plan lines for the highest-priority pattern
    const top = wz.patterns[0];
    if (top && top.plan) {
      const pl = top.plan;
      const pline = (v, color, label, dash) => {
        if (v == null) return "";
        const y = py(v);
        if (y < pt - 12 || y > pb + 12) return "";
        return `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" opacity="0.7"/><text x="${W - PAD.r + 6}" y="${(y + 3.5).toFixed(1)}" font-size="9.5" fill="${color}" font-family="ui-monospace">${label}</text>`;
      };
      wavesSvg += pline(pl.entry, "#c4b5fd", "E", "6 4") + pline(pl.stop, "#f87171", "S", "3 4") +
        pline(pl.t1, "#34d399", "T1", "3 4") + pline(pl.t2, "rgba(52,211,153,.65)", "T2", "2 5");
    }
  }

  const earn = (meta.earningsDates || []).map((d) => {
    const j = view.findIndex((k) => dstr(k.t) === d.date);
    if (j < 0) return "";
    const cx = x(j);
    return `<line x1="${cx}" x2="${cx}" y1="${pt}" y2="${mb}" stroke="#fbbf24" stroke-dasharray="3 4" opacity="0.65"/><g><rect x="${cx - 7}" y="${pt}" width="14" height="14" rx="3" fill="#fbbf24"/><text x="${cx}" y="${pt + 11}" font-size="10" font-weight="800" text-anchor="middle" fill="#1a1205">E</text><title>Earnings — ${d.date}${d.move != null ? ` · next day ${d.move >= 0 ? "+" : ""}${(d.move * 100).toFixed(1)}%` : ""}</title></g>`;
  }).join("");

  const axisLabels = [0, 0.5, 1].map((f) => {
    const v = lo + f * (hi - lo);
    return `<text x="${W - PAD.r + 6}" y="${(py(v) + 4).toFixed(1)}" font-size="10.5" fill="#9d94b8" font-family="ui-monospace">${fmt(v, v > 100 ? 0 : 2)}</text>`;
  }).join("");

  const lastC = view[n - 1];
  const lastY = py(lastC.c);
  const dateTicks = [0, Math.floor(n / 2), n - 1].map((j) =>
    `<text x="${x(j).toFixed(1)}" y="${H - 6}" font-size="10.5" fill="#9d94b8" text-anchor="${j === 0 ? "start" : j === n - 1 ? "end" : "middle"}">${dstr(view[j].t).slice(2)}</text>`).join("");

  const bbBand = state.overlays.bb ? (() => {
    const a = [], b = [];
    for (let k = 0; k < n; k++) {
      const u = ind.bbU[vi(k)], l = ind.bbL[vi(k)];
      if (u != null) { a.push(`${x(k)},${py(u)}`); b.push(`${x(k)},${py(l)}`); }
    }
    return a.length ? `<polygon points="${[...a, ...b.reverse()].join(" ")}" fill="rgba(139,92,246,.06)"/>${line(ind.bbU, "rgba(167,139,250,.5)", 1, "4 3")}${line(ind.bbL, "rgba(167,139,250,.5)", 1, "4 3")}` : "";
  })() : "";

  els.svgWrap.innerHTML = `
  <div class="cd-svg-box" style="position:relative">
    <svg viewBox="0 0 ${W} ${H}" id="cdSvg" preserveAspectRatio="none" style="width:100%;height:auto;display:block">
      <text x="${PAD.l}" y="${pt + 2}" font-size="10" fill="#6d6486" font-weight="700">PRICE (${meta.symbol || ""})</text>
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${pb + 6}" y2="${pb + 6}" stroke="#2a2140"/>
      ${axisLabels}
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${lastY}" y2="${lastY}" stroke="${lastC.c >= lastC.o ? UP : DOWN}" stroke-dasharray="2 4" opacity="0.6"/>
      <text x="${W - PAD.r + 6}" y="${lastY + 4}" font-size="11" font-weight="700" fill="${lastC.c >= lastC.o ? UP : DOWN}" font-family="ui-monospace">${fmt(lastC.c, lastC.c > 100 ? 0 : 2)}</text>
      ${bbBand}
      ${candlesSvg}
      ${state.overlays.sma20 ? line(ind.s20, "#a78bfa", 1.6) : ""}
      ${state.overlays.sma50 ? line(ind.s50, "#fbbf24", 1.6) : ""}
      ${state.overlays.sma200 ? line(ind.s200, "#60a5fa", 1.6) : ""}
      ${markers}${wavesSvg}${earn}
      <text x="${PAD.l}" y="${vt - 2}" font-size="10" fill="#6d6486" font-weight="700">VOLUME</text>
      ${volSvg}
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${rb + 8}" y2="${rb + 8}" stroke="#2a2140"/>
      <text x="${PAD.l}" y="${rt - 2}" font-size="10" fill="#6d6486" font-weight="700">RSI 14</text>
      <rect x="${PAD.l}" y="${ry(70)}" width="${plotW}" height="${ry(30) - ry(70)}" fill="rgba(139,92,246,.05)"/>
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${ry(70)}" y2="${ry(70)}" stroke="#f87171" stroke-dasharray="3 4" opacity="0.6"/>
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${ry(30)}" y2="${ry(30)}" stroke="#34d399" stroke-dasharray="3 4" opacity="0.6"/>
      <text x="${W - PAD.r + 6}" y="${ry(70) + 3}" font-size="10" fill="#f87171">70</text>
      <text x="${W - PAD.r + 6}" y="${ry(30) + 3}" font-size="10" fill="#34d399">30</text>
      ${subLine(ind.r14, ry, "#8b5cf6", 1.5)}
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${mb + 10}" y2="${mb + 10}" stroke="#2a2140"/>
      <text x="${PAD.l}" y="${mt - 2}" font-size="10" fill="#6d6486" font-weight="700">MACD 12,26,9</text>
      ${macdHist}${subLine(ind.macd, my, "#e5e7eb", 1.4)}${subLine(ind.signal, my, "#fbbf24", 1.4)}
      <line id="cdCross" x1="0" x2="0" y1="${pt}" y2="${mb}" stroke="#c4b5fd" stroke-width="0.8" opacity="0"/>
      ${dateTicks}
      <rect x="${PAD.l}" y="0" width="${plotW}" height="${H}" fill="transparent" id="cdHit"/>
    </svg>
    <div class="cd-tip" id="cdTip" style="display:none"></div>
  </div>`;

  const svg = document.getElementById("cdSvg");
  const tip = document.getElementById("cdTip");
  const hit = document.getElementById("cdHit");
  const cross = document.getElementById("cdCross");
  const box = els.svgWrap.querySelector(".cd-svg-box");
  hit.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const j = Math.max(0, Math.min(n - 1, Math.floor((vx - PAD.l) / step)));
    state.hover = j;
    const k = view[j], g = vi(j);
    const chg = j > 0 ? k.c / view[j - 1].c - 1 : 0;
    cross.setAttribute("x1", x(j)); cross.setAttribute("x2", x(j)); cross.setAttribute("opacity", "0.55");
    tip.style.display = "block";
    tip.innerHTML = `<b>${dstr(k.t)}</b> · O ${fmt(k.o)} H ${fmt(k.h)} L ${fmt(k.l)} C <b class="${k.c >= k.o ? "pos" : "neg"}">${fmt(k.c)}</b> (${(chg * 100).toFixed(2)}%)<br><span class="muted">Vol ${((k.v || 0) / 1e6).toFixed(1)}M · RSI ${ind.r14[g] != null ? ind.r14[g].toFixed(0) : "—"} · MACD ${ind.macd[g].toFixed(2)} · S20 ${ind.s20[g] != null ? ind.s20[g].toFixed(2) : "—"} · S50 ${ind.s50[g] != null ? ind.s50[g].toFixed(2) : "—"}</span>`;
    const boxR = box.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX - boxR.left + 14, Math.max(10, boxR.width - 270))}px`;
    tip.style.top = `${Math.max(8, e.clientY - boxR.top - 64)}px`;
  });
  hit.addEventListener("mouseleave", () => {
    tip.style.display = "none";
    cross.setAttribute("opacity", "0");
  });

  renderLegend(ind, signals, start);
}

function renderLegend(ind, signals, start) {
  const n = state.candles.length - 1;
  const visible = signals.filter((s) => s.i >= start);
  const counts = {};
  for (const s of visible) counts[s.label] = (counts[s.label] || 0) + 1;
  const bearWords = ["death", "sell", "low", "<"];
  els.legend.innerHTML = `
    <span class="cd-chip"><i class="sw" style="background:#a78bfa"></i>SMA20 ${fmt(ind.s20[n], 1)}</span>
    <span class="cd-chip"><i class="sw" style="background:#fbbf24"></i>SMA50 ${fmt(ind.s50[n], 1)}</span>
    <span class="cd-chip"><i class="sw" style="background:#60a5fa"></i>SMA200 ${fmt(ind.s200[n], 1)}</span>
    <span class="cd-chip">RSI ${ind.r14[n] != null ? ind.r14[n].toFixed(0) : "—"}</span>
    <span class="cd-chip">MACD ${ind.macd[n].toFixed(2)}</span>
    ${Object.entries(counts).map(([l, c]) => {
      const bear = bearWords.some((w) => l.toLowerCase().includes(w));
      return `<span class="cd-chip ${bear ? "neg" : "pos"}">${l} ×${c}</span>`;
    }).join("")}
    <span class="muted" style="font-size:10.5px">▲▼ hover markers for detail · E = earnings day</span>`;
}

export function mountCandleChart(container) {
  els.svgWrap = container.querySelector(".cd-svg");
  els.legend = container.querySelector(".cd-legend");
  const ranges = container.querySelector(".cd-ranges");
  const toggles = container.querySelector(".cd-toggles");

  ranges.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    ranges.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    state.range = Number(b.dataset.n);
    render();
  });
  toggles.addEventListener("change", () => {
    state.overlays = {
      sma20: toggles.querySelector('[data-o="sma20"]').checked,
      sma50: toggles.querySelector('[data-o="sma50"]').checked,
      sma200: toggles.querySelector('[data-o="sma200"]').checked,
      bb: toggles.querySelector('[data-o="bb"]').checked,
      waves: toggles.querySelector('[data-o="waves"]').checked,
    };
    render();
  });

  return {
    update(candles, meta = {}) {
      state.candles = candles;
      state.meta = meta;
      state.hover = -1;
      state.waves = analyzeWaves(candles);
      render();
    },
  };
}
