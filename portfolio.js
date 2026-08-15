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
    if (j && Array.isArray(j.positions) && Array.isArray(j.history)) return { orders: [], ...j, orders: j.orders || [] };
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

// ---------- Telegram Bot Notifications ----------
export async function notifyTelegram(text, category = "trades") {
  const tg = pf?.telegram;
  if (!tg || !tg.enabled || !tg.botToken || !tg.chatId) return;

  if (category === "trades" && tg.notifyTrades === false) return;
  if (category === "orders" && tg.notifyOrders === false) return;
  if (category === "exits" && tg.notifyExits === false) return;
  if (category === "radar" && !tg.notifyRadar) return;

  try {
    await fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botToken: tg.botToken,
        chatId: tg.chatId,
        message: text,
      }),
    });
  } catch (e) {
    console.warn("telegram alert failed:", e.message);
  }
}

export function openTelegramModal() {
  const overlay = document.getElementById("telegramModal");
  const body = document.getElementById("telegramBody");
  if (!overlay || !body) return;

  const tg = pf.telegram || {
    botToken: "",
    chatId: "",
    enabled: false,
    notifyTrades: true,
    notifyOrders: true,
    notifyExits: true,
    notifyRadar: true,
  };

  const shortToken = tg.botToken ? `${tg.botToken.slice(0, 6)}••••${tg.botToken.slice(-4)}` : "";
  const isConn = Boolean(tg.enabled && tg.botToken && tg.chatId);

  body.innerHTML = `
    <h3>✈ Telegram Bot Notifications</h3>
    <div class="sub">Attach your personal Telegram Bot to your account token (<code>${cloudToken ? `••••${cloudToken.slice(-4)}` : "local account"}</code>) for real-time alerts.</div>

    <div class="tg-status-card ${isConn ? "connected" : ""}">
      <div class="tg-status-info">
        <b>${isConn ? "✅ Connected & Active" : "⭕ Not Connected"}</b>
        <span class="muted">${isConn ? `Bot token <code>${shortToken}</code> · Chat ID <code>${tg.chatId}</code>` : "Configure your bot credentials below to receive trade alerts on Telegram."}</span>
      </div>
      ${isConn ? `<button class="btn small danger" id="tgDisconnectBtn">Disconnect</button>` : ""}
    </div>

    <div class="tg-field">
      <label>Telegram Bot Token <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="muted" style="font-weight:normal;font-size:11px">Get via @BotFather ↗</a></label>
      <input type="password" id="tgTokenInput" placeholder="123456789:ABCdefGhIJKlmNoPQRstuVWXyz..." value="${tg.botToken || ""}" autocomplete="off" spellcheck="false" />
    </div>

    <div class="tg-field">
      <label>Telegram Chat ID <a href="https://t.me/userinfobot" target="_blank" rel="noopener" class="muted" style="font-weight:normal;font-size:11px">Get via @userinfobot ↗</a></label>
      <input type="text" id="tgChatIdInput" placeholder="e.g. 123456789 or -100..." value="${tg.chatId || ""}" autocomplete="off" spellcheck="false" />
    </div>

    <div class="tg-guide">
      <b>Interactive Two-Way Commands:</b>
      <div class="muted" style="margin-top:4px; font-size:11.5px; line-height:1.4">
        Once connected, your bot responds directly inside Telegram:<br>
        • <code>/portfolio</code> or <code>/p</code> — Live equity, cash & open positions<br>
        • <code>/price &lt;SYM&gt;</code> or <code>/q &lt;SYM&gt;</code> — Live quote & 24h change (e.g. <code>/price AAPL</code>)<br>
        • <code>/radar</code> — Top 60-day breakouts & market signals<br>
        • <code>/shreds &lt;SYM&gt;</code> — Live buy/sell cans, DEX flow & whale prints<br>
        • <code>/help</code> — Full command reference & status
      </div>
    </div>

    <div class="tg-prefs">
      <div class="tg-pref-row">
        <label><input type="checkbox" id="tgPrefTrades" ${tg.notifyTrades !== false ? "checked" : ""}> ⚡ Executions & Market Fills</label>
        <span class="muted">Instant buy/sell prints</span>
      </div>
      <div class="tg-pref-row">
        <label><input type="checkbox" id="tgPrefExits" ${tg.notifyExits !== false ? "checked" : ""}> 🛑 Stop-Loss & 🎯 Take-Profit Exits</label>
        <span class="muted">Ladder & bracket hits</span>
      </div>
      <div class="tg-pref-row">
        <label><input type="checkbox" id="tgPrefOrders" ${tg.notifyOrders !== false ? "checked" : ""}> ⏳ Pending Orders Fired</label>
        <span class="muted">Limit, stop & auction</span>
      </div>
      <div class="tg-pref-row">
        <label><input type="checkbox" id="tgPrefRadar" ${tg.notifyRadar ? "checked" : ""}> 🚨 High-Strength Radar Signals (★★★)</label>
        <span class="muted">Hourly market breakouts</span>
      </div>
    </div>

    <div id="tgFeedback" style="display:none; font-size:12px; margin: 10px 0; padding: 8px 12px; border-radius:8px;"></div>

    <div class="modal-actions">
      <button class="btn" id="tgCloseBtn">Close</button>
      <button class="btn primary" id="tgSaveBtn">⚡ Test &amp; Save</button>
    </div>`;

  overlay.style.display = "grid";

  const close = () => { overlay.style.display = "none"; };
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  document.getElementById("tgCloseBtn").onclick = close;

  if (document.getElementById("tgDisconnectBtn")) {
    document.getElementById("tgDisconnectBtn").onclick = () => {
      if (!confirm("Disconnect your Telegram bot notifications from this token?")) return;
      pf.telegram = null;
      save();
      renderCloudPanel();
      close();
    };
  }

  document.getElementById("tgSaveBtn").onclick = async () => {
    const btn = document.getElementById("tgSaveBtn");
    const fb = document.getElementById("tgFeedback");
    const bToken = (document.getElementById("tgTokenInput").value || "").trim();
    const cId = (document.getElementById("tgChatIdInput").value || "").trim();

    if (!bToken || !cId) {
      fb.style.display = "block";
      fb.style.background = "rgba(248,113,113,.15)";
      fb.style.color = "var(--down)";
      fb.textContent = "Please enter both Bot Token and Chat ID.";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Testing connection…";
    fb.style.display = "none";

    try {
      const r = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botToken: bToken,
          chatId: cId,
          testOnly: true,
          token: cloudToken || null,
          webhookOrigin: window.location.origin,
        }),
      });

      const j = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error(j.error || `Telegram verification failed (${r.status})`);
      }

      pf.telegram = {
        botToken: bToken,
        chatId: cId,
        enabled: true,
        notifyTrades: document.getElementById("tgPrefTrades").checked,
        notifyOrders: document.getElementById("tgPrefOrders").checked,
        notifyExits: document.getElementById("tgPrefExits").checked,
        notifyRadar: document.getElementById("tgPrefRadar").checked,
        connectedAt: Date.now(),
      };

      save();
      renderCloudPanel();

      fb.style.display = "block";
      fb.style.background = "rgba(52,211,153,.15)";
      fb.style.color = "var(--up)";
      fb.textContent = "✓ Connected & two-way commands enabled! Check your Telegram.";

      setTimeout(() => { close(); }, 1200);
    } catch (err) {
      fb.style.display = "block";
      fb.style.background = "rgba(248,113,113,.15)";
      fb.style.color = "var(--down)";
      fb.textContent = `Error: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "⚡ Test & Save";
    }
  };
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
      pf = { cash: j.portfolio.cash, startEquity: j.portfolio.startEquity, positions: j.portfolio.positions, history: j.portfolio.history, orders: j.portfolio.orders || [], telegram: j.portfolio.telegram || null };
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
  const tgActive = Boolean(pf?.telegram?.enabled && pf?.telegram?.botToken && pf?.telegram?.chatId);
  const tgChip = `<button class="tg-btn-chip ${tgActive ? "active" : ""}" id="openTelegramBtn" title="Configure personal Telegram bot notifications">✈ Telegram Bot ${tgActive ? "✓ Active" : "＋ Connect"}</button>`;

  if (cloudToken) {
    const short = `••••${cloudToken.slice(-4)}`;
    const synced = lastSync ? `saved ${new Date(lastSync).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "syncing…";
    panel.innerHTML = `
      <div class="cloud-row">
        <div class="cloud-info">
          <b>☁ Cloud sync active</b>
          <span class="muted">token <code>${short}</code> · ${synced} · every trade &amp; Telegram bot config is saved to your private cloud slot</span>
        </div>
        <div class="cloud-actions">
          ${tgChip}
          <button class="btn small" id="copyTokenBtn">Copy token</button>
          <button class="btn small danger" id="unlinkTokenBtn">Unlink</button>
        </div>
      </div>
      <p class="hint" style="margin:10px 2px 0">Keep this token private — it's the only key to your portfolio and personal bot alerts. Paste it on any device to continue with your trades.</p>`;
    $("copyTokenBtn").onclick = () => {
      navigator.clipboard?.writeText(cloudToken);
      $("copyTokenBtn").textContent = "Copied ✓";
      setTimeout(() => ($("copyTokenBtn").textContent = "Copy token"), 1500);
    };
    $("unlinkTokenBtn").onclick = unlinkToken;
    $("openTelegramBtn").onclick = openTelegramModal;
  } else {
    panel.innerHTML = `
      <div class="cloud-row">
        <div class="cloud-info">
          <b>Multi-user cloud sync &amp; Telegram Bot</b>
          <span class="muted">Generate a private token to keep your trades &amp; attach your personal Telegram bot</span>
        </div>
        <div class="cloud-actions">
          ${tgChip}
          <input id="tokenInput" placeholder="tbc_…" spellcheck="false" autocomplete="off" />
          <button class="btn small" id="linkTokenBtn">Link</button>
          <button class="btn small primary" id="genTokenBtn">Generate my token</button>
        </div>
      </div>`;
    $("genTokenBtn").onclick = generateToken;
    $("linkTokenBtn").onclick = linkToken;
    $("openTelegramBtn").onclick = openTelegramModal;
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
const clamp01 = (v) => Math.max(0, Math.min(1, v));

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
  if (ccy === "USX" || ccy === "USs") return 0.01; // some futures quote in US cents
  const c = quoteCache.fx[ccy];
  if (c && Date.now() - c.ts < 300000) return c.rate;
  let rate;
  try {
    const j = await fetch(`/api/history?symbol=${ccy}USD=X&period1=${Math.floor(Date.now() / 1000) - 5 * 86400}&period2=${Math.floor(Date.now() / 1000) + 86400}`).then((r) => r.json());
    rate = j.price;
  } catch {
    rate = null;
  }
  if (!rate) {
    // some pairs only exist as USDXXX — invert
    try {
      const j = await fetch(`/api/history?symbol=USD${ccy}=X&period1=${Math.floor(Date.now() / 1000) - 5 * 86400}&period2=${Math.floor(Date.now() / 1000) + 86400}`).then((r) => r.json());
      rate = j.price ? 1 / j.price : null;
    } catch {
      rate = null;
    }
  }
  if (!rate) throw new Error(`FX rate for ${ccy} unavailable`);
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
  const fresh = Date.now() - (p.openedAt || 0) < 5 * 60 * 1000; // just filled
  return { ...p, fresh, price: q.price, priceUSD, value, cost, pl: value - cost, plPct: value / cost - 1, dayPl: fresh ? null : dayPl, dayPlPct: prevUSD ? priceUSD / prevUSD - 1 : 0 };
}

// ---------- public API ----------

function attachBracket(sym, slPx, tpPx, long, entryPx) {
  if (!slPx && !tpPx) return;
  const pos = pf.positions.find((p) => p.sym === sym && (long ? p.units > 0 : p.units < 0));
  if (!pos) return;
  pos.exits = pos.exits || [];
  const mk = (price, dir, label) => ({ id: crypto.randomUUID?.() || String(Math.random()), portion: 1, price, dir, filled: null, bracket: label });
  if (slPx) pos.exits.push(mk(slPx, long ? "below" : "above", "SL"));
  if (tpPx) pos.exits.push(mk(tpPx, long ? "above" : "below", "TP"));
  save();
}

export async function openTradeModal(sym, opts = {}) {
  // opts: { side, orderType, trigger, leverage, source, stopHint, targetHint }
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
  let fx, priceUSD;
  try {
    fx = await getFx(q.currency);
    priceUSD = q.price * fx;
    if (opts.orderType === "auto") {
      // smart selection: buy above market / sell below market = stop; otherwise limit
      const t = opts.trigger ?? priceUSD;
      opts.orderType = opts.side === "sell" ? (t <= priceUSD ? "stop" : "limit") : (t >= priceUSD ? "stop" : "limit");
    }
  } catch (e) {
    body.innerHTML = `<div class="notice">Live price unavailable: ${e.message}</div>
      <div class="modal-actions"><button class="btn" id="fxClose">Close</button></div>`;
    $("fxClose").onclick = closeTradeModal;
    return;
  }
  const S = {
    side: opts.side === "sell" ? "sell" : "buy",
    type: ["market", "limit", "stop", "auction"].includes(opts.orderType) ? opts.orderType : "market",
    trigger: opts.trigger ?? q.price,
    lev: [1, 2, 5].includes(opts.leverage) ? opts.leverage : 1,
    source: opts.source || "",
    stopHint: opts.stopHint ?? null,
    targetHint: opts.targetHint ?? null,
  };
  const heldUnits = pf.positions.find((p) => p.sym === sym)?.units ?? 0;
  const syncRow = () => cloudToken
    ? `<div class="trade-sync ok">☁ Orders save to your token <code>••••${cloudToken.slice(-4)}</code></div>`
    : `<div class="trade-sync">🔐 No token linked — orders stay on this device only. <button type="button" class="btn small" id="modalGenToken">Generate my token</button></div>`;

  const entryPx = priceUSD;
  const slHint = (S.side === "buy" ? entryPx * (1 - 1 / S.lev * 0.9) : entryPx * (1 + 1 / S.lev * 0.9)).toFixed(2);
  const tpHint = (S.side === "buy" ? entryPx * 1.15 : entryPx * 0.85).toFixed(2);
  body.innerHTML = `
    <h3>Order ticket — ${sym}</h3>
    <div class="sub">${q.name} · live ${money(priceUSD)} (${q.price.toFixed(2)} ${q.currency}, FX ${fx.toFixed(3)})${heldUnits ? ` · holding ${heldUnits.toFixed(4)} units` : ""}</div>
    ${S.source ? `<div class="signal-context">⚡ Executing: <b>${S.source}</b>${S.stopHint ? ` · stop ref ${money(S.stopHint)}` : ""}${S.targetHint ? ` · target ref ${money(S.targetHint)}` : ""}</div>` : ""}
    <div class="ticket-grid">
      <div class="seg" id="sideSeg">
        <button data-v="buy" class="${S.side === "buy" ? "active" : ""}">Buy / Long</button>
        <button data-v="sell" class="${S.side === "sell" ? "active sell" : ""}">Sell / Short</button>
      </div>
      <div class="seg" id="typeSeg">
        <button data-v="market" class="${S.type === "market" ? "active" : ""}">Market</button>
        <button data-v="limit" class="${S.type === "limit" ? "active" : ""}">Limit</button>
        <button data-v="stop" class="${S.type === "stop" ? "active" : ""}">Stop</button>
        <button data-v="auction" class="${S.type === "auction" ? "active" : ""}">Auction</button>
      </div>
      <label>Amount (USD ${S.side === "buy" ? "margin" : "exposure"})
        <input type="number" id="tradeAmount" value="1000" min="10" step="any" />
      </label>
      <label>Leverage
        <select id="tradeLev">
          <option value="1" ${S.lev === 1 ? "selected" : ""}>1× (spot)</option>
          <option value="2" ${S.lev === 2 ? "selected" : ""}>2× (futures)</option>
          <option value="5" ${S.lev === 5 ? "selected" : ""}>5× (futures)</option>
        </select>
      </label>
    </div>
    <label id="triggerWrap" style="display:${S.type === "market" ? "none" : "flex"}">Trigger price (USD)
      <input type="number" id="tradeTrigger" value="${S.trigger.toFixed(2)}" step="any" />
    </label>
    <div class="bracket-toggles">
      <label class="bracket-toggle">
        <input type="checkbox" id="toggleSL" ${S.stopHint ? "checked" : ""} />
        <span>🛑 Stop-loss</span>
      </label>
      <label class="bracket-toggle">
        <input type="checkbox" id="toggleTP" ${S.targetHint ? "checked" : ""} />
        <span>🎯 Take-profit</span>
      </label>
      <span class="field-hint" style="margin-left:auto;align-self:center">optional brackets</span>
    </div>
    <div class="bracket-row" id="bracketRow" style="display:${S.stopHint || S.targetHint ? "grid" : "none"}">
      <label id="wrapSL" style="display:${S.stopHint ? "flex" : "none"}">🛑 Stop-loss (USD) <span class="field-hint">caps downside</span>
        <input type="number" id="tradeSL" placeholder="${slHint}" value="${S.stopHint ? S.stopHint.toFixed(2) : ""}" step="any" />
      </label>
      <label id="wrapTP" style="display:${S.targetHint ? "flex" : "none"}">🎯 Take-profit (USD) <span class="field-hint">locks gain</span>
        <input type="number" id="tradeTP" placeholder="${tpHint}" value="${S.targetHint ? S.targetHint.toFixed(2) : ""}" step="any" />
      </label>
    </div>
    <div class="bracket-presets" id="bracketPresets" style="display:${S.stopHint || S.targetHint ? "flex" : "none"}">
      <span class="muted" style="font-size:10.5px">quick fill:</span>
      <button type="button" class="btn small" data-brk="5">±5%</button>
      <button type="button" class="btn small" data-brk="10">±10%</button>
      <button type="button" class="btn small" data-brk="20">±20%</button>
      <button type="button" class="btn small danger" data-brk="clear">clear</button>
    </div>
    <div class="summary-box" id="tradeSummary"></div>
    <div id="tradeSyncRow">${syncRow()}</div>
    <div class="modal-actions">
      <button class="btn" id="tradeCancel">Cancel</button>
      <button class="btn primary" id="tradeConfirm">${S.type === "market" ? "Execute now" : "Place order"}</button>
    </div>`;

  const amountEl = $("tradeAmount"), levEl = $("tradeLev"), trigEl = $("tradeTrigger"), trigWrap = $("triggerWrap");
  const slEl = $("tradeSL"), tpEl = $("tradeTP");
  const toggleSL = $("toggleSL"), toggleTP = $("toggleTP");
  const wrapSL = $("wrapSL"), wrapTP = $("wrapTP"), bracketRow = $("bracketRow"), bracketPresets = $("bracketPresets");
  const sideSeg = $("sideSeg"), typeSeg = $("typeSeg");

  sideSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.side = b.dataset.v;
    sideSeg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    update();
  });
  typeSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    S.type = b.dataset.v;
    typeSeg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    trigWrap.style.display = S.type === "market" ? "none" : "flex";
    $("tradeConfirm").textContent = S.type === "market" ? "Execute now" : "Place order";
    update();
  });
  [toggleSL, toggleTP].forEach((t) => t.addEventListener("change", () => {
    if (toggleSL.checked && !slEl.value) {
      const long = S.side === "buy";
      const px = S.type === "market" ? priceUSD : Number(trigEl.value) || priceUSD;
      slEl.value = (long ? px * 0.95 : px * 1.05).toFixed(2);
    }
    if (toggleTP.checked && !tpEl.value) {
      const long = S.side === "buy";
      const px = S.type === "market" ? priceUSD : Number(trigEl.value) || priceUSD;
      tpEl.value = (long ? px * 1.10 : px * 0.90).toFixed(2);
    }
    update();
  }));
  [amountEl, levEl, trigEl, slEl, tpEl].forEach((el) => el.addEventListener("input", update));
  body.querySelectorAll("[data-brk]").forEach((b) => {
    b.onclick = () => {
      const long = S.side === "buy";
      if (b.dataset.brk === "clear") {
        slEl.value = ""; tpEl.value = "";
        toggleSL.checked = false; toggleTP.checked = false;
      } else {
        if (!toggleSL.checked && !toggleTP.checked) {
          toggleSL.checked = true;
          toggleTP.checked = true;
        }
        const pct = Number(b.dataset.brk) / 100;
        const px = S.type === "market" ? priceUSD : Number(trigEl.value) || priceUSD;
        if (toggleSL.checked) slEl.value = (long ? px * (1 - pct) : px * (1 + pct)).toFixed(2);
        if (toggleTP.checked) tpEl.value = (long ? px * (1 + pct * 2) : px * (1 - pct * 2)).toFixed(2);
      }
      update();
    };
  });

  function update() {
    S.lev = Number(levEl.value) || 1;
    const useSL = toggleSL.checked;
    const useTP = toggleTP.checked;
    wrapSL.style.display = useSL ? "flex" : "none";
    wrapTP.style.display = useTP ? "flex" : "none";
    bracketRow.style.display = (useSL || useTP) ? "grid" : "none";
    bracketRow.style.gridTemplateColumns = (useSL && useTP) ? "1fr 1fr" : "1fr";
    bracketPresets.style.display = (useSL || useTP) ? "flex" : "none";

    S.sl = useSL ? (Number(slEl.value) || null) : null;
    S.tp = useTP ? (Number(tpEl.value) || null) : null;
    const amt = Math.max(0, Number(amountEl.value) || 0);
    const px = S.type === "market" ? priceUSD : Number(trigEl.value) || priceUSD;
    const units = S.side === "buy" ? (amt * S.lev) / px : amt / px;
    const liq = S.lev > 1
      ? (S.side === "buy" ? px * (1 - 1 / S.lev + 0.005) : px * (1 + 1 / S.lev - 0.005))
      : null;
    const parts = [`≈ <b>${units.toFixed(4)}</b> units @ <b>${money(px)}</b> · ${S.lev}× leverage`];
    if (liq) parts.push(`liquidation ≈ <b class="neg">${money(liq)}</b>`);
    if (S.type === "market") parts.push(`cash after: <b>${money(S.side === "buy" ? pf.cash - amt : pf.cash + amt)}</b>`);
    if (S.type === "auction") parts.push(`executes at the next hourly auction price`);
    if (S.type !== "market") parts.push(`order sits until trigger or cancel — auto-saved`);
    $("tradeSummary").innerHTML = `${amt > (S.side === "buy" ? pf.cash : Infinity) ? `<span class="neg">Insufficient cash — available ${money(pf.cash)}</span><br/>` : ""}${parts.join("<br/>")}`;
    let bracketErr = "";
    const long = S.side === "buy";
    if (S.sl && (long ? S.sl >= px : S.sl <= px)) bracketErr = `SL must be ${long ? "below" : "above"} ${money(px)}`;
    if (S.tp && (long ? S.tp <= px : S.tp >= px)) bracketErr = `TP must be ${long ? "above" : "below"} ${money(px)}`;
    const summary = $("tradeSummary");
    if (bracketErr) summary.innerHTML = `<span class="neg">${bracketErr}</span><br/>` + summary.innerHTML;
    $("tradeConfirm").disabled = amt <= 0 || (S.side === "buy" && amt > pf.cash) || !!bracketErr;
  }
  update();

  $("modalGenToken")?.addEventListener("click", async () => {
    $("modalGenToken").disabled = true;
    $("modalGenToken").textContent = "Generating…";
    await generateToken();
    $("tradeSyncRow").innerHTML = syncRow();
  });

  $("tradeCancel").onclick = closeTradeModal;
  $("tradeConfirm").onclick = async () => {
    const amt = Number(amountEl.value) || 0;
    if (amt <= 0) return;
    if (S.type === "market") {
      if (S.side === "buy" && amt > pf.cash) return;
      executeAtMarket(sym, q.name, q.currency, amt, priceUSD, S.side, S.lev, S.source);
      attachBracket(sym, S.sl, S.tp, S.side === "buy", priceUSD);
      const units = S.side === "buy" ? (amt * S.lev) / priceUSD : amt / priceUSD;
      notifyTelegram(
        `⚡ <b>TBC Trade Executed</b>\n\n` +
        `<b>Action:</b> ${S.side === "buy" ? "🟢 BUY / LONG" : "🔴 SELL / SHORT"}\n` +
        `<b>Instrument:</b> ${sym} (${q.name || sym})\n` +
        `<b>Fill Price:</b> ${money(priceUSD)}\n` +
        `<b>Units:</b> ${units.toFixed(4)}\n` +
        `<b>Amount:</b> ${money(amt)}${S.lev > 1 ? ` (${S.lev}× leverage)` : ""}\n` +
        (S.sl ? `<b>Stop-Loss:</b> ${money(S.sl)}\n` : "") +
        (S.tp ? `<b>Take-Profit:</b> ${money(S.tp)}\n` : "") +
        (S.source ? `<b>Source:</b> ${S.source}\n` : "") +
        `<b>Cash Remaining:</b> ${money(pf.cash)}`,
        "trades"
      );
      showFill(body, overlay, {
        sym, side: S.side, usd: amt, priceUSD, sl: S.sl, tp: S.tp,
        units,
        lev: S.lev, source: S.source,
        liq: S.lev > 1 ? (S.side === "buy" ? priceUSD * (1 - 1 / S.lev + 0.005) : priceUSD * (1 + 1 / S.lev - 0.005)) : null,
      });
    } else {
      pf.orders = pf.orders || [];
      pf.orders.push({
        id: crypto.randomUUID?.() || String(Date.now() + Math.random()),
        sym, name: q.name, ccy: q.currency, side: S.side, type: S.type,
        usd: amt, trigger: Number(trigEl.value) || priceUSD, lev: S.lev, sl: S.sl, tp: S.tp,
        source: S.source || null, created: Date.now(),
      });
      notifyTelegram(
        `⏳ <b>TBC Pending Order Placed</b>\n\n` +
        `<b>Type:</b> ${S.type.toUpperCase()}\n` +
        `<b>Side:</b> ${S.side === "buy" ? "BUY" : "SELL"}\n` +
        `<b>Instrument:</b> ${sym}\n` +
        `<b>Trigger:</b> ${money(Number(trigEl.value) || priceUSD)}\n` +
        `<b>Amount:</b> ${money(amt)}${S.lev > 1 ? ` (${S.lev}× leverage)` : ""}`,
        "orders"
      );
      save();
      renderPortfolio();
      showOrderPlaced(body, overlay, { sym, ...S });
    }
  };
}

function showFill(body, overlay, f) {
  clearTimeout(syncTimer);
  const finish = async () => { if (cloudToken) await pushCloud(); };
  finish();
  body.innerHTML = `
    <h3>✓ ${f.side === "buy" ? "Order filled" : "Order filled (sell)"}</h3>
    <div class="sub">${f.units.toFixed(4)} × ${f.sym} @ ${money(f.priceUSD)}${f.lev > 1 ? ` · ${f.lev}× leverage` : ""}</div>
    <div class="summary-box">
      ${f.side === "buy" ? "Margin/cost" : "Exposure"} <b>${money(f.usd)}</b> · Cash now <b>${money(pf.cash)}</b>
      ${f.liq ? `<br/>⚠ Liquidation price <b>${money(f.liq)}</b>` : ""}
      ${f.source ? `<br/>⚡ From signal: ${f.source}` : ""}
      ${f.sl ? `<br/>🛑 Stop-loss <b>${money(f.sl)}</b>` : ""}${f.tp ? ` · 🎯 Take-profit <b>${money(f.tp)}</b>` : ""}
      ${(f.sl || f.tp) ? `<br/><span class="muted" style="font-size:11px">Bracket attached — auto-executes like any exit level (🎯 on the position).</span>` : ""}
      <br/><span class="muted" style="font-size:11px">P/L since fill starts at $0.00 — the "Day move" column shows today's market move (incl. before your entry), not your profit.</span>
      <br/>${cloudToken ? `☁ Saved to token <code>••••${cloudToken.slice(-4)}</code>` : `📱 Saved locally — link a token to keep it forever`}
    </div>
    <div class="modal-actions">
      <button class="btn" id="fillDone">Done</button>
      <button class="btn primary" id="fillView">View portfolio</button>
    </div>`;
  overlay.style.display = "grid";
  $("fillDone").onclick = closeTradeModal;
  $("fillView").onclick = () => { closeTradeModal(); window.dispatchEvent(new CustomEvent("show-portfolio")); };
}

function showOrderPlaced(body, overlay, o) {
  body.innerHTML = `
    <h3>⏳ Order placed</h3>
    <div class="sub">${o.side === "buy" ? "Buy" : "Sell"} ${o.sym} · ${o.type} @ ${money(o.trigger)} · ${o.lev}×</div>
    <div class="summary-box">
      The order sits in your portfolio until its trigger fires (checked on every price refresh and each hourly scan),
      or until you cancel it. ${o.type === "auction" ? "Auction orders execute at the next hourly auction price." : ""}
      ${cloudToken ? `<br/>☁ Saved to token <code>••••${cloudToken.slice(-4)}</code>` : `<br/>📱 Saved locally — link a token to keep it forever`}
    </div>
    <div class="modal-actions">
      <button class="btn" id="fillDone">Done</button>
      <button class="btn primary" id="fillView">View orders</button>
    </div>`;
  overlay.style.display = "grid";
  $("fillDone").onclick = closeTradeModal;
  $("fillView").onclick = () => { closeTradeModal(); window.dispatchEvent(new CustomEvent("show-portfolio")); };
}

// ---------- execution engine: market / shorts / leverage ----------
function executeAtMarket(sym, name, ccy, usd, priceUSD, side, lev, source) {
  const id = crypto.randomUUID?.() || String(Date.now() + Math.random());
  if (side === "buy") {
    const units = (usd * lev) / priceUSD;
    const existing = pf.positions.find((p) => p.sym === sym);
    if (existing && existing.units > 0) {
      const totalUnits = existing.units + units;
      existing.avgCost = (existing.units * existing.avgCost + units * priceUSD) / totalUnits;
      existing.units = totalUnits;
      existing.lev = Math.max(existing.lev || 1, lev);
      existing.liquidation = lev > 1 ? priceUSD * (1 - 1 / lev + 0.005) : existing.liquidation;
    } else {
      pf.positions.push({ id, sym, name, ccy, units, avgCost: priceUSD, openedAt: Date.now(), cat: CATALOG.find((i) => i.sym === sym)?.cat || "stock", lev, liquidation: lev > 1 ? priceUSD * (1 - 1 / lev + 0.005) : null });
    }
    pf.cash -= usd;
    pf.history.unshift({ ts: Date.now(), type: "buy", sym, units, priceUSD, amount: usd, ccy, lev, source: source || null });
  } else {
    // SELL: close longs first, remainder opens/extends a short (proceeds credited)
    const pos = pf.positions.find((p) => p.sym === sym);
    const longUnits = pos && pos.units > 0 ? pos.units : 0;
    const sellUnits = usd / priceUSD;
    const closeUnits = Math.min(longUnits, sellUnits);
    if (closeUnits > 0 && pos) {
      pf.cash += closeUnits * priceUSD;
      const realized = closeUnits * (priceUSD - pos.avgCost);
      pf.history.unshift({ ts: Date.now(), type: "sell", sym, units: closeUnits, priceUSD, amount: closeUnits * priceUSD, realized, ccy, source: source || null });
      pos.units -= closeUnits;
      if (pos.units < 1e-9 && sellUnits - closeUnits < 1e-9) pf.positions = pf.positions.filter((p) => p.id !== pos.id);
    }
    const shortUnits = sellUnits - closeUnits;
    if (shortUnits > 1e-9) {
      const shortProceeds = shortUnits * priceUSD;
      pf.cash += shortProceeds;
      const existing = pf.positions.find((p) => p.sym === sym && p.units < 0);
      const liq = priceUSD * (1 + 1 / lev - 0.005);
      if (existing) {
        const tot = Math.abs(existing.units) + shortUnits;
        existing.avgCost = (Math.abs(existing.units) * existing.avgCost + shortUnits * priceUSD) / tot;
        existing.units -= shortUnits;
        existing.liquidation = liq;
      } else {
        pf.positions.push({ id: crypto.randomUUID?.() || id, sym, name, ccy, units: -shortUnits, avgCost: priceUSD, openedAt: Date.now(), cat: CATALOG.find((i) => i.sym === sym)?.cat || "stock", lev, liquidation: liq, short: true });
      }
      pf.history.unshift({ ts: Date.now(), type: "short", sym, units: -shortUnits, priceUSD, amount: shortProceeds, ccy, lev, source: source || null });
    }
  }
  pf.history = (pf.history || []).slice(0, 200);
  save();
  renderPortfolio();
}

// ---------- pending order processing + liquidations ----------
export async function processPendingOrders(auctionTick = false) {
  if (!pf.orders?.length) return;
  let changed = false;
  for (const o of [...pf.orders]) {
    let q;
    try { q = await getQuote(o.sym); } catch { continue; }
    const fx = await getFx(o.ccy).catch(() => 1);
    const priceUSD = q.price * fx;
    let fire = false;
    if (o.type === "auction") fire = auctionTick;
    else if (o.type === "limit") fire = o.side === "buy" ? priceUSD <= o.trigger : priceUSD >= o.trigger;
    else if (o.type === "stop") fire = o.side === "buy" ? priceUSD >= o.trigger : priceUSD <= o.trigger;
    if (!fire) continue;
    pf.orders = pf.orders.filter((x) => x.id !== o.id);
    executeAtMarket(o.sym, o.name, o.ccy, o.usd, priceUSD, o.side, o.lev, o.source || `order:${o.type}@${o.trigger}`);
    attachBracket(o.sym, o.sl, o.tp, o.side === "buy", priceUSD);
    notifyTelegram(
      `⏳ <b>TBC Pending Order Triggered & Filled</b>\n\n` +
      `<b>Order:</b> ${o.type.toUpperCase()} ${o.side === "buy" ? "BUY" : "SELL"}\n` +
      `<b>Instrument:</b> ${o.sym}\n` +
      `<b>Execution Price:</b> ${money(priceUSD)}\n` +
      `<b>Amount:</b> ${money(o.usd)}${o.lev > 1 ? ` (${o.lev}×)` : ""}`,
      "orders"
    );
    changed = true;
  }
  if (changed) { save(); renderPortfolio(); }
}

async function checkLiquidations(views) {
  for (const v of views) {
    const p = pf.positions.find((x) => x.id === v.id);
    if (!p || p.liquidation == null) continue;
    const crossed = p.units > 0 ? v.priceUSD <= p.liquidation : v.priceUSD >= p.liquidation;
    if (!crossed) continue;
    const units = Math.abs(p.units);
    if (p.units > 0) {
      pf.cash += units * p.liquidation;
      pf.history.unshift({ ts: Date.now(), type: "liquidation", sym: p.sym, units, priceUSD: p.liquidation, amount: units * p.liquidation, realized: units * (p.liquidation - p.avgCost), ccy: p.ccy, note: `Liquidated at ${p.liquidation.toFixed(2)} (${p.lev}×)` });
    } else {
      pf.cash -= units * p.liquidation;
      pf.history.unshift({ ts: Date.now(), type: "liquidation", sym: p.sym, units, priceUSD: p.liquidation, amount: units * p.liquidation, realized: units * (p.avgCost - p.liquidation), ccy: p.ccy, note: `Short liquidated at ${p.liquidation.toFixed(2)} (${p.lev}×)` });
    }
    notifyTelegram(
      `🚨 <b>TBC Position Liquidated</b>\n\n` +
      `<b>Instrument:</b> ${p.sym} (${p.units > 0 ? "LONG" : "SHORT"} ${p.lev}×)\n` +
      `<b>Liquidation Price:</b> ${money(p.liquidation)}\n` +
      `<b>Closed Units:</b> ${units.toFixed(4)}`,
      "exits"
    );
    pf.positions = pf.positions.filter((x) => x.id !== p.id);
  }
}

// ---------- exit ladders (take-profit / scaled exits) ----------
export function openExitsModal(posId) {
  const p = pf.positions.find((x) => x.id === posId);
  const overlay = document.getElementById("exitsModal");
  const body = document.getElementById("exitsBody");
  if (!p) return;
  overlay.style.display = "grid";
  const isShort = p.units < 0;
  const render = async () => {
    let live = p.avgCost;
    try { const q = await getQuote(p.sym); live = q.price * (await getFx(p.ccy)); } catch {}
    const exits = p.exits || [];
    const totalPct = exits.filter((e) => !e.filled).reduce((s, e) => s + e.portion, 0);
    body.innerHTML = `
      <h3>🎯 Exit plan — ${p.sym}</h3>
      <div class="sub">${isShort ? "Short" : "Long"} ${Math.abs(p.units).toFixed(4)} units @ avg ${money(p.avgCost)} · live ${money(live)}</div>
      <div class="exit-presets">
        <button class="btn small" data-preset="ladder">3-step TP ladder (+10/+20/+30%)</button>
        <button class="btn small" data-preset="half">Sell 50% at +15%, rest at +35%</button>
        <button class="btn small" data-preset="stop">Stop-loss at −10%</button>
      </div>
      <div id="exitRows">
        ${exits.length ? exits.map((e, i) => `
          <div class="exit-row ${e.filled ? "filled" : ""}">
            <input type="number" class="ex-portion" data-i="${i}" value="${Math.round(e.portion * 100)}" min="1" max="100" step="1" /> <span class="muted">%</span>
            <span class="muted">at</span>
            <input type="number" class="ex-price" data-i="${i}" value="${e.price.toFixed(2)}" step="any" />
            <span class="muted">${e.dir === "above" ? "▲" : "▼"} ${e.filled ? "✓ filled" + (e.filledAt ? " " + new Date(e.filledAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "") : ""}</span>
            <button class="btn small danger ex-del" data-i="${i}" ${e.filled ? "disabled" : ""}>✕</button>
          </div>`).join("") : `<p class="hint">No exit levels yet. Add ladder steps — e.g. sell 20% at +10%, 30% at +20%, 50% at +35%.</p>`}
      </div>
      <div class="exit-actions">
        <button class="btn small" id="exAdd">+ Add level</button>
        <span class="muted" style="font-size:11.5px" id="exTotal">${totalPct > 1.001 ? '<span class="neg">over 100%!</span>' : `${Math.round(totalPct * 100)}% of position allocated`}</span>
      </div>
      <div class="summary-box">
        Levels above live price trigger on the way <b>up</b> (${isShort ? "stop-loss for the short" : "take-profit"}); levels below trigger on the way <b>down</b> (${isShort ? "take-profit" : "stop-loss"}).
        Levels auto-execute on every price refresh &amp; hourly scan, then save to your token.
      </div>
      <div class="modal-actions">
        <button class="btn small danger" id="exClear">Clear all</button>
        <button class="btn" id="exCancel">Cancel</button>
        <button class="btn primary" id="exSave" ${totalPct > 1.001 ? "disabled" : ""}>Save plan</button>
      </div>`;

    body.querySelectorAll(".exit-presets [data-preset]").forEach((b) => {
      b.onclick = () => {
        const presets = {
          ladder: [[1 / 3, 1.10], [1 / 3, 1.20], [0.34, 1.30]],
          half: [[0.5, 1.15], [0.5, 1.35]],
          stop: [[1, 0.90]],
        };
        p.exits = presets[b.dataset.preset].map(([portion, mult]) => ({
          id: crypto.randomUUID?.() || String(Math.random()),
          portion, price: +(live * mult).toFixed(2),
          dir: mult >= 1 ? "above" : "below", filled: null,
        }));
        save();
        render();
      };
    });
    body.querySelectorAll(".ex-portion").forEach((el) => el.onchange = () => {
      const e = p.exits[+el.dataset.i]; if (e && !e.filled) e.portion = clamp01(Number(el.value) / 100 || 0);
      save(); render();
    });
    body.querySelectorAll(".ex-price").forEach((el) => el.onchange = () => {
      const e = p.exits[+el.dataset.i];
      if (e && !e.filled) {
        e.price = Number(el.value) || e.price;
        e.dir = e.price >= live ? "above" : "below";
      }
      save(); render();
    });
    body.querySelectorAll(".ex-del").forEach((el) => el.onclick = () => {
      p.exits.splice(+el.dataset.i, 1); save(); render();
    });
    body.querySelector("#exAdd").onclick = () => {
      p.exits = p.exits || [];
      p.exits.push({ id: crypto.randomUUID?.() || String(Math.random()), portion: 0.2, price: +(live * 1.1).toFixed(2), dir: "above", filled: null });
      save(); render();
    };
    body.querySelector("#exClear").onclick = () => { p.exits = []; save(); render(); };
    body.querySelector("#exCancel").onclick = () => (overlay.style.display = "none");
    body.querySelector("#exSave").onclick = () => { save(); overlay.style.display = "none"; renderPortfolio(); };
  };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = "none"; };
  render();
}

async function processExits(views) {
  for (const v of views) {
    const p = pf.positions.find((x) => x.id === v.id);
    if (!p?.exits?.length) continue;
    for (const lvl of p.exits) {
      if (lvl.filled || lvl.price == null) continue;
      const hit = lvl.dir === "above" ? v.priceUSD >= lvl.price : v.priceUSD <= lvl.price;
      if (!hit) continue;
      const pos = pf.positions.find((x) => x.id === p.id);
      if (!pos) break;
      const units = Math.abs(pos.units) * Math.min(1, lvl.portion);
      if (units < 1e-9) { lvl.filled = Date.now(); continue; }
      const px = lvl.price;
      if (pos.units > 0) {
        pf.cash += units * px;
        pos.units -= units;
        const realized = units * (px - pos.avgCost);
        pf.history.unshift({ ts: Date.now(), type: "exit", sym: pos.sym, units, priceUSD: px, amount: units * px, realized, ccy: pos.ccy, note: `Exit ${Math.round(lvl.portion * 100)}% @ ${px.toFixed(2)}` });
        notifyTelegram(
          `🎯 <b>TBC Exit Target Triggered</b>\n\n` +
          `<b>Instrument:</b> ${pos.sym} (LONG)\n` +
          `<b>Exit Price:</b> ${money(px)}\n` +
          `<b>Portion Closed:</b> ${Math.round(lvl.portion * 100)}% (${units.toFixed(4)} units)\n` +
          `<b>Realized P/L:</b> ${realized >= 0 ? "🟢 +" : "🔴 "}${money(realized)}`,
          "exits"
        );
      } else {
        pf.cash -= units * px;
        pos.units += units;
        const realized = units * (pos.avgCost - px);
        pf.history.unshift({ ts: Date.now(), type: "exit", sym: pos.sym, units, priceUSD: px, amount: units * px, realized, ccy: pos.ccy, note: `Exit ${Math.round(lvl.portion * 100)}% of short @ ${px.toFixed(2)}` });
        notifyTelegram(
          `🎯 <b>TBC Exit Target Triggered</b>\n\n` +
          `<b>Instrument:</b> ${pos.sym} (SHORT)\n` +
          `<b>Exit Price:</b> ${money(px)}\n` +
          `<b>Portion Closed:</b> ${Math.round(lvl.portion * 100)}% (${units.toFixed(4)} units)\n` +
          `<b>Realized P/L:</b> ${realized >= 0 ? "🟢 +" : "🔴 "}${money(realized)}`,
          "exits"
        );
      }
      lvl.filled = Date.now();
      if (Math.abs(pos.units) < 1e-6) pf.positions = pf.positions.filter((x) => x.id !== pos.id);
    }
  }
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

// ---------- package investing (multi-instrument buy at live prices) ----------
export function getCash() {
  return pf.cash;
}

export async function investPackage(pkg, totalUSD) {
  const results = [];
  if (totalUSD <= 0) return { summary: `<span class="neg">Enter an amount first.</span>` };
  for (const c of pkg.components) {
    if (c.error) { results.push({ sym: c.sym, skipped: "price unavailable" }); continue; }
    const usd = totalUSD * c.w;
    if (usd > pf.cash) { results.push({ sym: c.sym, skipped: "insufficient cash" }); continue; }
    try {
      const q = await getQuote(c.sym);
      const fx = await getFx(q.currency);
      const priceUSD = q.price * fx;
      const units = usd / priceUSD;
      buy(c.sym, q.name, q.currency, units, priceUSD);
      results.push({ sym: c.sym, units, priceUSD, usd });
    } catch (e) {
      results.push({ sym: c.sym, skipped: e.message });
    }
  }
  renderPortfolio();
  const lines = results.map((r) =>
    r.skipped
      ? `<span class="neg">✗ ${r.sym} — ${r.skipped}</span>`
      : `<span class="pos">✓ ${r.sym} — ${r.units.toFixed(4)} units @ ${money(r.priceUSD)} (${money(r.usd)})</span>`
  );
  const spent = results.filter((r) => !r.skipped).reduce((s, r) => s + r.usd, 0);
  const synced = cloudToken
    ? `<br/>☁ All trades saved to your token <code>••••${cloudToken.slice(-4)}</code>`
    : `<br/>📱 Saved locally — link a token to keep trades forever`;
  return {
    results,
    summary: `<b>${results.filter((r) => !r.skipped).length}/${pkg.components.length} filled</b> · ${money(spent)} invested${synced}<br/>${lines.join("<br/>")}`,
  };
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

  await processPendingOrders(false);
  const views = await Promise.all(pf.positions.map(positionView).map((p) => p.catch(() => null)));
  let ok = views.filter(Boolean);
  await checkLiquidations(ok);
  await processExits(ok);
  if (pf.positions.length !== ok.length) {
    const views2 = await Promise.all(pf.positions.map(positionView).map((p) => p.catch(() => null)));
    ok = views2.filter(Boolean);
  }
  const invested = ok.reduce((s, v) => s + v.value, 0);
  const equity = pf.cash + invested;
  const totalPl = equity - pf.startEquity;
  const unrealized = ok.reduce((s, v) => s + v.pl, 0);
  const dayPl = ok.filter((v) => v.dayPl != null).reduce((s, v) => s + v.dayPl, 0);
  const realized = pf.history.filter((h) => h.type === "sell" || h.type === "liquidation").reduce((s, h) => s + (h.realized || 0), 0);

  summary.innerHTML = `
    <div class="pos-card"><div class="k">Equity</div><div class="v">${money(equity)}</div><div class="s ${cls(totalPl)}">${pct(totalPl / pf.startEquity)} all-time</div></div>
    <div class="pos-card"><div class="k">Cash</div><div class="v">${money(pf.cash)}</div><div class="s muted">started with ${money(pf.startEquity)}</div></div>
    <div class="pos-card"><div class="k">Invested</div><div class="v">${money(invested)}</div><div class="s muted">${pf.positions.length} position${pf.positions.length === 1 ? "" : "s"}</div></div>
    <div class="pos-card"><div class="k">Unrealized P/L</div><div class="v ${cls(unrealized)}">${money(unrealized)}</div><div class="s ${cls(unrealized)}">open positions</div></div>
    <div class="pos-card"><div class="k">Day move</div><div class="v ${cls(dayPl)}">${money(dayPl)}</div><div class="s ${cls(dayPl)}">market move today</div></div>
    <div class="pos-card"><div class="k">Realized P/L</div><div class="v ${cls(realized)}">${money(realized)}</div><div class="s muted">closed trades</div></div>`;

  const table = $("positionsTable");
  if (!pf.positions.length) {
    table.innerHTML = `<div class="empty">No open positions. Go to the Simulator, pick an instrument and click <b>Trade</b> to place your first virtual trade at the live price.</div>`;
  } else {
    table.innerHTML = `<table class="table">
      <tr><th>Instrument</th><th>Units</th><th>Avg cost</th><th>Live price</th><th>Value</th><th>P/L since fill</th><th>Day move</th><th></th></tr>
      ${pf.positions.map((p) => {
        const v = ok.find((x) => x.id === p.id);
        if (!v) return `<tr><td>${p.sym}</td><td colspan="7" class="muted">price unavailable</td></tr>`;
        return `<tr>
          <td><b>${p.sym}</b><br><span class="muted" style="font-family:Inter;font-size:11px">${p.name}</span></td>
          <td>${v.units.toFixed(4)}${v.lev > 1 || v.short ? ` <span class="chip ${v.short ? "bad" : "warn"}">${v.short ? "SHORT" : v.lev + "×"}</span>` : ""}${v.liquidation ? `<br><span class="muted" style="font-size:10px">liq ${money(v.liquidation)}</span>` : ""}</td>
          <td>${money(v.avgCost)}</td>
          <td>${money(v.priceUSD)}<br><span class="muted" style="font-size:10.5px">${v.price.toFixed(2)} ${v.ccy}</span></td>
          <td>${money(v.value)}</td>
          <td class="${cls(v.pl)}">${money(v.pl)}<br><span style="font-size:11px">${pct(v.plPct)}</span></td>
          <td>${v.dayPl == null ? '<span class="chip neutral">new ✨</span>' : `<span class="${cls(v.dayPl)}">${money(v.dayPl)}</span>`}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn small" data-exits="${p.id}">🎯${p.exits?.length ? ` ${p.exits.filter((e) => e.filled).length}/${p.exits.length}` : ""}</button>
            <button class="btn small" data-sell50="${p.id}">Sell 50%</button>
            <button class="btn small danger" data-sell="${p.id}">Close</button>
          </td>
        </tr>`;
      }).join("")}
    </table>`;
    table.querySelectorAll("[data-sell]").forEach((b) => (b.onclick = () => sellPosition(b.dataset.sell, 1)));
    table.querySelectorAll("[data-sell50]").forEach((b) => (b.onclick = () => sellPosition(b.dataset.sell50, 0.5)));
    table.querySelectorAll("[data-exits]").forEach((b) => (b.onclick = () => openExitsModal(b.dataset.exits)));
  }

  const ordersBox = document.getElementById("ordersTable");
  if (ordersBox) {
    if (!pf.orders?.length) {
      ordersBox.innerHTML = `<div class="empty">No pending orders. Use a signal's ⚡ Execute button or the order ticket to place limit, stop or auction orders.</div>`;
    } else {
      ordersBox.innerHTML = `<table class="table">
        <tr><th>Placed</th><th>Instrument</th><th>Order</th><th>Trigger</th><th>Amount</th><th>Source</th><th></th></tr>
        ${pf.orders.map((o) => `<tr>
          <td>${dstr(o.created)}</td>
          <td><b>${o.sym}</b></td>
          <td>${o.side === "buy" ? '<span class="chip good">BUY' : '<span class="chip bad">SELL'}${o.lev > 1 ? ` ${o.lev}×` : ""}</span> <span class="chip neutral">${o.type}</span></td>
          <td>${o.type === "auction" ? "next hourly" : money(o.trigger)}</td>
          <td>${money(o.usd)}</td>
          <td class="muted" style="font-family:Inter;font-size:11px">${o.source || "manual"}</td>
          <td style="text-align:right"><button class="btn small danger" data-cancel="${o.id}">Cancel</button></td>
        </tr>`).join("")}
      </table>`;
      ordersBox.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => {
        pf.orders = pf.orders.filter((x) => x.id !== b.dataset.cancel);
        save();
        renderPortfolio();
      }));
    }
  }

  const hist = $("historyTable");
  if (!pf.history.length) {
    hist.innerHTML = `<div class="empty">No trades yet.</div>`;
  } else {
    hist.innerHTML = `<table class="table">
      <tr><th>Date</th><th>Type</th><th>Instrument</th><th>Units</th><th>Price (USD)</th><th>Amount</th><th>Realized P/L</th></tr>
      ${pf.history.map((h) => `<tr>
        <td>${dstr(h.ts)}</td>
        <td>${h.type === "buy" ? '<span class="chip good">BUY</span>' : h.type === "short" ? '<span class="chip bad">SHORT</span>' : h.type === "liquidation" ? '<span class="chip bad">LIQ</span>' : h.type === "exit" ? '<span class="chip warn">EXIT</span>' : '<span class="chip bad">SELL</span>'}${h.note ? `<br><span class="muted" style="font-size:10px;font-family:Inter">${h.note}</span>` : ""}</td>
        ${""}
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
    pf = { cash: START_CASH, positions: [], history: [], orders: [], startEquity: START_CASH };
    save();
    renderPortfolio();
  };
  renderCloudPanel();
  renderPortfolio();
  // auto-sync: pull the cloud copy on load so updates/deployments never lose trades
  if (cloudToken) pullFromCloud();
  // hourly tick: auction executions + order triggers even when idle
  setInterval(async () => {
    await processPendingOrders(true);
    if ($("portfolioView").style.display !== "none") renderPortfolio();
  }, 60 * 60 * 1000);
  setInterval(() => { if ($("portfolioView").style.display !== "none") renderPortfolio(); }, 60000);
}

async function pullFromCloud() {
  try {
    const r = await fetch(`/api/portfolio?token=${encodeURIComponent(cloudToken)}`);
    if (!r.ok) return;
    const j = await r.json();
    pf = { cash: j.portfolio.cash, startEquity: j.portfolio.startEquity, positions: j.portfolio.positions, history: j.portfolio.history, orders: j.portfolio.orders || [] };
    localStorage.setItem(KEY, JSON.stringify(pf));
    lastSync = Date.now();
    renderCloudPanel();
    renderPortfolio();
  } catch {}
}
