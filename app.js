import { CATALOG, CATEGORY_LABELS } from "./instruments.js";
import { loadAnalysis, initAnalysis } from "./analysis.js";
import { openTradeModal, initPortfolio, renderPortfolio, initTokenBanner } from "./portfolio.js";
import { mountCandleChart } from "./chart.js";
import { loadPackages } from "./packages.js";
import { store } from "./store.js";
import { initPatternLab } from "./patterns.js";
import { initAlerts } from "./alerts.js";
import { collapse } from "./store.js";

// ---------- state ----------
const state = {
  cat: "stock",
  search: "",
  symbol: "TBCG.L",
  quotes: {}, // sym -> quote data (short)
  history: {}, // sym -> { startTs, data }
};

const $ = (id) => document.getElementById(id);
const els = {
  tabs: $("tabs"), search: $("search"), list: $("instrumentList"),
  selected: $("selectedCard"), result: $("resultCard"), chart: $("chart"),
  chartSub: $("chartSub"), entryDate: $("entryDate"), amount: $("amount"),
  horizon: $("horizon"), target: $("target"), ccyBadge: $("ccyBadge"),
  quickDates: $("quickDates"), refresh: $("refreshBtn"),
  liveDot: $("liveDot"), liveText: $("liveText"),
};

// ---------- helpers ----------
const DAY = 86400000;
const dstr = (ts) => new Date(ts).toISOString().slice(0, 10);
const nowTs = () => Date.now();
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function fmtMoney(v, ccy = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${ccy}`;
  }
}
const fmtPct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const fmtNum = (v, d = 4) => Number(v.toFixed(d)).toLocaleString("en-US");
const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const signCls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "muted");

function setLive(ok, text) {
  els.liveText.parentElement.classList.toggle("ok", ok);
  els.liveText.textContent = text;
}

async function fetchJSON(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- instrument list ----------
function catalogForRender() {
  const q = state.search.trim().toLowerCase();
  return CATALOG.filter((i) => i.cat === state.cat && (!q || i.sym.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)));
}

function renderList() {
  const items = catalogForRender();
  els.list.innerHTML = "";
  for (const inst of items) {
    const q = state.quotes[inst.sym];
    const div = document.createElement("div");
    div.className = "inst" + (inst.sym === state.symbol ? " active" : "");
    const chg = q && q.previousClose ? q.price / q.previousClose - 1 : null;
    div.innerHTML = `
      <div class="meta">
        <div class="sym">${inst.sym}</div>
        <div class="name">${inst.name}</div>
      </div>
      <div class="quote">
        ${q ? (q.error
          ? `<div class="muted">n/a</div>`
          : `<div>${fmtMoney(q.price, q.currency)}</div><div class="chg ${signCls(chg)}">${fmtPct(chg)}</div>`) : `<div class="muted">…</div>`}
      </div>`;
    div.onclick = () => selectInstrument(inst.sym);
    els.list.appendChild(div);
  }
  if (!items.length) els.list.innerHTML = `<p class="hint">No instruments match.</p>`;
}

async function loadQuotes(force = false) {
  const syms = catalogForRender().map((i) => i.sym);
  const fresh = syms.filter((s) => force || !state.quotes[s] || nowTs() - state.quotes[s].fetchedAt > 120000);
  renderList();
  await Promise.all(
    fresh.map(async (sym) => {
      try {
        const p2 = Math.floor(nowTs() / 1000) + 86400;
        const p1 = p2 - 10 * 86400;
        const q = await fetchJSON(`/api/history?symbol=${encodeURIComponent(sym)}&period1=${p1}&period2=${p2}`);
        state.quotes[sym] = { price: q.price, previousClose: q.previousClose, currency: q.currency, fetchedAt: q.fetchedAt };
      } catch {
        state.quotes[sym] = { error: true, fetchedAt: nowTs() };
      }
      renderList();
    })
  );
  const anyOk = syms.some((s) => state.quotes[s] && !state.quotes[s].error);
  setLive(anyOk, anyOk ? `Live · ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Price feed offline");
}

// ---------- history ----------
async function getHistory(symbol, entryTs) {
  const cached = state.history[symbol];
  const wantStart = Math.floor((entryTs - 7 * DAY) / 1000);
  if (cached && cached.startTs <= wantStart) return cached.data;
  const p2 = Math.floor(nowTs() / 1000) + 86400;
  const p1 = Math.min(wantStart, p2 - 5 * 86400);
  const data = await fetchJSON(`/api/history?symbol=${encodeURIComponent(symbol)}&period1=${p1}&period2=${p2}`);
  state.history[symbol] = { startTs: p1, data };
  return data;
}

async function selectInstrument(sym) {
  state.symbol = sym;
  history.replaceState(null, "", `#sym=${encodeURIComponent(sym)}`);
  renderList();
  const inst = CATALOG.find((i) => i.sym === sym);
  els.ccyBadge.textContent = inst.ccy;
  renderSelected();
  els.result.innerHTML = `<p class="hint">Loading ${sym}…</p>`;
  await compute();
  refreshCandles(sym);
  loadAnalysis(sym);
}

// ---------- deep links: #sym=2513.HK ----------
function symbolFromHash() {
  const m = location.hash.match(/^#sym=(.+)$/);
  if (!m) return null;
  try {
    const sym = decodeURIComponent(m[1]);
    return CATALOG.find((i) => i.sym === sym) ? sym : null;
  } catch {
    return null;
  }
}
function activateCategoryFor(sym) {
  const cat = CATALOG.find((i) => i.sym === sym)?.cat;
  if (!cat) return;
  state.cat = cat;
  els.tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
}
window.addEventListener("hashchange", () => {
  const sym = symbolFromHash();
  if (sym && sym !== state.symbol) selectInstrument(sym);
});

function renderSelected() {
  const inst = CATALOG.find((i) => i.sym === state.symbol);
  const h = state.history[inst.sym]?.data;
  const q = h || state.quotes[inst.sym];
  const chg = q && q.previousClose ? q.price / q.previousClose - 1 : null;
  els.selected.innerHTML = `
    <div class="sel-row">
      <div class="sel-name">
        <h2>${inst.name} <span class="muted" style="font-size:14px">(${inst.sym})</span></h2>
        <div class="sub">${inst.note} · ${CATEGORY_LABELS[inst.cat]} · ${q?.exchange || ""}</div>
      </div>
      <div class="sel-price">
        <div class="px">${q && !q.error ? fmtMoney(q.price, q.currency) : "—"}</div>
        <div class="chg ${signCls(chg || 0)}">${chg == null ? "" : `${fmtPct(chg)} today`}</div>
        <button class="btn primary" id="tradeBtn" style="margin-top:10px;width:100%">Trade · virtual</button>
        <button class="btn" id="shareBtn" style="margin-top:6px;width:100%">🔗 Share link</button>
      </div>
    </div>`;
  const tb = document.getElementById("tradeBtn");
  if (tb) tb.onclick = () => openTradeModal(inst.sym);
  const sb = document.getElementById("shareBtn");
  if (sb) sb.onclick = async () => {
    const url = `${location.origin}${location.pathname}#sym=${encodeURIComponent(inst.sym)}`;
    try {
      await navigator.clipboard.writeText(url);
      sb.textContent = "✓ Link copied";
    } catch {
      prompt("Copy this instrument link:", url);
    }
    setTimeout(() => (sb.textContent = "🔗 Share link"), 1600);
  };
}

// ---------- simulation ----------
function readInputs() {
  const today = dstr(nowTs());
  let entry = els.entryDate.value || today;
  if (entry > today) entry = today;
  const amount = Math.max(1, Number(els.amount.value) || 0);
  const horizon = clamp(Math.round(Number(els.horizon.value) || 90), 1, 3650);
  const target = clamp(Number(els.target.value) || 10, 0.1, 1000) / 100;
  return { entry, amount, horizon, target };
}

function stats(dailyReturns) {
  const n = dailyReturns.length;
  const mu = dailyReturns.reduce((a, b) => a + b, 0) / n;
  const varr = dailyReturns.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, n - 1);
  return { mu, sd: Math.sqrt(varr) };
}

async function compute() {
  const { entry, amount, horizon, target } = readInputs();
  const entryTs = new Date(entry + "T00:00:00Z").getTime();
  const inst = CATALOG.find((i) => i.sym === state.symbol);

  let h;
  try {
    h = await getHistory(inst.sym, entryTs);
  } catch (e) {
    els.result.innerHTML = `<div class="notice">Could not load price data: ${e.message}</div>`;
    setLive(false, "Price feed offline");
    return;
  }
  renderSelected();

  const candles = h.candles;
  if (!candles.length) {
    els.result.innerHTML = `<div class="notice">No price data available for ${inst.sym}.</div>`;
    return;
  }

  // Resolve entry to the first trading day on/after the chosen date
  let idx = candles.findIndex((c) => c.t >= entryTs - 12 * 3600000);
  let notice = "";
  if (idx < 0) {
    idx = 0;
    notice = `${inst.sym} data starts ${dstr(candles[0].t)} — entry moved to the first available trading day.`;
  } else if (dstr(candles[idx].t) !== entry) {
    notice = `${entry} was not a trading day — entry executed at close of ${dstr(candles[idx].t)}.`;
  }

  const entryC = candles[idx];
  const window = candles.slice(idx);
  if (window.length < 2) {
    els.result.innerHTML = `<div class="notice">Not enough price history after ${dstr(entryC.t)} to simulate.</div>`;
    return;
  }

  const ccy = h.currency;
  const entryAdj = entryC.ac;
  const entryPrice = entryC.c;
  const units = amount / entryPrice;
  const goalValue = amount * (1 + target);

  const last = window[window.length - 1];
  const valueNow = amount * (last.ac / entryAdj);
  const plNow = valueNow - amount;
  const pctNow = plNow / amount;
  const daysHeld = Math.max(1, Math.round((last.t - entryC.t) / DAY));
  const annualized = Math.pow(valueNow / amount, 365 / daysHeld) - 1;

  // Goal-hit scan
  const goalLevel = entryAdj * (1 + target);
  let hit = null;
  for (const c of window) {
    if (c.ac >= goalLevel) { hit = c; break; }
  }

  // Horizon window
  const horizonEndTs = entryC.t + horizon * DAY;
  const exitIdx = horizonEndTs <= last.t + DAY ? window.findIndex((c) => c.t >= horizonEndTs - 12 * 3600000) : -1;
  const completed = exitIdx > 0 && exitIdx < window.length - 1;

  // Volatility projection when horizon extends into the future
  const rets = [];
  for (let i = 1; i < window.length; i++) {
    const a = window[i - 1].ac, b = window[i].ac;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  const { mu, sd } = stats(rets);
  let projection = null;
  if (horizonEndTs > last.t && rets.length >= 10) {
    const remaining = Math.max(1, Math.round((horizonEndTs - last.t) / DAY));
    const drift = mu * remaining, vol = sd * Math.sqrt(remaining);
    projection = {
      remaining,
      base: valueNow * Math.exp(drift),
      hi: valueNow * Math.exp(drift + vol),
      lo: valueNow * Math.exp(drift - vol),
    };
  }

  // Render result card
  const progress = clamp((valueNow - amount) / (goalValue - amount), 0, 1);
  const goalReached = valueNow >= goalValue;
  const goalText = goalReached
    ? (hit ? `Goal reached on ${fmtDate(hit.t)} (${Math.round((hit.t - entryC.t) / DAY)} days in).` : "Goal reached.")
    : hit
      ? `Goal hit on ${fmtDate(hit.t)}, then faded — current value is below target again.`
      : projection
        ? `Drift model projects ${((projection.base / goalValue) * 100).toFixed(0)}% of goal in ${projection.remaining} days.`
        : `Needs ${(((goalValue / valueNow) - 1) * 100).toFixed(2)}% more growth to reach the goal.`;

  const pctToGo = goalValue / valueNow - 1;
  els.result.innerHTML = `
    <div class="result-grid">
      <div class="big-pl">
        <div class="label">PAPER PROFIT / LOSS — NOW</div>
        <div class="value ${signCls(plNow)}">${fmtMoney(plNow, ccy)}</div>
        <div class="sub ${signCls(pctNow)}">${fmtPct(pctNow)} · ${fmtMoney(amount, ccy)} → ${fmtMoney(valueNow, ccy)}</div>
      </div>
      <div class="goal-block">
        <div style="font-size:12px;color:var(--muted);font-weight:600">GOAL +${(target * 100).toFixed(1)}% IN ${horizon} DAYS</div>
        <div class="goal-bar"><div style="width:${(progress * 100).toFixed(1)}%"></div></div>
        <div style="font-size:12.5px" class="${goalReached ? "pos" : ""}">${(progress * 100).toFixed(0)}% of the way · target ${fmtMoney(goalValue, ccy)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">${goalText}</div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--muted);font-weight:600">HORIZON — ${horizon} DAYS</div>
        <div style="font-size:13px;margin-top:8px" class="muted">
          ${completed
            ? `Window closed <b style="color:var(--text)">${fmtDate(window[exitIdx].t)}</b><br/>Value then: <b style="color:var(--text);font-family:var(--mono)">${fmtMoney(amount * (window[exitIdx].ac / entryAdj), ccy)}</b>`
            : `Ends <b style="color:var(--text)">${fmtDate(horizonEndTs)}</b><br/>${Math.max(0, Math.round((horizonEndTs - last.t) / DAY))} days remaining`}
        </div>
        ${projection ? `
        <div style="font-size:12px;margin-top:8px" class="muted">
          Projection at horizon (μ±σ):<br/>
          <span style="font-family:var(--mono)">${fmtMoney(projection.lo, ccy)} · <b style="color:var(--text)">${fmtMoney(projection.base, ccy)}</b> · ${fmtMoney(projection.hi, ccy)}</span>
        </div>` : ""}
      </div>
    </div>
    <div class="metrics">
      <div class="metric"><div class="k">Entry price</div><div class="v">${fmtMoney(entryPrice, ccy)}</div></div>
      <div class="metric"><div class="k">Latest price</div><div class="v">${fmtMoney(last.c, ccy)}</div></div>
      <div class="metric"><div class="k">Units held</div><div class="v">${fmtNum(units, 4)}</div></div>
      <div class="metric"><div class="k">Days held</div><div class="v">${daysHeld} / ${horizon}</div></div>
      <div class="metric"><div class="k">Annualized</div><div class="v ${signCls(annualized)}">${fmtPct(annualized)}</div></div>
      <div class="metric"><div class="k">Goal hit</div><div class="v">${hit ? fmtDate(hit.t) : "—"}</div></div>
    </div>
    ${notice ? `<div class="notice">${notice}</div>` : ""}`;

  drawChart({ window, amount, entryAdj, goalValue, ccy, horizonEndTs, entryTs: entryC.t });
  els.chartSub.textContent = `${inst.sym} · ${dstr(entryC.t)} → ${dstr(last.t)} · total-return (adj) basis`;
}

// ---------- chart ----------
function drawChart({ window, amount, entryAdj, goalValue, ccy, horizonEndTs, entryTs }) {
  const W = 920, H = 300, P = { t: 24, r: 116, b: 28, l: 16 };
  const vals = window.map((c) => amount * (c.ac / entryAdj));
  const vmax = Math.max(...vals);
  let lo = Math.min(...vals);
  let hi = Math.max(vmax, Math.min(goalValue, vmax * 1.5));
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;

  const x = (i) => P.l + (i / (window.length - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${P.l},${H - P.b} ${pts} ${x(window.length - 1).toFixed(1)},${H - P.b}`;
  const goalY = y(goalValue);
  const goalVisible = goalValue >= lo && goalValue <= hi;
  const hIdx = clamp(window.findIndex((c) => c.t >= horizonEndTs), 0, window.length - 1);
  const hx = x(hIdx);

  const lastV = vals[vals.length - 1];
  const firstDate = dstr(entryTs), lastDate = dstr(window[window.length - 1].t);

  els.chart.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Simulated portfolio value since entry">
    <defs>
      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="${P.l}" x2="${W - P.r}" y1="${P.t + f * (H - P.t - P.b)}" y2="${P.t + f * (H - P.t - P.b)}" stroke="#2a2140" stroke-dasharray="3 5"/>`).join("")}
    <polygon points="${area}" fill="url(#g1)"/>
    <polyline points="${pts}" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linejoin="round"/>
    ${goalVisible ? `
      <line x1="${P.l}" x2="${W - P.r}" y1="${goalY}" y2="${goalY}" stroke="#fbbf24" stroke-dasharray="7 5" stroke-width="1.5"/>
      <text x="${W - P.r + 8}" y="${goalY + 4}" fill="#fbbf24" font-size="12" font-family="ui-monospace">goal ${fmtMoney(goalValue, ccy)}</text>` : ""}
    <line x1="${hx}" x2="${hx}" y1="${P.t}" y2="${H - P.b}" stroke="#9d94b8" stroke-dasharray="2 5" opacity="0.7"/>
    <text x="${hx + 5}" y="${P.t + 12}" fill="#9d94b8" font-size="11">horizon</text>
    <circle cx="${x(window.length - 1)}" cy="${y(lastV)}" r="4.5" fill="${lastV >= amount ? "#34d399" : "#f87171"}"/>
    <text x="${x(window.length - 1) + 8}" y="${y(lastV) + 4}" fill="${lastV >= amount ? "#34d399" : "#f87171"}" font-size="13" font-weight="700" font-family="ui-monospace">${fmtMoney(lastV, ccy)}</text>
    <text x="${P.l}" y="${H - 8}" fill="#9d94b8" font-size="11">${firstDate}</text>
    <text x="${W - P.r}" y="${H - 8}" fill="#9d94b8" font-size="11" text-anchor="end">${lastDate}</text>
  </svg>`;
}

// ---------- events ----------
let debounceTimer;
function scheduleCompute() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => compute(), 300);
}

els.tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  els.tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
  state.cat = b.dataset.cat;
  store.cat = b.dataset.cat;
  window.dispatchEvent(new CustomEvent("cat-changed", { detail: b.dataset.cat }));
  renderList();
  loadQuotes();
});

els.search.addEventListener("input", () => {
  state.search = els.search.value;
  renderList();
  loadQuotes();
});

[els.entryDate, els.amount, els.horizon, els.target].forEach((el) => el.addEventListener("input", scheduleCompute));

els.quickDates.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  els.entryDate.value = dstr(nowTs() - Number(b.dataset.days) * DAY);
  compute();
});

  els.refresh.addEventListener("click", async () => {
  state.quotes = {};
  state.history = {};
  Object.keys(chartHistCache).forEach((k) => delete chartHistCache[k]);
  setLive(true, "Refreshing…");
  await loadQuotes(true);
  compute();
  refreshCandles(state.symbol);
});

// ---------- view switching ----------
const candleChart = mountCandleChart(document.getElementById("candleWrap"));
const earningsForChart = (d) =>
  d?.events?.nextEarnings?.impact?.history?.map((h) => ({ date: h.date, move: h.nextDayMove })) || [];
let lastChartCandles = null, lastChartMeta = {};
const chartHistCache = {}; // sym -> full 420d history, independent of simulation entry date

function updateCandleChart(extraMeta = {}) {
  if (!lastChartCandles) return;
  candleChart.update(lastChartCandles, { ...lastChartMeta, ...extraMeta });
}

async function refreshCandles(sym) {
  try {
    if (!chartHistCache[sym]) {
      const p2 = Math.floor(nowTs() / 1000) + 86400;
      const p1 = p2 - 430 * 86400; // ~280 trading days so the 1Y timeframe works
      chartHistCache[sym] = await fetchJSON(`/api/history?symbol=${encodeURIComponent(sym)}&period1=${p1}&period2=${p2}`);
    }
    const ch = chartHistCache[sym];
    lastChartCandles = ch.candles;
    lastChartMeta = { symbol: ch.symbol, currency: ch.currency };
    store.candles = ch.candles;
    store.symbol = ch.symbol;
    updateCandleChart();
    window.dispatchEvent(new CustomEvent("candles-loaded"));
  } catch (e) {
    console.warn("candle history failed:", e.message);
  }
}

window.addEventListener("analysis-loaded", (e) => {
  updateCandleChart({ earningsDates: earningsForChart(e.detail) });
});

window.addEventListener("show-portfolio", () => navPortfolio?.click());

const chartMode = $("chartMode");
chartMode.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  chartMode.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
  const candles = b.dataset.m === "candles";
  $("candleWrap").style.display = candles ? "block" : "none";
  $("simChartWrap").style.display = candles ? "none" : "block";
});

const navSim = $("navSim"), navPortfolio = $("navPortfolio");
const navPackages = $("navPackages");
function showView(which) {
  const sim = which === "sim";
  $("simView").style.display = sim ? "flex" : "none";
  $("packagesView").style.display = which === "packages" ? "flex" : "none";
  $("portfolioView").style.display = which === "portfolio" ? "flex" : "none";
  navSim.classList.toggle("active", sim);
  navPackages?.classList.toggle("active", which === "packages");
  navPortfolio.classList.toggle("active", which === "portfolio");
  if (which === "portfolio") renderPortfolio();
  if (which === "packages") loadPackages();
}
navSim.onclick = () => showView("sim");
navPortfolio.onclick = () => showView("portfolio");
navPackages && (navPackages.onclick = () => showView("packages"));


// ---------- section collapse + reorder ----------
const ORDER_KEY = "tbc_section_order";
const sectionPanels = () => [...document.querySelectorAll("[data-section]")];
const domOrder = () => sectionPanels().map((el) => el.dataset.section);
function saveSectionOrder() { localStorage.setItem(ORDER_KEY, JSON.stringify(domOrder())); }
function applySavedOrder() {
  let order;
  try { order = JSON.parse(localStorage.getItem(ORDER_KEY)); } catch {}
  if (!Array.isArray(order)) return;
  const simView = document.getElementById("simView");
  for (const key of order) {
    const el = document.querySelector(`[data-section="${key}"]`);
    if (el) simView.appendChild(el);
  }
}
function moveSection(key, dir) {
  const keys = domOrder();
  const i = keys.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  const simView = document.getElementById("simView");
  for (const k of keys) simView.appendChild(document.querySelector(`[data-section="${k}"]`));
  saveSectionOrder();
}
let dragPanel = null;
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".collapse-btn, .move-up, .move-down");
  if (!btn) return;
  const panel = btn.closest("[data-section]");
  if (!panel) return;
  const key = panel.dataset.section;
  if (btn.classList.contains("collapse-btn")) {
    const v = !panel.classList.contains("collapsed");
    panel.classList.toggle("collapsed", v);
    collapse.set(key, v);
  } else if (btn.classList.contains("move-up")) moveSection(key, -1);
  else moveSection(key, 1);
});
document.addEventListener("mousedown", (e) => {
  const h = e.target.closest(".drag-handle");
  if (h) h.closest("[data-section]")?.setAttribute("draggable", "true");
});
document.addEventListener("dragstart", (e) => {
  const p = e.target.closest?.("[data-section]");
  if (p) { dragPanel = p; p.classList.add("dragging"); }
});
document.addEventListener("dragover", (e) => {
  const target = e.target.closest?.("[data-section]");
  if (!dragPanel || !target || target === dragPanel) return;
  e.preventDefault();
  const r = target.getBoundingClientRect();
  target.parentElement.insertBefore(dragPanel, e.clientY < r.top + r.height / 2 ? target : target.nextSibling);
});
document.addEventListener("drop", (e) => e.preventDefault());
document.addEventListener("dragend", () => {
  if (!dragPanel) return;
  dragPanel.removeAttribute("draggable");
  dragPanel.classList.remove("dragging");
  saveSectionOrder();
  dragPanel = null;
});
document.addEventListener("DOMContentLoaded", () => {
  sectionPanels().forEach((el) => el.classList.toggle("collapsed", collapse.get(el.dataset.section)));
  applySavedOrder();
});

// ---------- init ----------
(function init() {
  els.entryDate.value = dstr(nowTs() - 90 * DAY);
  els.entryDate.max = dstr(nowTs());
  els.ccyBadge.textContent = "GBP";
  const deepSym = symbolFromHash();
  if (deepSym) activateCategoryFor(deepSym);
  renderList();
  loadQuotes();
  selectInstrument(deepSym || "TBCG.L");
  initAnalysis();
  initPortfolio();
  initTokenBanner();
  initPatternLab();
  initAlerts();
  window.addEventListener("show-simulator", () => navSim?.click());
})();
