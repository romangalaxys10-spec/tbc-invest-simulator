// Intraday radar: hourly market scan, alert bell, and the intraday box.

import { store } from "./store.js";
import { CATEGORY_LABELS } from "./instruments.js";

const $ = (id) => document.getElementById(id);
const KEY_ALERTS = "tbc_alerts_v1";
const HOUR = 3600000;

let lastScan = null;
let radarFilter = "all";

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(KEY_ALERTS)) || { seen: {}, lastView: 0 }; }
  catch { return { seen: {}, lastView: 0 }; }
}
function saveSeen(s) { localStorage.setItem(KEY_ALERTS, JSON.stringify(s)); }

function dirChip(dir) {
  return dir === "bullish" ? '<span class="chip good">▲ bullish</span>' : dir === "bearish" ? '<span class="chip bad">▼ bearish</span>' : '<span class="chip warn">• neutral</span>';
}

export async function scanMarket({ silent = true } = {}) {
  try {
    const r = await fetch("/api/scan");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    lastScan = j;
    const seen = loadSeen();
    const hourKey = new Date().toISOString().slice(0, 13);
    let fresh = 0;
    for (const a of j.alerts) {
      const k = `${a.sym}|${a.type}|${hourKey}`;
      if (!seen.seen[k]) { seen.seen[k] = Date.now(); fresh++; }
    }
    for (const k of Object.keys(seen.seen)) if (Date.now() - seen.seen[k] > 48 * HOUR) delete seen.seen[k];
    saveSeen(seen);
    renderBell();
    renderIntraday();
    if (!silent && fresh > 0 && "Notification" in window && Notification.permission === "granted") {
      new Notification(`TBC Radar: ${fresh} new signal${fresh > 1 ? "s" : ""}`, { body: j.alerts.slice(0, 3).map((a) => `${a.sym} ${a.type}`).join("\n") });
    }
    return j;
  } catch (e) {
    lastScan = { error: e.message };
    renderIntraday();
  }
}

export function renderBell() {
  const bell = $("alertBell");
  if (!bell) return;
  const seen = loadSeen();
  const count = Object.values(seen.seen).filter((ts) => ts > (seen.lastView || 0)).length;
  $("alertCount").textContent = count > 9 ? "9+" : count || "";
  bell.classList.toggle("has", count > 0);
}

export function renderIntraday() {
  const box = $("intradayPanel");
  if (!box) return;
  if (!lastScan) {
    box.innerHTML = `<div class="chart-head"><h2>⚡ Intraday Radar</h2><button class="btn small" id="radarScan">Scan now</button></div><p class="hint">Scanning all instruments for live signals…</p>`;
    wireScanBtn();
    return;
  }
  if (lastScan.error) {
    box.innerHTML = `<div class="chart-head"><h2>⚡ Intraday Radar</h2><button class="btn small" id="radarScan">Retry</button></div><div class="notice">Scan unavailable: ${lastScan.error}</div>`;
    wireScanBtn();
    return;
  }
  const cat = store.cat || "stock";
  const catLabel = CATEGORY_LABELS[cat] || cat;
  const alerts = (lastScan.alerts || []).filter((a) => a.cat === cat);
  const totalAlerts = (lastScan.alerts || []).length;
  const bulls = alerts.filter((a) => a.dir === "bullish").length;
  const bears = alerts.filter((a) => a.dir === "bearish").length;
  const t = new Date(lastScan.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const shown = radarFilter === "all" ? alerts : alerts.filter((a) => a.dir === radarFilter);
  const stars = (n) => "★".repeat(n) + '<span class="dim">★</span>'.repeat(3 - n);
  const fmtP = (v) => (v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));

  box.innerHTML = `
    <div class="radar-hero">
      <div class="radar-stats">
        <div class="radar-stat up"><span class="n">${bulls}</span><span class="l">bullish</span></div>
        <div class="radar-stat down"><span class="n">${bears}</span><span class="l">bearish</span></div>
        <div class="radar-stat"><span class="n">${lastScan.scanned}</span><span class="l">scanned</span></div>
      </div>
      <div class="radar-toolbar">
        <button class="rfilter ${radarFilter === "all" ? "active" : ""}" data-f="all">All ${alerts.length}</button>
        <button class="rfilter up ${radarFilter === "bullish" ? "active" : ""}" data-f="bullish">▲ Bullish ${bulls}</button>
        <button class="rfilter down ${radarFilter === "bearish" ? "active" : ""}" data-f="bearish">▼ Bearish ${bears}</button>
        <span class="chip neutral">📌 ${catLabel}</span>
        <button class="btn small" id="radarScan">↻ Scan now</button>
      </div>
    </div>
    <div class="radar-sub">${t} · showing <b>${alerts.length}</b> ${catLabel.toLowerCase()} signal${alerts.length === 1 ? "" : "s"} of ${totalAlerts} total · switch category tabs above to change · hourly auto-scan · strength-sorted</div>
    ${shown.length ? `<div class="radar-grid">${shown.map((a) => `
      <div class="radar-card ${a.dir}">
        <div class="rc-top">
          <div class="rc-dir ${a.dir}">${a.dir === "bullish" ? "▲" : a.dir === "bearish" ? "▼" : "•"}</div>
          <div class="rc-id">
            <div class="rc-sym">${a.sym}</div>
            <div class="rc-type">${a.type}</div>
          </div>
          <div class="rc-price">${fmtP(a.price)}</div>
        </div>
        <div class="rc-detail">${a.detail}</div>
        <div class="rc-plan"><span class="k">PLAN</span>${a.action}</div>
        <div class="rc-foot">
          <span class="rc-stars" title="signal strength">${stars(a.strength || 1)}</span>
          <button class="btn small primary radar-exec" data-sym="${a.sym}" data-side="${a.dir === "bearish" ? "sell" : "buy"}" data-src="Radar: ${a.type} ${a.sym}">⚡ Execute</button>
        </div>
      </div>`).join("")}</div>`
    : `<div class="empty">No ${radarFilter === "all" ? "active" : radarFilter} signals right now — the universe is quiet. Next automatic scan within the hour.</div>`}
    <p class="hint">Paper trading only — not advice. Signals recompute on every scan.</p>`;
  wireScanBtn();
  box.querySelectorAll(".rfilter").forEach((b) => {
    b.onclick = () => { radarFilter = b.dataset.f; renderIntraday(); };
  });
  box.querySelectorAll(".radar-exec").forEach((b) => {
    b.onclick = () => import("./portfolio.js").then(({ openTradeModal }) =>
      openTradeModal(b.dataset.sym, { side: b.dataset.side, orderType: "market", source: b.dataset.src }));
  });
}

function wireScanBtn() {
  const b = $("radarScan");
  if (b) b.onclick = async () => {
    b.disabled = true;
    b.textContent = "Scanning…";
    await scanMarket({ silent: false });
  };
}

export function initAlerts() {
  const bell = $("alertBell");
  if (bell) {
    bell.onclick = () => {
      const seen = loadSeen();
      seen.lastView = Date.now();
      saveSeen(seen);
      renderBell();
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      window.dispatchEvent(new CustomEvent("show-simulator"));
      document.getElementById("intradayPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
  }
  scanMarket();
  setInterval(() => scanMarket({ silent: false }), HOUR);
  window.addEventListener("cat-changed", renderIntraday);
  renderBell();
  renderIntraday();
}
