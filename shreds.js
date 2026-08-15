// Crypto shreds panel — raw on-chain telemetry, visible only under the Crypto tab.

import { store } from "./store.js";
import { CATALOG } from "./instruments.js";

const $ = (id) => document.getElementById(id);
let data = null, timer = null;

const short = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const fmtAmt = (w) => (w.kind === "SOL" ? `◎${w.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${w.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

const PKEY = "tbc_shred_providers";
const getProviders = () => { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch { return []; } };
const setProviders = (list) => localStorage.setItem(PKEY, JSON.stringify(list));

async function loadShreds() {
  try {
    const r = await fetch("/api/shreds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: getProviders() }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    data = j;
  } catch (e) {
    data = { error: e.message };
  }
  render();
}


function flowMapHtml(d, usd) {
  const stable = d.volUsd.USDC + d.volUsd.USDT;
  const solSide = d.volUsd.wSOL;
  const maxV = Math.max(solSide, stable, 1);
  const wSol = 4 + (solSide / maxV) * 10;
  const wSt = 4 + (stable / maxV) * 10;
  const bias = d.buyBias;
  const bCol = bias >= 55 ? "#34d399" : bias <= 45 ? "#f87171" : "#fbbf24";
  const bx = 20 + (600 * bias) / 100;
  const secs = d.blocksScanned * 0.4;
  const vel = secs > 0 ? (solSide + stable) / secs : 0;
  const nSol = Math.min(4, Math.max(1, Math.round((solSide / maxV) * 4)));
  const nSt = Math.min(4, Math.max(1, Math.round((stable / maxV) * 4)));
  const parts = (n, color, dur) => Array.from({ length: n }, (_, i) =>
    `<circle r="3.4" fill="${color}"><animateMotion dur="${dur}s" begin="${(i * dur) / n}s" repeatCount="indefinite" path="M115,52 C160,30 220,30 275,52"/></circle>` +
    `<circle r="3.4" fill="${color}"><animateMotion dur="${dur}s" begin="${(i * dur) / n}s" repeatCount="indefinite" path="M365,52 C420,74 480,74 525,52"/></circle>`
  ).join("");
  return `
  <div class="flow-map">
    <div class="fm-head">
      <h3>🔀 Where the money is flowing</h3>
      <div class="fm-badges">
        <span class="chip neutral">⚡ ${usd(vel)}/sec velocity</span>
        <span class="chip good">USDC ${usd(d.volUsd.USDC)}</span>
        <span class="chip good">USDT ${usd(d.volUsd.USDT)}</span>
      </div>
    </div>
    <svg viewBox="0 0 640 180" style="width:100%;height:auto">
      <defs>
        <linearGradient id="pipeSol" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fbbf24" stop-opacity=".9"/><stop offset="1" stop-color="#8b5cf6" stop-opacity=".9"/></linearGradient>
        <linearGradient id="pipeSt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".9"/><stop offset="1" stop-color="#34d399" stop-opacity=".9"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <path d="M115,52 C160,30 220,30 275,52" fill="none" stroke="url(#pipeSol)" stroke-width="${wSol}" stroke-linecap="round" opacity=".55"/>
      <path d="M365,52 C420,74 480,74 525,52" fill="none" stroke="url(#pipeSt)" stroke-width="${wSt}" stroke-linecap="round" opacity=".55"/>
      <g filter="url(#glow)">${parts(nSol, "#fbbf24", 1.6)}${parts(nSt, "#34d399", 1.6)}</g>
      <circle cx="90" cy="52" r="36" fill="rgba(251,191,36,.10)" stroke="#fbbf24" stroke-width="2.5"/>
      <text x="90" y="48" text-anchor="middle" font-size="11.5" font-weight="800" fill="#fbbf24">SOL side</text>
      <text x="90" y="64" text-anchor="middle" font-size="10" fill="#9d94b8" font-family="ui-monospace">${usd(solSide)}</text>
      <rect x="272" y="24" width="96" height="56" rx="16" fill="rgba(139,92,246,.15)" stroke="#8b5cf6" stroke-width="2.5" filter="url(#glow)"/>
      <text x="320" y="47" text-anchor="middle" font-size="10.5" font-weight="800" fill="#c4b5fd">DEX ROUTER</text>
      <text x="320" y="63" text-anchor="middle" font-size="10" fill="#9d94b8" font-family="ui-monospace">${d.dexCalls} calls</text>
      <circle cx="550" cy="52" r="36" fill="rgba(52,211,153,.10)" stroke="#34d399" stroke-width="2.5"/>
      <text x="550" y="48" text-anchor="middle" font-size="11.5" font-weight="800" fill="#34d399">Stables</text>
      <text x="550" y="64" text-anchor="middle" font-size="10" fill="#9d94b8" font-family="ui-monospace">${usd(stable)}</text>
      <line x1="20" y1="140" x2="620" y2="140" stroke="#2a2140" stroke-width="10" stroke-linecap="round"/>
      <line x1="20" y1="140" x2="620" y2="140" stroke="url(#biasGrad)" stroke-width="10" stroke-linecap="round" opacity=".25"/>
      <line x1="20" y1="140" x2="${bx}" y2="140" stroke="${bCol}" stroke-width="10" stroke-linecap="round"/>
      <circle cx="${bx}" cy="140" r="9" fill="#fff" stroke="${bCol}" stroke-width="4" filter="url(#glow)"/>
      <text x="20" y="168" font-size="10" fill="#f87171" font-weight="700">SELL FLOW</text>
      <text x="320" y="168" text-anchor="middle" font-size="11.5" fill="${bCol}" font-weight="800">${d.biasLabel.toUpperCase()} · ${bias}%</text>
      <text x="620" y="168" text-anchor="end" font-size="10" fill="#34d399" font-weight="700">BUY FLOW</text>
    </svg>
  </div>`;
}

function noobCardsHtml(d, usd) {
  const cards = [];
  const stable = d.volUsd.USDC + d.volUsd.USDT;
  if (d.buyBias >= 58) {
    cards.push({ icon: "🟢", cls: "buy", title: "Flow leans BUY — beginners can dip in", text: `More stablecoins than SOL are hitting the DEXes (${usd(stable)} vs ${usd(d.volUsd.wSOL)}) — buyers are paying up. If you want exposure, a small DCA buy on SOL fits the flow. Keep it small.`, side: "buy" });
  } else if (d.buyBias <= 42) {
    cards.push({ icon: "🔴", cls: "sell", title: "Flow leans SELL — sit on your hands", text: `SOL is hitting the DEXes harder than stablecoins (${usd(d.volUsd.wSOL)} vs ${usd(stable)}) — sellers dominate. Beginners: wait, or take partial profit if you hold.`, side: "sell" });
  } else {
    cards.push({ icon: "🟡", cls: "mid", title: "Balanced flow — no edge from flow", text: "No strong direction right now. If you want exposure, DCA in small pieces rather than one big buy.", side: null });
  }
  if (d.failRate > 0.2) cards.push({ icon: "⚠️", cls: "warn", title: "Chain is congested", text: `${(d.failRate * 100).toFixed(0)}% of transactions are failing — market orders will slip. Use LIMIT orders (order ticket → Limit) instead.`, side: null });
  if (d.flows[0]?.usd >= 50000) cards.push({ icon: "🐋", cls: "warn", title: `Whale just moved ${usd(d.flows[0].usd)}`, text: "A whale-sized transfer just settled. Expect possible sharp moves — don't chase the green candle; set alerts near support.", side: null });
  return `
  <div class="noob-cards">
    <h3>🧭 Beginner mode — what this means for you</h3>
    <div class="nc-grid">
      ${cards.map((c) => `
        <div class="nc-card ${c.cls}">
          <div class="nc-head"><span class="nc-icon">${c.icon}</span><b>${c.title}</b></div>
          <p>${c.text}</p>
          ${c.side ? `<button class="btn small primary nc-exec" data-side="${c.side}" data-src="Shreds: ${d.biasLabel}">⚡ ${c.side === "buy" ? "Buy" : "Sell"} SOL at market</button>` : ""}
        </div>`).join("")}
    </div>
  </div>`;
}

function render() {
  const box = $("shredsPanel");
  if (!box) return;
  if (!data) {


  box.innerHTML = `<div class="chart-head"><h2>⚡ Crypto Shreds — raw on-chain telemetry</h2><button class="btn small" id="shredsRefresh">↻</button></div><p class="hint">Streaming raw Solana chain data…</p>`;
    wire();
    return;
  }
  if (data.error) {
    box.innerHTML = `<div class="chart-head"><h2>⚡ Crypto Shreds — raw on-chain telemetry</h2><button class="btn small" id="shredsRefresh">↻ Retry</button></div><div class="notice">Feed unavailable: ${data.error}</div>`;
    wire();
    return;
  }
  const maxCount = Math.max(1, ...data.programs.map((p) => p.count));
  const t = new Date(data.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const topProgram = data.programs[0] || { name: "—", count: 0 };
const dexShare = data.dexCalls ? Math.round((topProgram.count / data.dexCalls) * 100) : 0;
const biggest = data.flows[0];
const stableVol = data.volUsd.USDC + data.volUsd.USDT;
const chips = [];
if (data.failRate > 0.15) chips.push({ cls: "bad", label: `⚠ chain congestion (${(data.failRate * 100).toFixed(0)}% fail)` });
if (data.tps > 4000) chips.push({ cls: "warn", label: "🔥 network hot" });
if (dexShare >= 50 && topProgram.count > 20) chips.push({ cls: "good", label: `⚡ ${topProgram.name} dominates (${dexShare}%)` });
if (biggest && biggest.usd >= 50000) chips.push({ cls: "warn", label: `🐋 whale print ${usd(biggest.usd)}` });
if (stableVol >= 100000) chips.push({ cls: "good", label: "💵 stablecoins staging" });
if (!chips.length) chips.push({ cls: "neutral", label: "😴 calm window" });
const insight = `The chain is running at <b>${data.tps.toLocaleString()} TPS</b> with a <b>${(data.failRate * 100).toFixed(1)}%</b> failure rate${data.failRate > 0.15 ? " — that's congestion/bot spam, expect slower fills and slippage" : " — healthy"}. ${topProgram.name} leads DEX routing with <b>${topProgram.count}</b> of ${data.dexCalls} calls${dexShare >= 50 ? " — heavy aggregator flow often front-runs volatile moves on SOL & meme coins" : ""}. ${biggest ? `The largest print moved <b>${usd(biggest.usd)}</b> in ${biggest.sym}${biggest.usd >= 50000 ? " — whale-sized; watch the receiving wallet's next swap" : ""}. ` : ""}Stablecoin flow is ${stableVol >= 100000 ? `<b>${usd(stableVol)}</b> — big buy/sell orders may be staging` : `quiet (${usd(stableVol)}) — no obvious staged orders`}.`;
  box.innerHTML = `
    <div class="chart-head">
      <h2>⚡ Crypto Shreds — raw on-chain telemetry</h2>
      <div class="legend">
        <span class="chip neutral">slots ${data.slotsRange ? data.slotsRange[0] + "–" + data.slotsRange[1] : data.slot}</span>
        <span class="chip neutral">SOL $${data.solPrice?.toFixed(2) ?? "—"}</span>
        <span class="muted" style="font-size:11px">refreshed ${t}</span>
        ${(data.providers || []).map((p) => `<span class="prov-chip ${p.ok ? "ok" : "bad"}" title="${p.err || p.ms + "ms"}">${p.ok ? "●" : "○"} ${p.host} ${p.ms}ms</span>`).join("")}
        <button class="btn small" id="shredsConnect" title="Connect external shred/RPC provider">＋ Provider</button>
        <button class="btn small" id="shredsRefresh">↻</button>
      </div>
    </div>
    <div class="shred-stats">
      <div class="shred-stat"><span class="n">${data.tps.toLocaleString()}</span><span class="l">TPS</span></div>
      <div class="shred-stat"><span class="n">${data.slotMs}ms</span><span class="l">slot time</span></div>
      <div class="shred-stat"><span class="n">${data.totalTx.toLocaleString()}</span><span class="l">tx / ${data.blocksScanned} slots</span></div>
      <div class="shred-stat warn"><span class="n">${(data.failRate * 100).toFixed(1)}%</span><span class="l">fail rate</span></div>
      <div class="shred-stat"><span class="n">${data.dexCalls}</span><span class="l">DEX calls</span></div>
      <div class="shred-stat"><span class="n">${usd(data.volUsd.wSOL + data.volUsd.USDC + data.volUsd.USDT)}</span><span class="l">flow scanned</span></div>
    </div>
    ${flowMapHtml(data, usd)}
    ${noobCardsHtml(data, usd)}
    <div class="shred-cols">
      <div>
        <div class="shred-insight">
          <h3>🧠 What the shreds say</h3>
          <p>${insight}</p>
          <div class="shred-chips">${chips.map((c) => `<span class="chip ${c.cls}">${c.label}</span>`).join("")}</div>
        </div>
        <h3 style="margin-top:14px">🐋 Top on-chain flows <span class="muted" style="font-size:10.5px;font-weight:500">last ${data.blocksScanned} slots · live-priced</span></h3>
        ${data.flows.length ? `<div class="flow-list">
          ${data.flows.map((w) => {
            const tier = w.usd >= 50000 ? "whale" : w.usd >= 10000 ? "big" : "std";
            return `<a class="flow-row ${tier}" href="https://solscan.io/tx/${w.sig}" target="_blank" rel="noopener">
              <span class="flow-token ${w.sym === "USDC" ? "usdc" : w.sym === "USDT" ? "usdt" : "sol"}">${w.sym}</span>
              <span class="flow-amts"><b>${w.amt.toLocaleString("en-US", { maximumFractionDigits: 1 })}</b><i>${usd(w.usd)}</i></span>
              <span class="flow-addr muted">${short(w.from)} <span class="flow-arrow">→</span> ${short(w.to)}</span>
              <span class="flow-link">solscan ↗</span>
            </a>`;
          }).join("")}
        </div>` : `<div class="empty">No flows ≥$3k in the scanned slots — quiet window.</div>`}
        <p class="hint">Scanned volume: wSOL ${usd(data.volUsd.wSOL)} · USDC ${usd(data.volUsd.USDC)} · USDT ${usd(data.volUsd.USDT)} — top-level + inner instructions across ${data.totalTx.toLocaleString()} transactions.</p>
      </div>
      <div>
        <h3>🔀 DEX program flow</h3>
        <div class="shred-programs">
          ${data.programs.map((p) => `
            <div class="sp-row">
              <span class="sp-name">${p.name}</span>
              <div class="sp-bar"><div style="width:${(p.count / maxCount) * 100}%"></div></div>
              <span class="sp-count">${p.count}</span>
            </div>`).join("")}
        </div>
        <p class="hint">Signal logic: Jupiter/Pump spikes vs slot average often precede volatile SOL/BONK/WIF moves; high fail-rate = congested chain or bot spam; whale stablecoin prints hint at staged orders.</p>
      </div>
    </div>
    <p class="hint">Data: free public Solana RPC (8 confirmed blocks, top+inner instructions, live-priced via Yahoo). True sub-second shred streaming = Jito ShredStream gRPC (paid) — this is the free raw-RPC approximation. Educational research, not advice.</p>`;
  wire();
}

async function openProviderModal() {
  const overlay = document.getElementById("providerModal");
  const body = document.getElementById("providerBody");
  overlay.style.display = "grid";
  const renderModal = (test) => {
    const list = getProviders();
    body.innerHTML = `
      <h3>🔌 External shred providers</h3>
      <div class="sub">Add your own Solana RPC / shred-bridge endpoints (Helius, QuickNode, dRPC, your node, a Jito ShredStream proxy bridge…). Up to 3, https only. They merge into the scan and show health chips above.</div>
      <div class="prov-list">
        ${list.length ? list.map((p, i) => `
          <div class="prov-row"><span class="muted mono">🔗</span><span class="mono">${p.url}</span>
          <button class="btn small danger" data-rm="${i}">✕</button></div>`).join("")
        : '<p class="hint">No external providers — using built-in free RPCs.</p>'}
      </div>
      <label>Provider URL (https://…)
        <input type="url" id="provUrl" placeholder="https://solana.drpc.org" />
      </label>
      <label>API key (optional — sent as Bearer token)
        <input type="password" id="provKey" placeholder="leave empty for public endpoints" />
      </label>
      <div class="summary-box" id="provTest">${test || "Test before saving — checks slot height + latency."}</div>
      <div class="modal-actions">
        <button class="btn" id="provClose">Close</button>
        <button class="btn small" id="provTestBtn">Test</button>
        <button class="btn primary" id="provSave">Save provider</button>
      </div>`;
    body.querySelectorAll("[data-rm]").forEach((el) => el.onclick = () => {
      const l = getProviders(); l.splice(+el.dataset.rm, 1); setProviders(l); renderModal();
    });
    document.getElementById("provClose").onclick = () => (overlay.style.display = "none");
    document.getElementById("provTestBtn").onclick = async () => {
      const url = document.getElementById("provUrl").value.trim();
      const key = document.getElementById("provKey").value.trim() || null;
      if (!url.startsWith("https://")) { document.getElementById("provTest").innerHTML = '<span class="neg">Must be an https:// URL</span>'; return; }
      document.getElementById("provTest").innerHTML = "Testing…";
      try {
        const r = await fetch("/api/shreds?probe=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providers: [{ url, key }] }) });
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
      loadShreds();
    };
  };
  renderModal();
}

function wire() {
  const b = $("shredsRefresh");
  if (b) b.onclick = () => loadShreds();
  const cb = $("shredsConnect");
  if (cb) cb.onclick = openProviderModal;
}

export function initShreds() {
  const box = $("shredsPanel");
  if (!box) return;
  const update = () => {
    const isCrypto = store.cat === "crypto" || CATALOG.find((i) => i.sym === store.symbol)?.cat === "crypto";
    box.style.display = isCrypto ? "block" : "none";
    if (isCrypto) {
      loadShreds();
      if (!timer) timer = setInterval(() => { if (box.style.display !== "none") loadShreds(); }, 15000);
    }
  };
  window.addEventListener("cat-changed", update);
  window.addEventListener("candles-loaded", update);
  update();
}
