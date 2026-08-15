// Pattern Lab: dedicated pattern-based analysis with entry/exit/breakout trade
// plans, visual schematics and text explainers + Bill Williams toolkit.

import { store, collapse } from "./store.js";
import { analyzeWaves } from "./waves.js";

const $ = (id) => document.getElementById(id);
const n2 = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "muted");

const EXPLAIN = {
  "Double Top": ["Two highs at the same resistance after an uptrend — the second rally fails to break out, so buyers give up.", "Classic short entry on a close below the neckline (the trough between the peaks). Stop above the peaks; target = neckline minus the pattern height."],
  "Double Bottom": ["Two lows at the same support after a downtrend — sellers fail twice at the same floor.", "Buy the breakout above the neckline (the peak between the lows). Stop below the lows; target = neckline plus the pattern height."],
  "Head & Shoulders": ["Three peaks: shoulders roughly equal, head higher. Uptrend exhaustion in its most famous shape.", "Short the neckline break. Stop above the right shoulder; target = neckline minus the head height."],
  "Inverse H&S": ["Three troughs: shoulders roughly equal, head lower — capitulation then absorption.", "Buy the neckline break. Stop below the right shoulder; target = neckline plus the head depth."],
  "Cup & Handle": ["A rounded bottom (the cup) followed by a shallow drift lower (the handle) — consolidation, not distribution.", "Buy the handle high breakout. Stop below the handle low; target = rim plus cup depth."],
  "Inverted Cup": ["A rounded dome top — slow distribution as buyers quietly exit.", "Short the rim break. Stop above the dome; target = rim minus the dome height."],
  "Ascending Triangle": ["Flat resistance with rising lows — buyers keep lifting the floor until resistance gives way.", "Buy the flat-top breakout. Stop below the last rising low; target = flat level plus base height."],
  "Descending Triangle": ["Flat support with falling highs — sellers press until support breaks.", "Short the flat-bottom break. Stop above the last falling high; target = flat level minus base height."],
  "Symmetrical Triangle": ["Converging highs and lows — energy compressing, direction decided by the breakout.", "Trade the break of the converging lines. Stop at the opposite line; target = apex start plus base height."],
  "Rising Wedge": ["Both lines rising but converging — rallies get weaker until the pattern breaks down.", "Short the lower-line break. Stop above the last high; target = wedge start."],
  "Falling Wedge": ["Both lines falling but converging — selloffs get weaker until the pattern breaks up.", "Buy the upper-line break. Stop below the last low; target = wedge start."],
  "Rising Channel": ["Parallel higher highs and higher lows — a healthy orderly uptrend.", "Buy reactions to the lower line. Stop below the channel; target = the upper line."],
  "Falling Channel": ["Parallel lower highs and lower lows — an orderly decline.", "Sell rallies to the upper line. Stop above the channel; target = the lower line."],
  "Bull Flag": ["A sharp impulse (the pole) then a tight, slightly-down drift (the flag) — a breather, not a reversal.", "Buy the flag-high breakout. Stop below the flag low; target = flag plus the pole length."],
  "Bear Flag": ["A sharp drop then a tight upward drift — shorts reloading.", "Short the flag-low break. Stop above the flag high; target = flag minus the pole length."],
  "Range Breakout": ["Price closes above the 60-day high — resistance became support.", "Buy the breakout close. Stop back inside the range; targets = measured extensions."],
  "Range Breakdown": ["Price closes below the 60-day low — support became resistance.", "Short the breakdown close. Stop back inside the range; targets = measured extensions."],
};

function schematic(name) {
  const s = "fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round";
  const P = {
    "Double Top": `<polyline points="8,20 28,8 46,34 62,8 82,20 122,20" style="${s};stroke:#f87171"/><line x1="4" y1="34" x2="126" y2="34" style="fill:none;stroke:#fbbf24;stroke-width:1.6;stroke-dasharray:5 4"/>`,
    "Double Bottom": `<polyline points="8,44 28,56 46,30 62,56 82,44 122,44" style="${s};stroke:#34d399"/><line x1="4" y1="30" x2="126" y2="30" style="fill:none;stroke:#fbbf24;stroke-width:1.6;stroke-dasharray:5 4"/>`,
    "Head & Shoulders": `<polyline points="8,40 28,18 46,40 62,6 78,40 96,20 118,40" style="${s};stroke:#f87171"/><line x1="4" y1="40" x2="126" y2="40" style="fill:none;stroke:#fbbf24;stroke-width:1.6;stroke-dasharray:5 4"/>`,
    "Inverse H&S": `<polyline points="8,20 28,42 46,20 62,58 78,20 96,40 118,20" style="${s};stroke:#34d399"/><line x1="4" y1="20" x2="126" y2="20" style="fill:none;stroke:#fbbf24;stroke-width:1.6;stroke-dasharray:5 4"/>`,
    "Cup & Handle": `<path d="M8,14 C30,60 60,60 78,16 L84,14 C90,30 98,30 106,20 L122,14" style="${s};stroke:#34d399"/><line x1="4" y1="14" x2="126" y2="14" style="fill:none;stroke:#fbbf24;stroke-width:1.6;stroke-dasharray:5 4"/>`,
    "Inverted Cup": `<path d="M8,52 C30,6 60,6 78,50 L84,52 C90,36 98,36 106,46 L122,52" style="${s};stroke:#f87171"/><line x1="4" y1="52" x2="126" y2="52" style="fill:none;stroke:#fbbf24;stroke-width:1.6;stroke-dasharray:5 4"/>`,
    "Ascending Triangle": `<polyline points="8,52 34,36 62,26 92,18" style="${s};stroke:#34d399"/><line x1="4" y1="14" x2="126" y2="14" style="fill:none;stroke:#f87171;stroke-width:2.2;stroke-dasharray:6 4"/>`,
    "Descending Triangle": `<polyline points="8,14 34,30 62,40 92,48" style="${s};stroke:#f87171"/><line x1="4" y1="52" x2="126" y2="52" style="fill:none;stroke:#34d399;stroke-width:2.2;stroke-dasharray:6 4"/>`,
    "Symmetrical Triangle": `<polyline points="8,10 118,30" style="${s};stroke:#fbbf24"/><polyline points="8,56 118,36" style="${s};stroke:#fbbf24"/>`,
    "Rising Wedge": `<polyline points="8,56 118,18" style="${s};stroke:#f87171"/><polyline points="8,44 118,10" style="${s};stroke:#f87171"/>`,
    "Falling Wedge": `<polyline points="8,10 118,48" style="${s};stroke:#34d399"/><polyline points="8,22 118,56" style="${s};stroke:#34d399"/>`,
    "Rising Channel": `<polyline points="8,44 62,20 118,6" style="${s};stroke:#34d399"/><polyline points="8,58 62,36 118,22" style="${s};stroke:#34d399;opacity:.65"/>`,
    "Falling Channel": `<polyline points="8,6 62,30 118,44" style="${s};stroke:#f87171"/><polyline points="8,22 62,44 118,58" style="${s};stroke:#f87171;opacity:.65"/>`,
    "Bull Flag": `<polyline points="8,54 34,12" style="${s};stroke:#34d399"/><polyline points="34,12 48,20 62,15 76,23 90,18 106,14 122,16" style="${s};stroke:#fbbf24"/>`,
    "Bear Flag": `<polyline points="8,8 34,50" style="${s};stroke:#f87171"/><polyline points="34,50 48,42 62,47 76,39 90,44 106,48 122,46" style="${s};stroke:#fbbf24"/>`,
    "Range Breakout": `<rect x="14" y="24" width="80" height="26" rx="4" style="fill:none;stroke:#9d94b8;stroke-width:2"/><polyline points="94,37 112,37 112,16 126,16" style="${s};stroke:#34d399"/>`,
    "Range Breakdown": `<rect x="14" y="14" width="80" height="26" rx="4" style="fill:none;stroke:#9d94b8;stroke-width:2"/><polyline points="94,27 112,27 112,48 126,48" style="${s};stroke:#f87171"/>`,
  };
  return `<svg viewBox="0 0 130 64" class="pat-schema" aria-hidden="true">${P[name] || P["Symmetrical Triangle"]}</svg>`;
}

export function renderPatternLab() {
  const box = $("patternLab");
  if (!box) return;
  const sym = store.symbol || "—";
  const w = analyzeWaves(store.candles);
  if (!w) {
    box.innerHTML = `<h2>🕯️ Pattern Lab</h2><p class="hint">Select an instrument on the Simulator tab to compute patterns for ${sym}.</p>`;
    return;
  }

  const pats = w.patterns || [];
  const cards = pats.map((p) => {
    const exp = EXPLAIN[p.name] || ["Classical price pattern detected from swing pivots.", "Trade the trigger level with a stop beyond the invalidation point."];
    const pl = p.plan || {};
    return `
    <div class="pat-card ${p.dir}">
      <div class="pat-head">
        ${schematic(p.name)}
        <div>
          <div class="pat-name">${p.name}</div>
          <div class="pat-chips">
            <span class="chip ${p.dir === "bullish" ? "good" : p.dir === "bearish" ? "bad" : "warn"}">${p.dir}</span>
            <span class="chip ${p.status === "confirmed" ? "good" : "neutral"}">${p.status}</span>
            <span class="chip neutral">conf ${p.conf}</span>
          </div>
        </div>
      </div>
      <div class="pat-explain"><b>What it is:</b> ${exp[0]}<br/><b>How to trade it:</b> ${exp[1]}</div>
      <div class="pat-live muted">${p.detail}</div>
      <table class="table pat-plan">
        <tr><th>Entry trigger</th><td class="pat-entry">${n2(pl.entry)}</td></tr>
        <tr><th>Stop-loss</th><td class="pat-stop">${n2(pl.stop)}</td></tr>
        <tr><th>Target 1</th><td class="pat-t1">${n2(pl.t1)}</td></tr>
        <tr><th>Target 2</th><td class="pat-t2">${n2(pl.t2)}</td></tr>
        <tr><th>Reward : Risk</th><td><b class="${(pl.rr ?? 0) >= 2 ? "pos" : (pl.rr ?? 0) >= 1 ? "muted" : "neg"}">${pl.rr != null ? pl.rr.toFixed(2) + " : 1" : "—"}</b></td></tr>
      </table>
      <button class="btn small primary pat-exec" data-sym="${sym}" data-side="${p.dir === "bullish" ? "buy" : "sell"}" data-trigger="${pl.entry}" data-src="Pattern: ${p.name}" data-stop="${pl.stop}" data-target="${pl.t1}">
        ⚡ Execute — ${p.dir === "bullish" ? "buy" : "sell"} limit @ ${n2(pl.entry)} (stop ${n2(pl.stop)} · target ${n2(pl.t1)})
      </button>
    </div>`;
  }).join("");

  const w_ = w.williams;
  const williamsCard = w_ ? `
  <div class="pat-card williams">
    <div class="pat-head">
      <svg viewBox="0 0 130 64" class="pat-schema"><polyline points="8,50 30,40 52,44 72,28 94,32 118,10" style="fill:none;stroke:#8b5cf6;stroke-width:2.4"/><polyline points="8,58 30,50 52,54 72,40 94,44 118,24" style="fill:none;stroke:#a78bfa;stroke-width:2;opacity:.7"/><circle cx="72" cy="28" r="3" fill="#f87171"/><circle cx="52" cy="44" r="3" fill="#34d399"/></svg>
      <div>
        <div class="pat-name">Bill Williams Toolkit</div>
        <div class="pat-chips"><span class="chip neutral">fractals · alligator · AO · %R</span></div>
      </div>
    </div>
    <div class="pat-explain"><b>What it is:</b> Bill Williams' Chaos framework — fractal breakout triggers, the Alligator trend filter (jaw/teeth/lips), momentum via the Awesome Oscillator, and Williams %R for overbought/oversold.<br/><b>Entry logic:</b> buy a close above the last <b>up-fractal</b> only while the Alligator is opening bullish; exit below the last down-fractal. Reverse for shorts.</div>
    <table class="table pat-plan">
      <tr><th>Alligator</th><td>${w_.alligator}</td></tr>
      <tr><th>Lines (J/T/L)</th><td class="muted">${n2(w_.alligatorLevels.jaw)} / ${n2(w_.alligatorLevels.teeth)} / ${n2(w_.alligatorLevels.lips)}</td></tr>
      <tr><th>Buy trigger (last up-fractal)</th><td class="pat-entry">${w_.fractals.lastUp ? n2(w_.fractals.lastUp.p) + ` · ${w_.fractals.lastUp.i} bars ago` : "—"}</td></tr>
      <tr><th>Sell trigger (last down-fractal)</th><td class="pat-stop">${w_.fractals.lastDown ? n2(w_.fractals.lastDown.p) + ` · ${w_.fractals.lastDown.i} bars ago` : "—"}</td></tr>
      <tr><th>Awesome Oscillator</th><td>${w_.ao.state} (${n2(w_.ao.last)})</td></tr>
      <tr><th>Williams %R (14)</th><td>${w_.williamsR.state} (${w_.williamsR.value.toFixed(1)})</td></tr>
      <tr><th>Recent fractals</th><td>${w_.fractals.upCount} up · ${w_.fractals.downCount} down (last 8)</td></tr>
    </table>
    ${w_.fractals.lastUp ? `<button class="btn small primary pat-exec" data-sym="${sym}" data-side="buy" data-trigger="${w_.fractals.lastUp.p}" data-src="Bill Williams: fractal breakout" data-stop="${w_.fractals.lastDown?.p ?? ""}" data-target="">⚡ Execute — buy stop @ last up-fractal ${n2(w_.fractals.lastUp.p)}</button>` : ""}
  </div>` : "";

  box.classList.toggle("collapsed", collapse.get("patternlab"));
  box.innerHTML = `
    <div class="chart-head">
      <h2>🕯️ Pattern Lab — ${sym} · entries, exits &amp; breakouts</h2>
      <div class="section-ctrls"><button class="sc-btn drag-handle" title="Drag to reorder">⋮⋮</button><button class="sc-btn move-up" title="Move up">↑</button><button class="sc-btn move-down" title="Move down">↓</button><button class="sc-btn collapse-btn" title="Show/hide">▾</button></div>
      <span class="muted" style="font-size:11px">levels also drawn on the candlestick chart</span>
    </div>
    <div class="panel-body">
    ${pats.length || williamsCard
      ? `<div class="pat-grid">${cards}${williamsCard}</div>`
      : `<div class="empty">No textbook pattern active for ${sym} right now — sometimes the honest read is "no setup". Check the Bill Williams toolkit on another instrument, or switch timeframes on the chart.</div>`}
    <p class="hint">Detection: fractal swing pivots (4-bar) with adaptive zigzag. Plans use classical measured-move rules (neckline ± height, pole projections, wedge origins). Educational tool — not financial advice.</p>
    </div>`;
}

export function initPatternLab() {
  window.addEventListener("candles-loaded", renderPatternLab);
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".pat-exec");
    if (!b) return;
    import("./portfolio.js").then(({ openTradeModal }) =>
      openTradeModal(b.dataset.sym, {
        side: b.dataset.side,
        orderType: "auto",
        trigger: Number(b.dataset.trigger) || undefined,
        source: b.dataset.src,
        stopHint: b.dataset.stop ? Number(b.dataset.stop) : null,
        targetHint: b.dataset.target ? Number(b.dataset.target) : null,
      })
    );
  });
}
