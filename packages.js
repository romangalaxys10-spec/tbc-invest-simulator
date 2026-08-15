// Investment packages view: balanced groups + live entry signals + one-click paper invest.

import { investPackage, getCash } from "./portfolio.js";
import { CATALOG } from "./instruments.js";

const $ = (id) => document.getElementById(id);
let cache = { ts: 0, data: null };
const money = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "muted");

const verdictChip = { "Entry now": "good", "DCA in": "warn", Wait: "bad" };

export async function loadPackages(force = false) {
  const grid = $("packagesGrid");
  if (!grid) return;
  if (!force && cache.data && Date.now() - cache.ts < 5 * 60 * 1000) {
    render(cache.data);
    return;
  }
  grid.innerHTML = `<p class="hint">Computing live entry signals for all packages…</p>`;
  try {
    const r = await fetch("/api/packages");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    cache = { ts: Date.now(), data: j };
    render(j);
  } catch (e) {
    grid.innerHTML = `<div class="notice">Packages unavailable: ${e.message}</div>`;
  }
}

function render(j) {
  const grid = $("packagesGrid");
  grid.innerHTML = j.packages.map((p) => {
    const corrTxt = p.avgCorr != null ? `${p.avgCorr.toFixed(2)}` : "—";
    const corrGood = p.avgCorr != null && p.avgCorr < 0.6;
    return `
    <div class="panel pkg-card" data-id="${p.id}">
      <div class="pkg-head">
        <div>
          <h3>${p.name}</h3>
          <span class="pkg-risk risk-${p.risk.startsWith("Low") ? "low" : p.risk.startsWith("High") ? "high" : "mid"}">${p.risk} risk</span>
        </div>
        <div class="pkg-score">
          <div class="pkg-score-num">${p.packageScore ?? "—"}</div>
          <div class="pkg-score-lbl">package score</div>
        </div>
      </div>
      <p class="pkg-thesis">${p.thesis}</p>
      <div class="pkg-balance">
        <span class="chip ${corrGood ? "good" : "warn"}">⚖ avg correlation ${corrTxt}</span>
        <span class="chip neutral">${p.entries} entry · ${p.dca} DCA · ${p.waits} wait</span>
      </div>
      <table class="table">
        <tr><th>Symbol</th><th>Weight</th><th>Price</th><th>Day</th><th>Signal</th></tr>
        ${p.components.map((c) => {
          const inst = CATALOG.find((i) => i.sym === c.sym);
          return `<tr>
            <td><b>${c.sym}</b><br><span class="muted" style="font-family:Inter;font-size:10.5px">${inst?.name || ""}</span></td>
            <td>${(c.w * 100).toFixed(0)}%</td>
            <td>${c.error ? "—" : `${c.price.toFixed(2)} ${inst?.ccy || "USD"}`}</td>
            <td class="${cls(c.change || 0)}">${c.error ? "—" : pct(c.change)}</td>
            <td>${c.error ? '<span class="chip neutral">n/a</span>' : `<span class="chip ${verdictChip[c.verdict]}">${c.verdict}</span><br><span class="muted" style="font-size:10px;font-family:Inter">${c.reasons}</span>`}</td>
          </tr>`;
        }).join("")}
      </table>
      <div class="pkg-invest">
        <label>Amount (USD) <input type="number" class="pkg-amt" value="1000" min="10" step="any" /></label>
        <button class="btn primary pkg-go" data-id="${p.id}">📦 Paper-invest package</button>
        <span class="muted" style="font-size:11px">cash available: <b class="pkg-cash">${money(getCash())}</b></span>
      </div>
      <div class="pkg-result" id="pkg-result-${p.id}"></div>
    </div>`;
  }).join("");

  grid.querySelectorAll(".pkg-go").forEach((btn) => {
    btn.onclick = async () => {
      const card = btn.closest(".pkg-card");
      const amt = Number(card.querySelector(".pkg-amt").value) || 0;
      const pkg = j.packages.find((p) => p.id === btn.dataset.id);
      const result = $("pkg-result-" + pkg.id);
      btn.disabled = true;
      btn.textContent = "Executing at live prices…";
      const res = await investPackage(pkg, amt);
      result.innerHTML = res.summary;
      result.style.display = "block";
      btn.disabled = false;
      btn.textContent = "📦 Paper-invest package";
      grid.querySelectorAll(".pkg-cash").forEach((el) => (el.textContent = money(getCash())));
    };
  });

  $("packagesRefresh").onclick = () => loadPackages(true);
}

export function initPackages() {
  // lazy-loaded on first view open via loadPackages()
}
