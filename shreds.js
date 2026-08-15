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
        <h3>🐋 Top flows (last ${data.blocksScanned} slots · live-priced)</h3>
        ${data.flows.length ? `<table class="table">
          <tr><th>Asset</th><th>Amount</th><th>≈ USD</th><th>From → To</th><th>Tx</th></tr>
          ${data.flows.map((w) => `<tr>
            <td><span class="chip ${w.sym === "SOL" || w.sym === "wSOL" ? "warn" : "good"}">${w.sym}</span></td>
            <td><b>${w.amt.toLocaleString("en-US", { maximumFractionDigits: 1 })}</b></td>
            <td><b>${usd(w.usd)}</b></td>
            <td class="muted" style="font-size:11px">${short(w.from)} → ${short(w.to)}</td>
            <td><a href="https://solscan.io/tx/${w.sig}" target="_blank" rel="noopener" style="color:var(--accent-2)">solscan ↗</a></td>
          </tr>`).join("")}
        </table>` : `<div class="empty">No flows ≥$3k in the scanned slots.</div>`}
        <p class="hint">Volumes scanned: wSOL ${usd(data.volUsd.wSOL)} · USDC ${usd(data.volUsd.USDC)} · USDT ${usd(data.volUsd.USDT)} — top-level + inner instructions, priced at live SOL.</p>
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
