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
  box.innerHTML = `
    <div class="chart-head">
      <h2>⚡ Crypto Shreds — raw on-chain telemetry</h2>
      <div class="legend"><span class="chip neutral">slot ${data.slot}</span><span class="muted" style="font-size:11px">live · ${t}</span><button class="btn small" id="shredsRefresh">↻</button></div>
    </div>
    <div class="shred-stats">
      <div class="shred-stat"><span class="n">${data.tps.toLocaleString()}</span><span class="l">TPS</span></div>
      <div class="shred-stat"><span class="n">${data.slotMs}ms</span><span class="l">slot time</span></div>
      <div class="shred-stat"><span class="n">${data.sampledTx.toLocaleString()}</span><span class="l">tx in slot</span></div>
      <div class="shred-stat"><span class="n">${data.programs[0]?.count ?? 0}</span><span class="l">${data.programs[0]?.name ?? "DEX"} calls</span></div>
    </div>
    <div class="shred-cols">
      <div>
        <h3>🐋 Whale transfers (this slot)</h3>
        ${data.whales.length ? `<table class="table">
          <tr><th>Asset</th><th>Amount</th><th>From → To</th><th>Tx</th></tr>
          ${data.whales.map((w) => `<tr>
            <td><span class="chip ${w.kind === "SOL" ? "warn" : "good"}">${w.kind}</span></td>
            <td><b>${fmtAmt(w)}</b></td>
            <td class="muted" style="font-size:11px">${short(w.from)} → ${short(w.to)}</td>
            <td><a href="https://solscan.io/tx/${w.sig}" target="_blank" rel="noopener" style="color:var(--accent-2)">view ↗</a></td>
          </tr>`).join("")}
        </table>` : `<div class="empty">No ≥500 SOL / ≥$100k stable transfers in this slot — whale prints are intermittent; the feed refreshes every 30s.</div>`}
      </div>
      <div>
        <h3>🔀 DEX program flow (this slot)</h3>
        <div class="shred-programs">
          ${data.programs.map((p) => `
            <div class="sp-row">
              <span class="sp-name">${p.name}</span>
              <div class="sp-bar"><div style="width:${(p.count / maxCount) * 100}%"></div></div>
              <span class="sp-count">${p.count}</span>
            </div>`).join("")}
        </div>
        <p class="hint">Signal logic: spikes in Jupiter/Pump.fun counts vs. slot average often precede volatile moves on SOL, BONK, WIF — whale stablecoin transfers hint at large limit buys/sells being staged.</p>
      </div>
    </div>
    <p class="hint">Data: free public Solana RPC (raw block telemetry, slot-fresh). True sub-second shred streaming requires Jito ShredStream gRPC (paid) — this is the free approximation. Educational research tool, not advice.</p>`;
  wire();
  box.querySelectorAll("a[href^='https://solscan.io']").forEach((a) => (a.target = "_blank"));
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
      if (!timer) timer = setInterval(() => { if (box.style.display !== "none") loadShreds(); }, 30000);
    }
  };
  window.addEventListener("cat-changed", update);
  window.addEventListener("candles-loaded", update);
  update();
}
