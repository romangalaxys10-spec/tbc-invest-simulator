// Intraday radar: hourly market scan, alert bell, and the intraday box.

const $ = (id) => document.getElementById(id);
const KEY_ALERTS = "tbc_alerts_v1";
const HOUR = 3600000;

let lastScan = null;

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
    box.innerHTML = `<div class="chart-head"><h2>⚡ Intraday Radar</h2><button class="btn small" id="radarScan">Scan now</button></div><p class="hint">Scanning all 33 instruments for live signals…</p>`;
    wireScanBtn();
    return;
  }
  if (lastScan.error) {
    box.innerHTML = `<div class="chart-head"><h2>⚡ Intraday Radar</h2><button class="btn small" id="radarScan">Retry</button></div><div class="notice">Scan unavailable: ${lastScan.error}</div>`;
    wireScanBtn();
    return;
  }
  const bulls = lastScan.alerts.filter((a) => a.dir === "bullish").length;
  const bears = lastScan.alerts.filter((a) => a.dir === "bearish").length;
  const t = new Date(lastScan.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  box.innerHTML = `
    <div class="chart-head">
      <h2>⚡ Intraday Radar — signals &amp; opportunities</h2>
      <div class="legend">
        <span class="chip good">${bulls} bullish</span>
        <span class="chip bad">${bears} bearish</span>
        <span class="muted" style="font-size:11px">scanned ${lastScan.scanned} instruments · ${t}</span>
        <button class="btn small" id="radarScan">↻ Scan now</button>
      </div>
    </div>
    ${lastScan.alerts.length ? `<div class="alert-list">${lastScan.alerts.map((a) => `
      <div class="alert-row ${a.dir}">
        <div class="alert-main">
          <b>${a.sym}</b> ${dirChip(a.dir)} <span class="chip neutral">${a.type}</span>
          <span class="muted" style="font-family:Inter;font-size:11.5px">${a.detail}</span>
        </div>
        <div class="alert-actions">
          <span class="muted" style="font-size:10.5px;max-width:280px;font-family:Inter">${a.action}</span>
          <button class="btn small primary radar-exec" data-sym="${a.sym}" data-side="${a.dir === "bearish" ? "sell" : "buy"}" data-src="Radar: ${a.type}">⚡</button>
        </div>
      </div>`).join("")}</div>`
    : `<div class="empty">No active signals right now — the whole universe is quiet. Next automatic scan within the hour.</div>`}
    <p class="hint">Automatic scan every hour · alerts deduplicated per hour · strength-sorted (pattern triggers &gt; crosses &gt; RSI). Paper trading only — not advice.</p>`;
  wireScanBtn();
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
  renderBell();
  renderIntraday();
}
