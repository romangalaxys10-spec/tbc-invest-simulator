// Crypto shreds panel — raw on-chain telemetry, visible only under the Crypto tab.

import { store } from "./store.js";
import { CATALOG } from "./instruments.js";

const $ = (id) => document.getElementById(id);
let data = null, timer = null;

const short = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const fmtAmt = (w) => (w.kind === "SOL" ? `◎${w.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${w.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

async function loadShreds() {
  try {
    const r = await fetch("/api/shreds");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    data = j;
  } catch (e) {
    data = { error: e.message };
  }
  render();
}

function render() {
  const box = $("shredsPanel");
  if (!box) return;
  if (!data) {
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
  box.innerHTML = `
    <div class="chart-head">
      <h2>⚡ Crypto Shreds — raw on-chain telemetry</h2>
      <div class="legend">
        <span class="chip neutral">slots ${data.slotsRange ? data.slotsRange[0] + "–" + data.slotsRange[1] : data.slot}</span>
        <span class="chip neutral">SOL $${data.solPrice?.toFixed(2) ?? "—"}</span>
        <span class="muted" style="font-size:11px">refreshed ${t}</span>
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

function wire() {
  const b = $("shredsRefresh");
  if (b) b.onclick = () => loadShreds();
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
