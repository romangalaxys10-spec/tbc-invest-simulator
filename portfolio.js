// Virtual portfolio: paper trades executed at live prices, stored in localStorage.
// Base currency: USD. GBP instruments converted at live FX (GBPUSD=X).

import { CATALOG } from "./instruments.js";

const $ = (id) => document.getElementById(id);
const KEY = "tbc_portfolio_v2";
const START_CASH = 100000;
const DAY = 86400000;

let pf = load();
const quoteCache = { data: {}, fx: {}, ts: 0 };
let cloudToken = localStorage.getItem("tbc_token") || "";
let lastSync = null;
let syncTimer = null;

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY));
    if (j && Array.isArray(j.positions) && Array.isArray(j.history)) return j;
  } catch {}
  return { cash: START_CASH, positions: [], history: [], startEquity: START_CASH };
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(pf));
  scheduleCloudPush();
}

// ---------- cloud sync ----------
function scheduleCloudPush() {
  if (!cloudToken) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushCloud, 1000);
}

async function pushCloud() {
  if (!cloudToken) return;
  try {
    const r = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: cloudToken, portfolio: pf }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    lastSync = Date.now();
  } catch (e) {
    lastSync = null;
    console.warn("cloud push failed:", e.message);
  }
  renderCloudPanel();
}

async function generateToken() {
  try {
    const r = await fetch("/api/token", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    cloudToken = j.token;
    localStorage.setItem("tbc_token", cloudToken);
    lastSync = null;
    await pushCloud();
  } catch (e) {
    alert(`Token generation failed: ${e.message}`);
  }
  renderCloudPanel();
  window.dispatchEvent(new CustomEvent("tbc-token-changed"));
}

async function linkToken(source) {
  const input = typeof source === "string" ? { value: source } : source || document.getElementById("tokenInput");
  const t = (input?.value || "").trim();
  const btn = document.getElementById("linkTokenBtn");
  if (!/^tbc_[A-Za-z0-9_-]{16,64}$/.test(t)) {
    alert("That doesn't look like a valid token (expected format: tbc_…).");
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "Linking…"; }
  try {
    const r = await fetch(`/api/portfolio?token=${encodeURIComponent(t)}`);
    const j = await r.json();
    if (r.ok) {
      pf = { cash: j.portfolio.cash, startEquity: j.portfolio.startEquity, positions: j.portfolio.positions, history: j.portfolio.history };
      localStorage.setItem(KEY, JSON.stringify(pf));
      lastSync = Date.now();
    }
    cloudToken = t;
    localStorage.setItem("tbc_token", t);
    await pushCloud();
    renderPortfolio();
  } catch (e) {
    alert(`Link failed: ${e.message}`);
  }
  renderCloudPanel();
  window.dispatchEvent(new CustomEvent("tbc-token-changed"));
}

function unlinkToken() {
  cloudToken = "";
  lastSync = null;
  localStorage.removeItem("tbc_token");
  renderCloudPanel();
  window.dispatchEvent(new CustomEvent("tbc-token-changed"));
}

function renderCloudPanel() {
  const panel = $("cloudPanel");
  if (!panel) return;
  if (cloudToken) {
    const short = `••••${cloudToken.slice(-4)}`;
    const synced = lastSync ? `saved ${new Date(lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "syncing…";
    panel.innerHTML = `
      <div class="cloud-row">
        <div class="cloud-info">
          <b>☁ Cloud sync active</b>
          <span class="muted">token <code>${short}</code> · ${synced} · every trade is saved to your private cloud slot</span>
        </div>
        <div class="cloud-actions">
          <button class="btn small" id="copyTokenBtn">Copy token</button>
          <button class="btn small danger" id="unlinkTokenBtn">Unlink</button>
        </div>
      </div>
      <p class="hint" style="margin:10px 2px 0">Keep this token private — it's the only key to your portfolio. Paste it on any device to continue with your trades.</p>`;
    $("copyTokenBtn").onclick = () => {
      navigator.clipboard?.writeText(cloudToken);
      $("copyTokenBtn").textContent = "Copied ✓";
      setTimeout(() => ($("copyTokenBtn").textContent = "Copy token"), 1500);
    };
    $("unlinkTokenBtn").onclick = unlinkToken;
  } else {
    panel.innerHTML = `
      <div class="cloud-row">
        <div class="cloud-info">
          <b>Multi-user cloud sync</b>
          <span class="muted">Generate a private token to keep your trades on any device — or paste an existing one</span>
        </div>
        <div class="cloud-actions">
          <input id="tokenInput" placeholder="tbc_…" spellcheck="false" autocomplete="off" />
          <button class="btn small" id="linkTokenBtn">Link</button>
          <button class="btn small primary" id="genTokenBtn">Generate my token</button>
        </div>
      </div>`;
    $("genTokenBtn").onclick = generateToken;
    $("linkTokenBtn").onclick = linkToken;
  }
}

// ---------- first-visit token offer (main page) ----------
export function initTokenBanner() {
  const banner = document.getElementById("tokenBanner");
  if (!banner) return;
  renderTokenBar(banner);
  window.addEventListener("tbc-token-changed", () => {
    if (banner.dataset.mode === "success") return;
    renderTokenBar(banner);
  });
}

function renderTokenBar(banner) {
  banner.style.display = "block";
  banner.dataset.mode = cloudToken ? "status" : "offer";

  if (cloudToken) {
    banner.innerHTML = `
      <div class="tb-row">
        <div class="tb-icon ok">☁</div>
        <div class="tb-text">
          <b>Token <code>••••${cloudToken.slice(-4)}</code> active</b>
          <span class="muted">Demo trades auto-save to your cloud slot${lastSync ? ` · last sync ${new Date(lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        </div>
        <div class="tb-actions">
          <button class="btn small" id="tbCopy">Copy</button>
          <button class="btn small primary" id="tbManage">Portfolio</button>
        </div>
      </div>`;
    document.getElementById("tbCopy").onclick = () => {
      navigator.clipboard?.writeText(cloudToken);
      const b = document.getElementById("tbCopy");
      b.textContent = "Copied ✓";
      setTimeout(() => (b.textContent = "Copy"), 1500);
    };
    document.getElementById("tbManage").onclick = () => window.dispatchEvent(new CustomEvent("show-portfolio"));
    return;
  }

  banner.innerHTML = `
    <div class="tb-row">
      <div class="tb-icon">🔐</div>
      <div class="tb-text">
        <b>Your demo-trade account — generate or load your token</b>
        <span>Free, private, no signup. A token saves your virtual portfolio to the cloud so you can monitor trades on any device.</span>
      </div>
      <div class="tb-actions">
        <input id="tbTokenInput" placeholder="Paste tbc_… token" spellcheck="false" autocomplete="off" />
        <button class="btn small" id="tbLink">Load</button>
        <button class="btn small primary" id="tbGenerate">⚡ Generate my token</button>
      </div>
    </div>`;

  document.getElementById("tbLink").onclick = async () => {
    const b = document.getElementById("tbLink");
    b.disabled = true;
    b.textContent = "Loading…";
    await linkToken(document.getElementById("tbTokenInput"));
    b.disabled = false;
    b.textContent = "Load";
  };
  document.getElementById("tbGenerate").onclick = async () => {
    const btn = document.getElementById("tbGenerate");
    btn.disabled = true;
    btn.textContent = "Generating…";
    await generateToken();
    banner.dataset.mode = "success";
    banner.innerHTML = `
      <div class="tb-row">
        <div class="tb-icon ok">☁</div>
        <div class="tb-text">
          <b>Your token is ready — trades now save automatically</b>
          <span class="tb-token"><code>${cloudToken}</code></span>
          <span class="muted">Copy and keep it private — it's the only key to your portfolio. Every trade you make is synced to it.</span>
        </div>
        <div class="tb-actions">
          <button class="btn small" id="tbCopy">Copy token</button>
          <button class="btn small primary" id="tbDone">Start trading</button>
        </div>
      </div>`;
    document.getElementById("tbCopy").onclick = () => {
      navigator.clipboard?.writeText(cloudToken);
      const b = document.getElementById("tbCopy");
      b.textContent = "Copied ✓";
      setTimeout(() => (b.textContent = "Copy token"), 1500);
    };
    document.getElementById("tbDone").onclick = () => renderTokenBar(banner);
  };
}

const money = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "muted");
const dstr = (ts) => new Date(ts).toISOString().slice(0, 10);

// ---------- live prices & FX ----------
async function fetchQuote(sym) {
  const r = await fetch(`/api/history?symbol=${encodeURIComponent(sym)}&period1=${Math.floor(Date.now() / 1000) - 10 * 86400}&period2=${Math.floor(Date.now() / 1000) + 86400}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return { symbol: j.symbol, name: j.name, currency: j.currency, price: j.price, previousClose: j.previousClose, cat: CATALOG.find((i) => i.sym === j.symbol)?.cat || "stock" };
}

async function getQuote(sym) {
  const c = quoteCache.data[sym];
  if (c && Date.now() - c.fetchedAt < 60000) return c;
  const q = { ...(await fetchQuote(sym)), fetchedAt: Date.now() };
  quoteCache.data[sym] = q;
  return q;
}

async function getFx(ccy) {
  if (ccy === "USD") return 1;
  const c = quoteCache.fx[ccy];
  if (c && Date.now() - c.ts < 300000) return c.rate;
  const j = await fetch(`/api/history?symbol=${ccy}USD=X&period1=${Math.floor(Date.now() / 1000) - 5 * 86400}&period2=${Math.floor(Date.now() / 1000) + 86400}`).then((r) => r.json());
  const rate = j.price;
  if (!rate) throw new Error(`FX ${ccy}USD unavailable`);
  quoteCache.fx[ccy] = { rate, ts: Date.now() };
  return rate;
}

// ---------- portfolio math ----------
async function positionView(p) {
  const q = await getQuote(p.sym);
  const fx = await getFx(p.ccy);
  const priceUSD = q.price * fx;
  const prevUSD = q.previousClose * fx;
  const value = p.units * priceUSD;
  const cost = p.units * p.avgCost;
  const dayPl = p.units * (priceUSD - prevUSD);
  return { ...p, price: q.price, priceUSD, value, cost, pl: value - cost, plPct: value / cost - 1, dayPl, dayPlPct: prevUSD ? priceUSD / prevUSD - 1 : 0 };
}

// ---------- public API ----------
export async function openTradeModal(sym) {
  const overlay = $("tradeModal");
  const body = $("tradeModalBody");
  overlay.style.display = "grid";
  body.innerHTML = `<p class="hint">Loading live price…</p>`;
  let q;
  try {
    q = await getQuote(sym);
  } catch (e) {
    body.innerHTML = `<div class="notice">Live price unavailable: ${e.message}</div>
      <div class="modal-actions"><button class="btn" onclick="document.getElementById('tradeModal').style.display='none'">Close</button></div>`;
    return;
  }
  const fx = await getFx(q.currency);
  const maxAmount = Math.floor(pf.cash);
  const syncRow = () => cloudToken
    ? `<div class="trade-sync ok">☁ Trades save to your token <code>••••${cloudToken.slice(-4)}</code></div>`
    : `<div class="trade-sync">🔐 No token linked — trades stay on this device only. <button type="button" class="btn small" id="modalGenToken">Generate my token</button></div>`;
  body.innerHTML = `
    <h3>Buy ${sym}</h3>
    <div class="sub">${q.name} · live ${money(q.price * fx)} (${q.price.toFixed(2)} ${q.currency}, FX ${fx.toFixed(3)})</div>
    <label>Amount (USD)
      <input type="number" id="tradeAmount" value="${Math.min(1000, maxAmount)}" min="1" max="${maxAmount}" step="any" />
    </label>
    <div class="summary-box" id="tradeSummary"></div>
    <div id="tradeSyncRow">${syncRow()}</div>
    <div class="modal-actions">
      <button class="btn" id="tradeCancel">Cancel</button>
      <button class="btn primary" id="tradeConfirm">Buy at market</button>
    </div>`;

  const amountEl = $("tradeAmount");
  const update = () => {
    const amt = Math.max(0, Number(amountEl.value) || 0);
    const units = amt / (q.price * fx);
    $("tradeSummary").innerHTML = amt > pf.cash
      ? `<span class="neg">Insufficient cash — available ${money(pf.cash)}</span>`
      : `You buy ≈ <b>${units.toFixed(4)}</b> units @ <b>${money(q.price * fx)}</b> → cost <b>${money(amt)}</b>. Cash after: <b>${money(pf.cash - amt)}</b>`;
    $("tradeConfirm").disabled = amt <= 0 || amt > pf.cash;
  };
  amountEl.addEventListener("input", update);
  update();

  $("tradeCancel").onclick = closeTradeModal;
  $("modalGenToken")?.addEventListener("click", async () => {
    $("modalGenToken").disabled = true;
    $("modalGenToken").textContent = "Generating…";
    await generateToken();
    $("tradeSyncRow").innerHTML = syncRow();
  });
  $("tradeConfirm").onclick = async () => {
    const amt = Number(amountEl.value) || 0;
    if (amt <= 0 || amt > pf.cash) return;
    const priceUSD = q.price * fx;
    const units = amt / priceUSD;
    buy(sym, q.name, q.currency, units, priceUSD);
    closeTradeModal();
    // Push to the user's cloud slot immediately, then show the fill
    clearTimeout(syncTimer);
    if (cloudToken) await pushCloud();
    body.innerHTML = `
      <h3>✓ Order filled</h3>
      <div class="sub">${units.toFixed(4)} × ${sym} @ ${money(priceUSD)}</div>
      <div class="summary-box">
        Cost <b>${money(amt)}</b> · Cash now <b>${money(pf.cash)}</b>
        ${cloudToken
          ? `<br/>☁ Saved to cloud token <code>••••${cloudToken.slice(-4)}</code> — paste it on any device to continue`
          : `<br/>📱 Saved on this device only — link a token in Portfolio to keep trades forever`}
      </div>
      <div class="modal-actions">
        <button class="btn" id="fillDone">Done</button>
        <button class="btn primary" id="fillView">View portfolio</button>
      </div>`;
    overlay.style.display = "grid";
    $("fillDone").onclick = closeTradeModal;
    $("fillView").onclick = () => {
      closeTradeModal();
      window.dispatchEvent(new CustomEvent("show-portfolio"));
    };
  };
}

export function closeTradeModal() {
  $("tradeModal").style.display = "none";
}

function buy(sym, name, ccy, units, priceUSD) {
  const cost = units * priceUSD;
  const existing = pf.positions.find((p) => p.sym === sym);
  if (existing) {
    const totalUnits = existing.units + units;
    existing.avgCost = (existing.units * existing.avgCost + cost) / totalUnits;
    existing.units = totalUnits;
  } else {
    pf.positions.push({ id: crypto.randomUUID?.() || String(Date.now()), sym, name, ccy, units, avgCost: priceUSD, openedAt: Date.now(), cat: CATALOG.find((i) => i.sym === sym)?.cat || "stock" });
  }
  pf.cash -= cost;
  pf.history.unshift({ ts: Date.now(), type: "buy", sym, units, priceUSD, amount: cost, ccy });
  pf.history = pf.history.slice(0, 100);
  save();
  renderPortfolio();
}

async function sellPosition(id, portion = 1) {
  const p = pf.positions.find((x) => x.id === id);
  if (!p) return;
  try {
    const q = await getQuote(p.sym);
    const fx = await getFx(p.ccy);
    const priceUSD = q.price * fx;
    const units = Math.min(p.units, p.units * portion);
    const proceeds = units * priceUSD;
    const realized = units * (priceUSD - p.avgCost);
    p.units -= units;
    pf.cash += proceeds;
    if (p.units < 1e-9) pf.positions = pf.positions.filter((x) => x.id !== id);
    pf.history.unshift({ ts: Date.now(), type: "sell", sym: p.sym, units, priceUSD, amount: proceeds, realized, ccy: p.ccy });
    pf.history = pf.history.slice(0, 100);
    save();
    renderPortfolio();
  } catch (e) {
    alert(`Sell failed: ${e.message}`);
  }
}

// ---------- rendering ----------
export async function renderPortfolio() {
  const summary = $("portfolioSummary");
  const badge = $("positionsBadge");
  badge.textContent = pf.positions.length || "";

  const views = await Promise.all(pf.positions.map(positionView).map((p) => p.catch(() => null)));
  const ok = views.filter(Boolean);
  const invested = ok.reduce((s, v) => s + v.value, 0);
  const equity = pf.cash + invested;
  const totalPl = equity - pf.startEquity;
  const unrealized = ok.reduce((s, v) => s + v.pl, 0);
  const dayPl = ok.reduce((s, v) => s + v.dayPl, 0);
  const realized = pf.history.filter((h) => h.type === "sell").reduce((s, h) => s + (h.realized || 0), 0);

  summary.innerHTML = `
    <div class="pos-card"><div class="k">Equity</div><div class="v">${money(equity)}</div><div class="s ${cls(totalPl)}">${pct(totalPl / pf.startEquity)} all-time</div></div>
    <div class="pos-card"><div class="k">Cash</div><div class="v">${money(pf.cash)}</div><div class="s muted">started with ${money(pf.startEquity)}</div></div>
    <div class="pos-card"><div class="k">Invested</div><div class="v">${money(invested)}</div><div class="s muted">${pf.positions.length} position${pf.positions.length === 1 ? "" : "s"}</div></div>
    <div class="pos-card"><div class="k">Unrealized P/L</div><div class="v ${cls(unrealized)}">${money(unrealized)}</div><div class="s ${cls(unrealized)}">open positions</div></div>
    <div class="pos-card"><div class="k">Today</div><div class="v ${cls(dayPl)}">${money(dayPl)}</div><div class="s ${cls(dayPl)}">vs previous close</div></div>
    <div class="pos-card"><div class="k">Realized P/L</div><div class="v ${cls(realized)}">${money(realized)}</div><div class="s muted">closed trades</div></div>`;

  const table = $("positionsTable");
  if (!pf.positions.length) {
    table.innerHTML = `<div class="empty">No open positions. Go to the Simulator, pick an instrument and click <b>Trade</b> to place your first virtual trade at the live price.</div>`;
  } else {
    table.innerHTML = `<table class="table">
      <tr><th>Instrument</th><th>Units</th><th>Avg cost</th><th>Live price</th><th>Value</th><th>P/L</th><th>Today</th><th></th></tr>
      ${pf.positions.map((p) => {
        const v = ok.find((x) => x.id === p.id);
        if (!v) return `<tr><td>${p.sym}</td><td colspan="7" class="muted">price unavailable</td></tr>`;
        return `<tr>
          <td><b>${p.sym}</b><br><span class="muted" style="font-family:Inter;font-size:11px">${p.name}</span></td>
          <td>${v.units.toFixed(4)}</td>
          <td>${money(v.avgCost)}</td>
          <td>${money(v.priceUSD)}<br><span class="muted" style="font-size:10.5px">${v.price.toFixed(2)} ${v.ccy}</span></td>
          <td>${money(v.value)}</td>
          <td class="${cls(v.pl)}">${money(v.pl)}<br><span style="font-size:11px">${pct(v.plPct)}</span></td>
          <td class="${cls(v.dayPl)}">${money(v.dayPl)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn small" data-sell50="${p.id}">Sell 50%</button>
            <button class="btn small danger" data-sell="${p.id}">Close</button>
          </td>
        </tr>`;
      }).join("")}
    </table>`;
    table.querySelectorAll("[data-sell]").forEach((b) => (b.onclick = () => sellPosition(b.dataset.sell, 1)));
    table.querySelectorAll("[data-sell50]").forEach((b) => (b.onclick = () => sellPosition(b.dataset.sell50, 0.5)));
  }

  const hist = $("historyTable");
  if (!pf.history.length) {
    hist.innerHTML = `<div class="empty">No trades yet.</div>`;
  } else {
    hist.innerHTML = `<table class="table">
      <tr><th>Date</th><th>Type</th><th>Instrument</th><th>Units</th><th>Price (USD)</th><th>Amount</th><th>Realized P/L</th></tr>
      ${pf.history.map((h) => `<tr>
        <td>${dstr(h.ts)}</td>
        <td>${h.type === "buy" ? '<span class="chip good">BUY</span>' : '<span class="chip bad">SELL</span>'}</td>
        <td><b>${h.sym}</b></td>
        <td>${h.units.toFixed(4)}</td>
        <td>${money(h.priceUSD)}</td>
        <td>${money(h.amount)}</td>
        <td>${h.type === "sell" ? `<span class="${cls(h.realized)}">${money(h.realized)}</span>` : "—"}</td>
      </tr>`).join("")}
    </table>`;
  }
  $("portfolioUpdatedAt").textContent = `updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function initPortfolio(switchToSimulator) {
  $("tradeModal").addEventListener("click", (e) => {
    if (e.target === $("tradeModal")) closeTradeModal();
  });
  $("portfolioRefresh").onclick = () => {
    quoteCache.data = {};
    quoteCache.fx = {};
    renderPortfolio();
  };
  $("portfolioReset").onclick = () => {
    if (!confirm("Reset the virtual account to $100,000 cash and delete all trades?")) return;
    pf = { cash: START_CASH, positions: [], history: [], startEquity: START_CASH };
    save();
    renderPortfolio();
  };
  renderCloudPanel();
  renderPortfolio();
  setInterval(() => { if ($("portfolioView").style.display !== "none") renderPortfolio(); }, 60000);
}
