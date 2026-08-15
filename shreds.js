// Universal shreds: per-chain raw telemetry (BTC mempool, EVM block flow, Solana).
// The panel appears only for instruments whose chain has a free feed.

import { store } from "./store.js";

const $ = (id) => document.getElementById(id);
let data = null, timer = null, currentSym = null;

const SUPPORTED = new Set(["BTC-USD", "BTC=F", "ETH-USD", "ETH=F", "AVAX-USD", "ARB-USD", "OP-USD", "SOL-USD", "BONK-USD", "WIF-USD"]);
const THEME = {
  BTC: { color: "#f7931a", name: "Bitcoin" },
  EVM: { color: "#627eea", name: "EVM" },
  SOL: { color: "#14f195", name: "Solana" },
};

const short = (a) => (a && a.length > 10 ? a.slice(0, 4) + "…" + a.slice(-4) : a || "—");
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");

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
  return `
  <div class="flow-map">
    <div class="fm-head">
      <h3>🔀 Where the money is flowing</h3>
      <span class="muted" style="font-size:10px">${d.chain} · animated live feed</span>
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
  if (!data) {
    box.innerHTML = head("Scanning raw chain data…");
    return;
  }
  if (data.error) {
    box.innerHTML = head(`Feed unavailable: ${data.error}`, true);
    wire();
    return;
  }
  const th = THEME[data.chain] || THEME.SOL;
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
      <div class="gauge-head"><h3 style="color:${gCol}">${g.label.toUpperCase()}</h3><span class="muted" style="font-size:11px">${g.kind === "bias" ? "flow direction" : g.kind === "gas" ? "gas window" : "network pressure"}</span></div>
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
        <h3>🐋 Top on-chain flows <span class="muted" style="font-size:10.5px;font-weight:500">live-priced</span></h3>
        ${data.flows?.length ? `<div class="flow-list">
          ${data.flows.map((w) => {
            const tier = w.usd >= 50000 ? "whale" : w.usd >= 10000 ? "big" : "std";
            return `<a class="flow-row ${tier}" href="${w.link}" target="_blank" rel="noopener">
              <span class="flow-token ${w.sym === "USDC" ? "usdc" : w.sym === "USDT" ? "usdt" : w.sym?.includes("BTC") ? "btc" : w.sym?.includes("ETH") ? "eth" : w.sym?.includes("SOL") ? "sol" : "sol"}">${w.sym}</span>
              <span class="flow-amts"><b>${w.amt.toLocaleString("en-US", { maximumFractionDigits: 1 })}</b><i>${usd(w.usd)}</i></span>
              <span class="flow-addr muted">${short(w.from)} <span class="flow-arrow">→</span> ${short(w.to)}</span>
              <span class="flow-link">explorer ↗</span>
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
        ${data.chain === "SOL" && data.providers?.length ? `<h3 style="margin-top:14px">🔌 Providers</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${data.providers.map((p) => `<span class="prov-chip ${p.ok ? "ok" : "bad"}">${p.ok ? "●" : "○"} ${p.host} ${p.ms}ms</span>`).join("")}</div>` : ""}
      </div>
    </div>

    ${data.insight ? `<div class="shred-insight">
      <h3>🧠 What the shreds say</h3>
      <p>${data.insight.text}</p>
      ${data.insight.chips?.length ? `<div class="shred-chips">${data.insight.chips.map((c) => `<span class="chip ${c.cls}">${c.label}</span>`).join("")}</div>` : ""}
    </div>` : ""}

    ${data.cards?.length ? `<div class="noob-cards">
      <h3>🧭 Beginner mode — what this means for you</h3>
      <div class="nc-grid">
        ${data.cards.map((c) => `
          <div class="nc-card ${c.cls}">
            <div class="nc-head"><span class="nc-icon">${c.icon}</span><b>${c.title}</b></div>
            <p>${c.text}</p>
            ${c.trade && c.side ? `<button class="btn small primary nc-exec" data-sym="${c.trade}" data-side="${c.side}" data-src="Shreds ${chainName}: ${c.title}">⚡ ${c.side === "buy" ? "Buy" : "Sell"} ${c.trade.split("-")[0]} at market</button>` : ""}
          </div>`).join("")}
      </div>
    </div>` : ""}

    <p class="hint">${data.chain === "BTC" ? "Data: mempool.space (open-source) — real Bitcoin mempool, pre-confirmation." : data.chain === "EVM" ? "Data: public RPC block flow — latest block decoded live." : "Data: public Solana RPCs — multi-slot block telemetry."} Free & keyless. Educational research, not advice.</p>`;

  box.querySelectorAll(".nc-exec").forEach((b) => {
    b.onclick = () => import("./portfolio.js").then(({ openTradeModal }) =>
      openTradeModal(b.dataset.sym, { side: b.dataset.side, orderType: "market", source: b.dataset.src }));
  });
  const rb = $("shredsRefresh");
  if (rb) rb.onclick = () => loadShreds(currentSym);
}

function head(sub, retry, th) {
  const color = th?.color || "#fbbf24";
  return `<div class="chart-head">
    <h2 style="color:${color}">⚡ ${th?.name || "Crypto"} Shreds — ${sub}</h2>
    <div class="legend"><button class="btn small" id="shredsRefresh">${retry ? "↻ Retry" : "↻"}</button></div>
  </div>`;
}

// providers (Solana)
const PKEY = "tbc_shred_providers";
const getProviders = () => { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch { return []; } };

export function initShreds() {
  const box = $("shredsPanel");
  if (!box) return;
  const update = () => {
    const sym = store.symbol || "";
    const show = SUPPORTED.has(sym);
    box.style.display = show ? "block" : "none";
    if (show) {
      loadShreds(sym);
      if (!timer) timer = setInterval(() => { if (box.style.display !== "none" && SUPPORTED.has(currentSym)) loadShreds(currentSym); }, 15000);
    }
  };
  window.addEventListener("cat-changed", update);
  window.addEventListener("candles-loaded", update);
  update();
}
