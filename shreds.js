// Universal shreds: per-chain raw telemetry (BTC mempool, EVM block flow, Solana).
// The panel appears only for instruments whose chain has a free feed.

import { store } from "./store.js";
import { CATALOG } from "./instruments.js";

const $ = (id) => document.getElementById(id);
let data = null, timer = null, currentSym = null;
const TICKS_KEY = (chain) => "tbc_shred_ticks_" + chain;

function pushTick(d) {
  if (!d?.tick) return;
  try {
    const k = TICKS_KEY(d.chain);
    const arr = JSON.parse(localStorage.getItem(k) || "[]");
    arr.push({ t: Date.now(), g: d.tick.gauge, a: d.tick.a, b: d.tick.b });
    localStorage.setItem(k, JSON.stringify(arr.slice(-24)));
  } catch {}
}

function liveFlowHtml(d) {
  const tk = d.tick;
  if (!tk) return "";
  pushTick(d);
  let ticks = [];
  try { ticks = JSON.parse(localStorage.getItem(TICKS_KEY(d.chain)) || "[]"); } catch {}
  const total = tk.a + tk.b || 1;
  const aPct = Math.max(4, Math.min(96, Math.round((tk.a / total) * 100)));
  const bPct = 100 - aPct;
  const fmt = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "k" : String(Math.round(v)));
  const candles = [];
  for (let i = 1; i < ticks.length; i++) {
    const o = ticks[i - 1].g, c = ticks[i].g;
    const intensity = Math.min(8, ((ticks[i].a + ticks[i].b) / (total || 1)) * 4);
    candles.push({ o, c, hi: Math.max(o, c) + intensity, lo: Math.min(o, c) - intensity, last: i === ticks.length - 1 });
  }
  const gLo = Math.min(...candles.map((x) => x.lo), tk.gauge - 5);
  const gHi = Math.max(...candles.map((x) => x.hi), tk.gauge + 5);
  const n = Math.max(candles.length, 1);
  const W = 640, H = 60, step = (W - 40) / Math.max(n, 12);
  const bw = Math.max(4, Math.min(14, step - 3));
  const x = (i) => 20 + i * step + bw / 2;
  const y = (v) => 6 + (1 - (v - gLo) / (gHi - gLo || 1)) * (H - 12);
  const candleSvg = candles.map((cd, i) => {
    const col = cd.c >= cd.o ? "#34d399" : "#f87171";
    const top = y(Math.max(cd.o, cd.c)), bot = y(Math.min(cd.o, cd.c));
    return `<g class="${cd.last ? "candle-new" : ""}"><line x1="${x(i)}" x2="${x(i)}" y1="${y(cd.hi)}" y2="${y(cd.lo)}" stroke="${col}" stroke-width="1"/><rect x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(2, bot - top)}" fill="${col}" rx="1"/></g>`;
  }).join("");
  const legend = d.chain === "SOL" ? "buy flow rising" : d.chain === "EVM" ? "gas easing / activity up" : d.chain === "PM" ? "odds / probability rising" : "pressure easing";
  const titleText = d.chain === "PM" ? "🫀 Live Probability & Volume Pulse" : "🫀 Live pulse";
  const subtitleText = d.chain === "PM" ? "— odds & volume split, refreshed every 15s" : "— buy vs sell pressure, refreshed every 15s";
  const aText = d.chain === "PM" ? `${tk.aLabel.split(" ")[0].toUpperCase()} ${aPct}%` : `BUY ${aPct}%`;
  const bText = d.chain === "PM" ? `${tk.bLabel.split(" ")[0].toUpperCase()} ${bPct}%` : `SELL ${bPct}%`;
  return `
  <div class="live-flow">
    <div class="lf-title">${titleText} <span class="muted">${subtitleText}</span></div>
    <div class="lf-body">
      <div class="cans">
        <div class="can-wrap buy-side">
          <div class="can buy"><div class="can-liquid" style="height:${aPct}%"></div></div>
          <b class="pos">${aPct}%</b><span class="muted">${fmt(tk.a)} ${tk.aLabel}</span>
        </div>
        <div class="can-wrap sell-side">
          <div class="can sell"><div class="can-liquid" style="height:${bPct}%"></div></div>
          <b class="neg">${bPct}%</b><span class="muted">${fmt(tk.b)} ${tk.bLabel}</span>
        </div>
      </div>
      <div class="lf-mid">
        <span class="pos">${aText}</span>
        <div class="split-bar"><div class="split-buy" style="width:${aPct}%"></div><div class="split-sell" style="width:${bPct}%"></div></div>
        <span class="neg">${bText}</span>
        <span class="muted lf-hint">ratio ${tk.a && tk.b ? (tk.a / tk.b).toFixed(2) : "—"} : 1 · green = ${legend}</span>
      </div>
      <div class="candles">
        <svg viewBox="0 0 640 60" style="width:100%;height:auto">${candleSvg}</svg>
        <span class="muted" style="font-size:9.5px">flow candles · ${candles.length} tick${candles.length === 1 ? "" : "s"} (15s each)</span>
      </div>
    </div>
  </div>`;
}

const SHRED_CRYPTO = new Set(["BTC-USD", "BTC=F", "ETH-USD", "ETH=F", "AVAX-USD", "ARB-USD", "OP-USD", "SOL-USD", "BONK-USD", "WIF-USD"]);
const SUPPORTED = new Set([...SHRED_CRYPTO, ...CATALOG.filter((i) => ["stock", "etf", "index", "polymarket"].includes(i.cat)).map((i) => i.sym)]);
const THEME = {
  BTC: { color: "#f7931a", name: "Bitcoin" },
  EVM: { color: "#627eea", name: "EVM" },
  SOL: { color: "#14f195", name: "Solana" },
  EQ: { color: "#4da3ff", name: "Equity" },
  PM: { color: "#9333ea", name: "Polymarket" },
};

const short = (a) => (a && a.length > 10 ? a.slice(0, 4) + "…" + a.slice(-4) : a || "—");
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");

const PKEY = "tbc_shred_providers";
const getProviders = () => { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch { return []; } };
const setProviders = (list) => localStorage.setItem(PKEY, JSON.stringify(list));

async function loadShreds(sym) {
  if (sym !== currentSym) { data = null; currentSym = sym; render(); }
  try {
    const r = await fetch("/api/shreds?symbol=" + encodeURIComponent(sym), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, providers: getProviders() }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    data = j;
  } catch (e) {
    data = { error: e.message };
  }
  render();
}

function gaugeColor(kind, value) {
  if (kind === "bias") return value >= 55 ? "#34d399" : value <= 45 ? "#f87171" : "#fbbf24";
  return value >= 60 ? "#34d399" : value >= 35 ? "#fbbf24" : "#f87171"; // higher = calmer/cheaper
}


function flowMapHtml(d, th) {
  const fm = d.flowMap;
  if (!fm) return "";
  const color = th?.color || "#fbbf24";
  const wL = 4 + (fm.left.weight ?? 0.5) * 10;
  const wR = 4 + (fm.right.weight ?? 0.5) * 10;
  const nL = Math.max(1, Math.round((fm.left.weight ?? 0.5) * 4));
  const nR = Math.max(1, Math.round((fm.right.weight ?? 0.5) * 4));
  const parts = (n, col, dur) => Array.from({ length: n }, (_, i) =>
    `<circle r="3.4" fill="${col}"><animateMotion dur="${dur}s" begin="${(i * dur) / n}s" repeatCount="indefinite" path="M115,52 C160,30 220,30 275,52"/></circle>` +
    `<circle r="3.4" fill="${col}"><animateMotion dur="${dur}s" begin="${(i * dur) / n}s" repeatCount="indefinite" path="M365,52 C420,74 480,74 525,52"/></circle>`
  ).join("");
  const pL = "#34d399";
  const chainSub = d.chain === "PM" ? "Polymarket CLOB" : d.chain === "EQ" ? "SEC EDGAR & Options Flow" : `${d.chain} · animated live feed`;
  return `
  <div class="flow-map">
    <div class="fm-head">
      <h3>🔀 Where the money is flowing</h3>
      <span class="muted" style="font-size:10px">${chainSub}</span>
    </div>
    <svg viewBox="0 0 640 115" style="width:100%;height:auto">
      <defs>
        <linearGradient id="pipeL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${color}" stop-opacity=".9"/><stop offset="1" stop-color="#8b5cf6" stop-opacity=".9"/></linearGradient>
        <linearGradient id="pipeR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".9"/><stop offset="1" stop-color="#34d399" stop-opacity=".9"/></linearGradient>
        <filter id="fmglow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <path d="M115,52 C160,30 220,30 275,52" fill="none" stroke="url(#pipeL)" stroke-width="${wL}" stroke-linecap="round" opacity=".55"/>
      <path d="M365,52 C420,74 480,74 525,52" fill="none" stroke="url(#pipeR)" stroke-width="${wR}" stroke-linecap="round" opacity=".55"/>
      <g filter="url(#fmglow)">${parts(nL, color, 1.6)}${parts(nR, pL, 1.6)}</g>
      <circle cx="90" cy="52" r="36" fill="${color}1a" stroke="${color}" stroke-width="2.5"/>
      <text x="90" y="48" text-anchor="middle" font-size="10.5" font-weight="800" fill="${color}">${fm.left.label}</text>
      <text x="90" y="64" text-anchor="middle" font-size="10" fill="#9d94b8" font-family="ui-monospace">${fm.left.value}</text>
      <rect x="272" y="24" width="96" height="56" rx="16" fill="rgba(139,92,246,.15)" stroke="#8b5cf6" stroke-width="2.5" filter="url(#fmglow)"/>
      <text x="320" y="47" text-anchor="middle" font-size="10" font-weight="800" fill="#c4b5fd">${fm.hub.label}</text>
      <text x="320" y="63" text-anchor="middle" font-size="10" fill="#9d94b8" font-family="ui-monospace">${fm.hub.value}</text>
      <circle cx="550" cy="52" r="36" fill="rgba(52,211,153,.10)" stroke="#34d399" stroke-width="2.5"/>
      <text x="550" y="48" text-anchor="middle" font-size="10.5" font-weight="800" fill="#34d399">${fm.right.label}</text>
      <text x="550" y="64" text-anchor="middle" font-size="10" fill="#9d94b8" font-family="ui-monospace">${fm.right.value}</text>
    </svg>
  </div>`;
}

function render() {
  const box = $("shredsPanel");
  if (!box) return;
  const sym = currentSym || store.symbol;
  const isPM = sym?.startsWith("PM:") || store.cat === "polymarket";
  const defTheme = isPM ? THEME.PM : (store.cat === "stock" || store.cat === "etf" || store.cat === "index" ? THEME.EQ : THEME.SOL);
  if (!data) {
    box.innerHTML = head("Scanning raw telemetry & odds…", false, defTheme);
    return;
  }
  if (data.error) {
    box.innerHTML = head(`Feed unavailable: ${data.error}`, true, defTheme);
    const rb = $("shredsRefresh");
    if (rb) rb.onclick = () => loadShreds(currentSym);
    return;
  }
  const th = THEME[data.chain] || (isPM ? THEME.PM : THEME.SOL);
  const chainName = data.chainName || th.name;
  const g = data.gauge || { value: 50, label: "—", low: "", high: "", kind: "bias" };
  const gCol = gaugeColor(g.kind, g.value);
  const gx = 20 + (600 * g.value) / 100;
  const maxAct = Math.max(1, ...(data.activity || []).map((a) => a.count));
  const t = new Date(data.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  box.innerHTML = `
    ${head(`${chainName} · live`, false, th)}
    <div class="shred-stats">
      ${data.stats.map((s) => `<div class="shred-stat ${s.warn ? "warn" : ""}" style="${th.color ? `--th:${th.color}` : ""}"><span class="n">${s.value}</span><span class="l">${s.label}</span></div>`).join("")}
    </div>

    ${flowMapHtml(data, th)}

    <div class="gauge-card">
      <div class="gauge-head"><h3 style="color:${gCol}">${g.label.toUpperCase()}</h3><span class="muted" style="font-size:11px">${g.kind === "bias" ? (data.chain === "PM" ? "odds & probability distribution" : "flow direction") : g.kind === "gas" ? "gas window" : "network pressure"}</span></div>
      <svg viewBox="0 0 640 46" style="width:100%;height:auto">
        <defs><linearGradient id="ggrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f87171"/><stop offset=".5" stop-color="#fbbf24"/><stop offset="1" stop-color="#34d399"/></linearGradient></defs>
        <line x1="20" y1="22" x2="620" y2="22" stroke="url(#ggrad)" stroke-width="12" stroke-linecap="round" opacity=".3"/>
        <line x1="20" y1="22" x2="${gx}" y2="22" stroke="${gCol}" stroke-width="12" stroke-linecap="round"/>
        <circle cx="${gx}" cy="22" r="10" fill="#fff" stroke="${gCol}" stroke-width="4" style="filter:drop-shadow(0 0 6px ${gCol})"/>
        <text x="20" y="43" font-size="10" fill="#f87171" font-weight="700">${(g.low || "").toUpperCase()}</text>
        <text x="620" y="43" text-anchor="end" font-size="10" fill="#34d399" font-weight="700">${(g.high || "").toUpperCase()}</text>
      </svg>
    </div>

    <div class="shred-cols">
      <div>
        <h3>${data.chain === "PM" ? "🔮 Real-Time Orderbook & Probability Flows" : "🐋 Top on-chain flows"} <span class="muted" style="font-size:10.5px;font-weight:500">live-priced</span></h3>
        ${data.flows?.length ? `<div class="flow-list">
          ${data.flows.map((w) => {
            const tier = w.usd >= 50000 ? "whale" : w.usd >= 10000 ? "big" : "std";
            const tokCls = w.sym === "USDC" ? "usdc" : w.sym === "USDT" ? "usdt" : w.sym?.includes("BTC") ? "btc" : w.sym?.includes("ETH") ? "eth" : w.sym === "YES" ? "yes" : w.sym === "NO" ? "no" : data.chain === "PM" ? "pm" : "sol";
            return `<a class="flow-row ${tier}" href="${w.link || '#'}" target="_blank" rel="noopener">
              <span class="flow-token ${tokCls}">${w.sym}</span>
              <span class="flow-amts"><b>${w.amt.toLocaleString("en-US", { maximumFractionDigits: 1 })}</b><i>${usd(w.usd)}</i></span>
              <span class="flow-addr muted">${short(w.from)} <span class="flow-arrow">→</span> ${short(w.to)}</span>
              <span class="flow-link">${data.chain === "PM" ? "market ↗" : "explorer ↗"}</span>
            </a>`;
          }).join("")}
        </div>` : `<div class="empty">No whale-sized prints in the scanned window.</div>`}
      </div>
      <div>
        <h3>🔀 ${data.activityLabel || "activity"}</h3>
        <div class="shred-programs">
          ${(data.activity || []).map((p) => `
            <div class="sp-row">
              <span class="sp-name">${p.name}</span>
              <div class="sp-bar"><div style="width:${(p.count / maxAct) * 100}%"></div></div>
              <span class="sp-count">${p.count}</span>
            </div>`).join("")}
        </div>
        ${data.providers?.length ? `<h3 style="margin-top:14px">🔌 Providers & Feeds</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${data.providers.map((p) => `<span class="prov-chip ${p.ok ? "ok" : "bad"}">${p.ok ? "●" : "○"} ${p.host} ${p.ms}ms</span>`).join("")}</div>` : ""}
      </div>
    </div>

    ${liveFlowHtml(data)}

    ${data.insight ? `<div class="shred-insight">
      <h3>🧠 What the shreds say</h3>
      <p>${data.insight.text}</p>
      ${data.insight.chips?.length ? `<div class="shred-chips">${data.insight.chips.map((c) => `<span class="chip ${c.cls}">${c.label}</span>`).join("")}</div>` : ""}
    </div>` : ""}

    ${data.cards?.length ? `<div class="noob-cards">
      <h3>🧭 ${data.chain === "PM" ? "Prediction Desk & Signals" : "Beginner mode — what this means for you"}</h3>
      <div class="nc-grid">
        ${data.cards.map((c) => `
          <div class="nc-card ${c.cls}">
            <div class="nc-head"><span class="nc-icon">${c.icon}</span><b>${c.title}</b></div>
            <p>${c.text}</p>
            ${c.trade && c.side ? `<button class="btn small primary nc-exec" data-sym="${c.trade}" data-side="${c.side}" data-src="Shreds ${chainName}: ${c.title}">⚡ Trade ${data.chain === "PM" ? (c.side === "buy" ? "YES / Long" : "NO / Short") : `${c.side === "buy" ? "Buy" : "Sell"} ${c.trade.split("-")[0]}`} at market</button>` : ""}
          </div>`).join("")}
      </div>
    </div>` : ""}

    <p class="hint">${data.chain === "BTC" ? "Data: mempool.space (open-source) — real Bitcoin mempool, pre-confirmation." : data.chain === "EVM" ? "Data: public RPC block flow — latest block decoded live." : data.chain === "EQ" ? "Data: SEC EDGAR insider Form 4s & options flow — decoded live." : data.chain === "PM" ? "Data: Polymarket Gamma API & CLOB Orderbooks — real-time probability pricing, 24h volume & odds decoded live." : "Data: public Solana RPCs — multi-slot block telemetry."} Free & keyless. Educational research, not advice.</p>`;

  box.querySelectorAll(".nc-exec").forEach((b) => {
    b.onclick = () => import("./portfolio.js").then(({ openTradeModal }) =>
      openTradeModal(b.dataset.sym, { side: b.dataset.side, orderType: "market", source: b.dataset.src }));
  });
  const rb = $("shredsRefresh");
  if (rb) rb.onclick = () => loadShreds(currentSym);
  const cb = $("shredsConnect");
  if (cb) cb.onclick = openProviderModal;
}

function head(sub, retry, th) {
  const color = th?.color || "#fbbf24";
  const isSol = data?.chain === "SOL";
  const chainTitle = th?.name || (store.cat === "polymarket" ? "Polymarket" : "Crypto");
  return `<div class="chart-head">
    <h2 style="color:${color}">⚡ ${chainTitle} Shreds — ${sub}</h2>
    <div class="legend">
      ${isSol ? `<button class="btn small" id="shredsConnect" title="Connect external RPC/shred providers">＋ Provider</button>` : ""}
      <button class="btn small" id="shredsRefresh">${retry ? "↻ Retry" : "↻"}</button>
    </div>
  </div>`;
}

async function openProviderModal() {
  const overlay = document.getElementById("providerModal");
  const body = document.getElementById("providerBody");
  if (!overlay) return;
  overlay.style.display = "grid";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = "none"; };
  const draw = (test) => {
    const list = getProviders();
    body.innerHTML = `
      <h3>🔌 External shred providers (Solana)</h3>
      <div class="sub">Add your own Solana RPC / shred-bridge endpoints (Helius, QuickNode, dRPC, your node…). Up to 3, https only. They merge into the scan and show health chips.</div>
      <div class="prov-list">
        ${list.length ? list.map((p, i) => `<div class="prov-row"><span class="mono">${p.url}</span><button class="btn small danger" data-rm="${i}">✕</button></div>`).join("") : '<p class="hint">No external providers — using built-in free RPCs.</p>'}
      </div>
      <label>Provider URL (https://…)<input type="url" id="provUrl" placeholder="https://solana.drpc.org" /></label>
      <label>API key (optional — Bearer token)<input type="password" id="provKey" placeholder="leave empty for public endpoints" /></label>
      <div class="summary-box" id="provTest">${test || "Test before saving — checks slot height + latency."}</div>
      <div class="modal-actions">
        <button class="btn" id="provClose">Close</button>
        <button class="btn small" id="provTestBtn">Test</button>
        <button class="btn primary" id="provSave">Save provider</button>
      </div>`;
    body.querySelectorAll("[data-rm]").forEach((el) => el.onclick = () => { const l = getProviders(); l.splice(+el.dataset.rm, 1); setProviders(l); draw(); });
    document.getElementById("provClose").onclick = () => (overlay.style.display = "none");
    document.getElementById("provTestBtn").onclick = async () => {
      const url = document.getElementById("provUrl").value.trim();
      const key = document.getElementById("provKey").value.trim() || null;
      if (!url.startsWith("https://")) { document.getElementById("provTest").innerHTML = '<span class="neg">Must be an https:// URL</span>'; return; }
      document.getElementById("provTest").innerHTML = "Testing…";
      try {
        const r = await fetch("/api/shreds-sol?probe=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: "SOL-USD", providers: [{ url, key }] }) });
        const j = await r.json();
        const stat = (j.providers || []).find((p) => p.host === new URL(url).host);
        document.getElementById("provTest").innerHTML = stat
          ? (stat.ok ? `<span class="pos">✓ ${stat.host} responded in ${stat.ms}ms</span>` : `<span class="neg">✗ ${stat.host}: ${stat.err || "failed"}</span>`)
          : '<span class="neg">No response recorded</span>';
      } catch (e) { document.getElementById("provTest").innerHTML = `<span class="neg">${e.message}</span>`; }
    };
    document.getElementById("provSave").onclick = () => {
      const url = document.getElementById("provUrl").value.trim();
      const key = document.getElementById("provKey").value.trim() || null;
      if (!url.startsWith("https://")) return;
      const l = getProviders();
      if (l.length >= 3) { alert("Max 3 external providers"); return; }
      if (l.some((p) => p.url === url)) { alert("Already added"); return; }
      l.push({ url, key }); setProviders(l);
      overlay.style.display = "none";
      loadShreds("SOL-USD");
    };
  };
  draw();
}

export function initShreds() {
  const box = $("shredsPanel");
  if (!box) return;
  const isSupported = (sym) => SUPPORTED.has(sym) || sym?.startsWith("PM:") || store.cat === "polymarket";
  const update = () => {
    const sym = store.symbol || "";
    const show = isSupported(sym);
    box.style.display = show ? "block" : "none";
    if (show) {
      loadShreds(sym);
      if (!timer) timer = setInterval(() => { if (box.style.display !== "none" && isSupported(currentSym)) loadShreds(currentSym); }, 15000);
    }
  };
  const badge = document.getElementById("shredsBadge");
  const updateBadge = () => {
    if (!badge) return;
    badge.style.display = store.cat === "crypto" && !isSupported(store.symbol) ? "inline-flex" : "none";
  };
  if (badge) badge.onclick = () => {
    location.hash = "#sym=SOL-USD";
    setTimeout(() => document.getElementById("shredsPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 1600);
  };
  window.addEventListener("cat-changed", updateBadge);
  window.addEventListener("candles-loaded", updateBadge);
  updateBadge();
  window.addEventListener("cat-changed", update);
  window.addEventListener("candles-loaded", update);
  update();
}
