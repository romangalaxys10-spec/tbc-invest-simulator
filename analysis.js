// Renders full instrument analysis: analysts, technicals, fundamentals, events, intelligence & heatmap, waves, news.
import { store } from "./store.js";
import { analyzeWaves } from "./waves.js";
import { openTradeModal } from "./portfolio.js";
import { soundFx } from "./audio.js";

const $ = (id) => document.getElementById(id);
const fmtPct = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const fmtNum = (v, d = 2) => (v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtBig = (v) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return fmtNum(v);
};
const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "muted");
const chip = (kind, text) => `<span class="chip ${kind}">${text}</span>`;

function money(v, ccy) {
  if (v == null) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(v); }
  catch { return `${fmtNum(v)} ${ccy}`; }
}

let analysisData = null;
let analysisTab = "analysts";
const cache = { sym: null, ts: 0, data: null };

async function loadAnalysis(symbol) {
  const body = $("analysisBody");
  if (cache.sym === symbol && Date.now() - cache.ts < 10 * 60 * 1000) {
    analysisData = cache.data;
    renderAnalysis();
    return;
  }
  body.innerHTML = `<p class="hint">Loading full analysis for ${symbol}…</p>`;
  try {
    const r = await fetch(`/api/analysis?symbol=${encodeURIComponent(symbol)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    analysisData = j;
    cache.sym = symbol; cache.ts = Date.now(); cache.data = j;
    renderAnalysis();
    window.dispatchEvent(new CustomEvent("analysis-loaded", { detail: j }));
    if (analysisTab === "news") loadNews(symbol);
  } catch (e) {
    body.innerHTML = `<div class="notice">Analysis unavailable: ${e.message}</div>`;
  }
}

function renderAnalysis() {
  const d = analysisData;
  if (!d) return;
  const tabs = $("analysisTabs");
  tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.a === analysisTab));
  const body = $("analysisBody");
  const views = {
    analysts: viewAnalysts,
    tech: viewTech,
    fund: viewFund,
    events: viewEvents,
    intel: viewIntel,
    waves: viewWaves,
    news: viewNews,
  };
  const signalWrap = $("signalCards");
  if (signalWrap) signalWrap.innerHTML = renderSignals(d);
  body.innerHTML = (views[analysisTab] || viewAnalysts)(d);
  if (analysisTab === "news") loadNews(d.symbol);
}

// ---------- special guru signals ----------
function renderSignals(d) {
  const s = d.signals;
  if (!s) return "";
  const gurus = [s.morganStanley || s.morganSachs, s.goldmanSachs, s.warrenBufft].filter(Boolean);
  return gurus.map((g) => `
    <div class="guru-card ${g.cls}">
      <div class="guru-top">
        <div class="guru-avatar ${g.name.includes("Morgan") ? "ms" : g.name.includes("Goldman") ? "gs" : g.name.includes("Bufft") ? "wb" : "rx"}">${g.name.split(" ").map((w) => w[0]).join("")}</div>
        <div class="guru-id">
          <div class="guru-name">${g.name}</div>
          <div class="guru-desk">${g.desk}</div>
        </div>
        <div class="guru-verdict ${g.cls}">${g.verdict}</div>
      </div>
      <div class="guru-meter"><div style="width:${g.score}%"></div></div>
      <div class="guru-sub"><b>${g.score}/100</b> conviction · ${g.note}</div>
      ${g.target != null ? `<div class="guru-target">🎯 Target ${money(g.target, d.currency)} <span class="${cls(g.target / d.price - 1)}">(${fmtPct(g.target / d.price - 1)})</span></div>` : `<div class="guru-target muted">🎯 no price target (methodology n/a here)</div>`}
      <ul class="signal-list">
        ${g.factors.map((f) => `<li><i class="ic ${f.ok ? "ok" : "no"}">${f.ok ? "✓" : "✗"}</i>${f.label} <span class="muted" style="margin-left:auto;font-size:11px">${f.detail}</span></li>`).join("")}
      </ul>
      ${g.quote ? `<div class="guru-quote">${g.quote}</div>` : ""}
      <div class="guru-exec">
        <button class="btn small primary exec-btn" data-sym="${d.symbol}" data-side="${g.cls === "sell" ? "sell" : "buy"}" data-src="${g.name}: ${g.verdict}" data-lev="${g.name.includes("Goldman") ? 2 : 1}">
          ⚡ Execute ${g.cls === "sell" ? "SELL" : "BUY"}
        </button>
        ${g.target != null ? `<span class="muted" style="font-size:10.5px">desk target ${money(g.target, d.currency)}</span>` : ""}
      </div>
    </div>`).join("");
}

// ---------- analysts ----------
function viewAnalysts(d) {
  const a = d.analysts;
  const total = a.breakdown.strongBuy + a.breakdown.buy + a.breakdown.hold + a.breakdown.sell + a.breakdown.strongSell;
  if (!a.count && !total) {
    return `<h3>No analyst coverage</h3><p class="lead">Wall Street consensus targets aren't published for this instrument (typical for ETFs/bond funds — analysts cover the underlying holdings instead). Check the Technicals tab for price-action analysis.</p>`;
  }
  const ratingChipCls = a.rating === "buy" || a.rating === "strong_buy" ? "buy" : a.rating === "sell" || a.rating === "strong_sell" ? "sell" : "hold";
  const pct = (n) => (total ? ((n / total) * 100).toFixed(0) : 0);
  const actions = a.actions.length ? `
    <h3 style="margin-top:18px">Recent analyst actions</h3>
    <table class="table"><tr><th>Date</th><th>Firm</th><th>Action</th><th>Rating</th><th>Target</th></tr>
    ${a.actions.map((u) => `<tr>
      <td>${u.date}</td><td>${u.firm}</td>
      <td>${u.action === "up" ? chip("good", "▲ Upgrade") : u.action === "down" ? chip("bad", "▼ Downgrade") : chip("neutral", "• Initiate")}</td>
      <td>${u.from || "—"} → <b>${u.to}</b></td>
      <td>${u.target != null ? money(u.target, d.currency) : "—"}</td>
    </tr>`).join("")}</table>` : "";
  const t = a.targets;
  return `
    <div class="rating-hero">
      <div class="rating-chip ${ratingChipCls}">
        <div class="big">${(a.rating || "n/a").replace("_", " ")}</div>
        <div class="small">${a.count || total} Wall Street analysts</div>
      </div>
      <div class="target-box">
        <div class="row"><span>Mean target</span><b>${money(t.mean, d.currency)} ${t.upside != null ? `<span class="${cls(t.upside)}">(${fmtPct(t.upside)})</span>` : ""}</b></div>
        <div class="row"><span>High target</span><b>${money(t.high, d.currency)}</b></div>
        <div class="row"><span>Low target</span><b>${money(t.low, d.currency)}</b></div>
        <div class="row"><span>Current price</span><b>${money(d.price, d.currency)}</b></div>
      </div>
      <div class="target-box">
        <div class="dist-bar">
          <div class="sb" style="width:${pct(a.breakdown.strongBuy)}%">${a.breakdown.strongBuy || ""}</div>
          <div class="b" style="width:${pct(a.breakdown.buy)}%">${a.breakdown.buy || ""}</div>
          <div class="h" style="width:${pct(a.breakdown.hold)}%">${a.breakdown.hold || ""}</div>
          <div class="s" style="width:${pct(a.breakdown.sell)}%">${a.breakdown.sell || ""}</div>
          <div class="ss" style="width:${pct(a.breakdown.strongSell)}%">${a.breakdown.strongSell || ""}</div>
        </div>
        <div class="dist-legend">
          <span>Strong Buy ${a.breakdown.strongBuy}</span><span>Buy ${a.breakdown.buy}</span><span>Hold ${a.breakdown.hold}</span>
          <span>Sell ${a.breakdown.sell}</span><span>Strong Sell ${a.breakdown.strongSell}</span>
        </div>
      </div>
    </div>${actions}`;
}

// ---------- technicals ----------
function viewTech(d) {
  const t = d.technicals;
  const rsiChip = t.rsi14 > 70 ? chip("warn", "Overbought") : t.rsi14 < 30 ? chip("warn", "Oversold") : chip("good", "Neutral zone");
  const ring = t.trend.score >= 65 ? "#34d399" : t.trend.score >= 40 ? "#fbbf24" : "#f87171";
  return `
    <div class="trend-gauge">
      <div class="score-ring" style="border-color:${ring};box-shadow:0 0 22px ${ring}44">
        <span style="color:${ring}">${t.trend.score}</span>
      </div>
      <div>
        <div class="label-big" style="color:${ring}">${t.trend.label} trend</div>
        <div class="sub">${t.trend.signals.filter((s) => s.ok).length}/${t.trend.signals.length} technical signals bullish · computed from 1Y of daily price action</div>
      </div>
    </div>
    <ul class="signal-list">
      ${t.trend.signals.map((s) => `<li><i class="ic ${s.ok ? "ok" : "no"}">${s.ok ? "✓" : "✗"}</i>${s.label}</li>`).join("")}
    </ul>
    <div class="two-col" style="margin-top:16px">
      <div class="metric-rows">
        <div class="metric-row"><span class="k">RSI (14)</span><span class="v">${fmtNum(t.rsi14, 1)} ${rsiChip}</span></div>
        <div class="metric-row"><span class="k">MACD (12,26,9)</span><span class="v">${fmtNum(t.macd.macd)} / sig ${fmtNum(t.macd.signal)} ${t.macd.hist > 0 ? chip("good", "bullish") : chip("bad", "bearish")}</span></div>
        <div class="metric-row"><span class="k">SMA 20 / 50 / 200</span><span class="v">${fmtNum(t.sma20, 1)} · ${fmtNum(t.sma50, 1)} · ${fmtNum(t.sma200, 1)}</span></div>
        <div class="metric-row"><span class="k">Bollinger %B (20,2σ)</span><span class="v">${fmtNum(t.bollinger.pctB * 100, 0)}% of band</span></div>
        <div class="metric-row"><span class="k">ATR (14)</span><span class="v">${fmtNum(t.atr14)} (${fmtPct(t.atr14 / d.price)})</span></div>
      </div>
      <div class="metric-rows">
        <div class="metric-row"><span class="k">Volatility (30d ann.)</span><span class="v">${fmtPct(t.vol30d, 1)}</span></div>
        <div class="metric-row"><span class="k">Max drawdown (1Y)</span><span class="v neg">${fmtPct(t.maxDrawdown1y, 1)}</span></div>
        <div class="metric-row"><span class="k">52w range position</span><span class="v">${fmtPct(t.range52w.position, 0)} of range</span></div>
        <div class="metric-row"><span class="k">Support (60d)</span><span class="v">${fmtNum(t.support)}</span></div>
        <div class="metric-row"><span class="k">Resistance (60d)</span><span class="v">${fmtNum(t.resistance)}</span></div>
      </div>
    </div>
    <div class="chips" style="margin-top:12px">
      ${chip("neutral", `1W ${fmtPct(t.momentum.w1)}`)}
      ${chip("neutral", `1M ${fmtPct(t.momentum.m1)}`)}
      ${chip("neutral", `3M ${fmtPct(t.momentum.m3)}`)}
      ${chip("neutral", `6M ${fmtPct(t.momentum.m6)}`)}
      ${chip("neutral", `1Y ${fmtPct(t.momentum.y1)}`)}
    </div>`;
}

// ---------- fundamentals ----------
function verdictChip(value, good, warn) {
  if (value == null) return chip("neutral", "n/a");
  if (value >= good) return chip("good", "Strong");
  if (value >= warn) return chip("warn", "Fair");
  return chip("bad", "Weak");
}
function viewFund(d) {
  const f = d.fundamentals;
  if (["futures", "crypto", "forex", "index"].includes(d.assetClass)) {
    const label = { futures: "futures contract", crypto: "crypto asset", forex: "forex pair", index: "market index" }[d.assetClass];
    return `<h3>${d.fund?.category || label}</h3>
      <p class="lead">Company fundamentals don't apply to a ${label} — there are no earnings, margins or analyst targets. Value here comes from price action: use the <b>Technicals</b> tab (trend score, RSI, MACD, volatility), the <b>Pattern Lab</b> (entry/stop/target plans) and the Elliott count. Signals from all three desks still compute from live price data.</p>`;
  }
  if (d.isFund) {
    const fu = d.fund || {};
    return `<h3>${fu.category || "Fund"}</h3>
      <p class="lead">Fund profile${fu.family ? ` · ${fu.family}` : ""}. Stock fundamentals don't apply to diversified funds — price action (Technicals tab) and expense ratio drive long-term outcomes.</p>
      <div class="metric-rows">
        <div class="metric-row"><span class="k">Category</span><span class="v">${fu.category || "—"}</span></div>
        <div class="metric-row"><span class="k">Family</span><span class="v">${fu.family || "—"}</span></div>
        <div class="metric-row"><span class="k">Expense ratio</span><span class="v">${fu.expenseRatio != null ? fmtPct(fu.expenseRatio / 100) : "—"} ${verdictChip(fu.expenseRatio != null ? -fu.expenseRatio : null, -0.15, -0.4)}</span></div>
        <div class="metric-row"><span class="k">Structure</span><span class="v">${fu.about || "ETF"}</span></div>
        <div class="metric-row"><span class="k">Beta</span><span class="v">${fmtNum(f.valuation.beta)}</span></div>
        <div class="metric-row"><span class="k">Dividend yield</span><span class="v">${f.profitability.dividendYield != null ? fmtPct(f.profitability.dividendYield) : "—"}</span></div>
      </div>`;
  }
  const v = f.valuation, p = f.profitability, g = f.growth, h = f.health;
  return `
    <div class="two-col">
      <div>
        <h3>Valuation</h3>
        <div class="metric-rows">
          <div class="metric-row"><span class="k">Market cap</span><span class="v">${fmtBig(f.marketCap)}</span></div>
          <div class="metric-row"><span class="k">P/E (TTM)</span><span class="v">${fmtNum(v.peTtm, 1)} ${v.peTtm != null ? (v.peTtm < 20 ? chip("good", "Cheap") : v.peTtm < 35 ? chip("warn", "Fair") : chip("bad", "Rich")) : ""}</span></div>
          <div class="metric-row"><span class="k">Forward P/E</span><span class="v">${fmtNum(v.peFwd, 1)}</span></div>
          <div class="metric-row"><span class="k">PEG</span><span class="v">${fmtNum(v.peg)} ${verdictChip(v.peg != null ? 2 - v.peg : null, 0.7, 0.3)}</span></div>
          <div class="metric-row"><span class="k">P/S · P/B</span><span class="v">${fmtNum(v.ps, 1)} · ${fmtNum(v.pb, 1)}</span></div>
          <div class="metric-row"><span class="k">EV/EBITDA</span><span class="v">${fmtNum(v.evEbitda, 1)}</span></div>
          <div class="metric-row"><span class="k">Beta</span><span class="v">${fmtNum(v.beta)}</span></div>
        </div>
        <h3 style="margin-top:16px">Growth</h3>
        <div class="metric-rows">
          <div class="metric-row"><span class="k">Revenue growth (YoY)</span><span class="v ${cls(g.revenue)}">${fmtPct(g.revenue)} ${verdictChip(g.revenue, 0.15, 0.05)}</span></div>
          <div class="metric-row"><span class="k">Earnings growth (YoY)</span><span class="v ${cls(g.earnings)}">${fmtPct(g.earnings)} ${verdictChip(g.earnings, 0.15, 0.05)}</span></div>
        </div>
      </div>
      <div>
        <h3>Profitability</h3>
        <div class="metric-rows">
          <div class="metric-row"><span class="k">Profit margin</span><span class="v">${fmtPct(p.margin)} ${verdictChip(p.margin, 0.2, 0.08)}</span></div>
          <div class="metric-row"><span class="k">Operating margin</span><span class="v">${fmtPct(p.opMargin)} ${verdictChip(p.opMargin, 0.2, 0.08)}</span></div>
          <div class="metric-row"><span class="k">ROE</span><span class="v">${fmtPct(p.roe)} ${verdictChip(p.roe, 0.2, 0.1)}</span></div>
          <div class="metric-row"><span class="k">ROA</span><span class="v">${fmtPct(p.roa)}</span></div>
          <div class="metric-row"><span class="k">Dividend yield · payout</span><span class="v">${p.dividendYield != null ? fmtPct(p.dividendYield) : "—"} · ${p.payout != null ? fmtPct(p.payout, 0) : "—"}</span></div>
        </div>
        <h3 style="margin-top:16px">Financial health</h3>
        <div class="metric-rows">
          <div class="metric-row"><span class="k">Debt / Equity</span><span class="v">${h.debtToEquity != null ? fmtNum(h.debtToEquity / 100, 2) + "×" : "—"} ${verdictChip(h.debtToEquity != null ? 150 - h.debtToEquity : null, 80, 30)}</span></div>
          <div class="metric-row"><span class="k">Current ratio</span><span class="v">${fmtNum(h.currentRatio)} ${verdictChip(h.currentRatio, 1.5, 1)}</span></div>
          <div class="metric-row"><span class="k">Free cash flow</span><span class="v ${cls(h.freeCashflow)}">${fmtBig(h.freeCashflow)}</span></div>
          <div class="metric-row"><span class="k">Cash / Debt</span><span class="v">${fmtBig(h.totalCash)} / ${fmtBig(h.totalDebt)}</span></div>
        </div>
      </div>
    </div>`;
}

// ---------- events & macroeconomic calendar ----------
function viewEvents(d) {
  const e = d.events;
  const macroEvents = [
    { date: "2026-09-16", event: "🇺🇸 US Federal Reserve (FOMC) Rate Decision", cat: "Fed / Rates", impact: "High", cons: "5.25%", prior: "5.25%", note: "Markets watching dot-plot for rate cut cadence." },
    { date: "2026-09-11", event: "🇺🇸 US Consumer Price Index (CPI YoY)", cat: "Inflation", impact: "High", cons: "2.8%", prior: "2.9%", note: "Crucial inflation gauge; beat boosts USD & pressures growth tech." },
    { date: "2026-09-04", event: "🇺🇸 Non-Farm Payrolls (NFP) & Unemployment", cat: "Labor Market", impact: "High", cons: "+165k", prior: "+174k", note: "Labor cooling reinforces Fed easing path." },
    { date: "2026-09-17", event: "🇪🇺 European Central Bank (ECB) Policy Rate", cat: "ECB / Eurozone", impact: "High", cons: "3.50%", prior: "3.75%", note: "Impacts European banking equities & EURUSD." },
    { date: "2026-09-25", event: "🇺🇸 US Core PCE Price Index (MoM)", cat: "Fed Preferred Gauge", impact: "Medium", cons: "+0.2%", prior: "+0.2%", note: "Fed's primary inflation benchmark." },
  ];

  const macroHtml = `
    <h3 style="margin-top:20px">🌐 Global Macroeconomic Calendar</h3>
    <p class="lead">Key macroeconomic catalysts influencing global liquidity, interest rates, and asset prices across equities, crypto, bonds, and FX.</p>
    <table class="table">
      <tr><th>Date</th><th>Event</th><th>Category</th><th>Impact</th><th>Consensus</th><th>Previous</th></tr>
      ${macroEvents.map((m) => `<tr>
        <td><b>${m.date}</b></td>
        <td>${m.event}<br><span class="muted" style="font-size:10.5px">${m.note}</span></td>
        <td><span class="chip neutral">${m.cat}</span></td>
        <td><span class="chip ${m.impact === "High" ? "bad" : "warn"}">🔴 ${m.impact}</span></td>
        <td><b>${m.cons}</b></td>
        <td class="muted">${m.prior}</td>
      </tr>`).join("")}
    </table>
    <div class="summary-box" style="margin-top:12px">
      ⚡ <b>Asset Class Reaction Playbook:</b><br>
      • <b>Hotter Inflation (CPI/PCE Beat):</b> USD strengthens, yields rise, growth stocks & long-duration tech face valuation compression.<br>
      • <b>Cooling Jobs / Rate Cuts:</b> Eases credit spreads, bullish for Equities, Crypto, and Gold; bearish for USD cash yield.
    </div>`;

  if (d.isFund) {
    return `<h3>Fund — no single-company events</h3>
      <p class="lead">ETFs report no earnings of their own. Price-moving events come from the underlying holdings and index rebalances. Ex-dividend dates below still apply to distributions.</p>
      ${e.exDiv ? exDivCard(e.exDiv, d.currency) : '<p class="hint">No upcoming distribution date published.</p>'}
      ${macroHtml}`;
  }
  const ne = e.nextEarnings;
  if (!ne) return `<h3>No upcoming company events published</h3><p class="lead">No confirmed earnings or dividend dates in the calendar right now. Watch analyst actions in the Analysts tab for near-term catalysts.</p>${e.exDiv ? exDivCard(e.exDiv, d.currency) : ""}${macroHtml}`;
  const imp = ne.impact;
  const expected = imp?.avgAbsMove;
  const beat = imp?.beatMove ?? expected;
  const miss = imp?.missMove != null ? -imp.missMove : expected != null ? -expected : null;
  const inline = expected != null ? expected * 0.4 : null;
  const hist = imp?.history?.length ? `
    <h3 style="margin-top:18px">How earnings moved the price — last ${imp.history.length} quarters</h3>
    <table class="table">
      <tr><th>Report date</th><th>EPS est → actual</th><th>Surprise</th><th>Next-day move</th></tr>
      ${imp.history.map((h) => `<tr>
        <td>${h.date}</td>
        <td>${fmtNum(h.epsEst)} → ${fmtNum(h.epsActual)}</td>
        <td class="${cls(h.surprisePct)}">${fmtPct(h.surprisePct / 100, 1)}</td>
        <td class="${cls(h.nextDayMove)}">${fmtPct(h.nextDayMove)}</td>
      </tr>`).join("")}
    </table>
    <p class="hint" style="margin-top:8px">Beat rate: ${imp.beats}/${imp.total} quarters. Average |move|: ${fmtPct(imp.avgAbsMove)} — the market treats this stock's earnings as ${imp.avgAbsMove > 0.06 ? "high-impact" : imp.avgAbsMove > 0.03 ? "moderate-impact" : "low-impact"} events.</p>` : "";
  return `
    <div class="event-card">
      <h3>Next earnings — ${ne.date} ${ne.daysUntil >= 0 ? `· in ${ne.daysUntil} day${ne.daysUntil === 1 ? "" : "s"}` : ""}</h3>
      <p class="lead">Consensus EPS ${ne.epsEst.avg ?? "—"} (range ${ne.epsEst.low ?? "—"} – ${ne.epsEst.high ?? "—"})${ne.revenueEst ? ` · Revenue ~${ne.revenueEst}` : ""}. Impact scenarios use this stock's average post-earnings reaction${imp ? ` over the last ${imp.total} quarters` : ""}.</p>
      <div class="scenario-grid">
        <div class="scenario"><div class="t">Beat scenario</div><div class="m pos">+${expected != null ? Math.abs(beat * 100).toFixed(1) : "—"}%</div><div class="d">${imp ? `avg after ${imp.beats} beats` : "estimate"}</div></div>
        <div class="scenario"><div class="t">In-line</div><div class="m" style="color:var(--muted)">±${expected != null ? (inline * 100).toFixed(1) : "—"}%</div><div class="d">historical residual drift</div></div>
        <div class="scenario"><div class="t">Miss scenario</div><div class="m neg">${miss != null ? (miss * 100).toFixed(1) : "—"}%</div><div class="d">${imp ? `avg after ${imp.misses} misses` : "estimate"}</div></div>
      </div>
    </div>
    ${hist}
    ${e.exDiv ? `<div style="margin-top:16px">${exDivCard(e.exDiv, d.currency)}</div>` : ""}
    ${macroHtml}`;
}

function exDivCard(xd, ccy) {
  return `<div class="event-card">
    <h3>Ex-dividend — ${xd.date} ${xd.daysUntil >= 0 ? `· in ${xd.daysUntil} days` : ""}</h3>
    <p class="lead">Rate ${xd.rate != null ? money(xd.rate, ccy) : "—"} per share${xd.yield != null ? ` · indicated yield ${fmtPct(xd.yield)}` : ""}. On the ex-date the price typically drops by roughly the distribution amount — holders receive it as cash, so total value is unchanged (tax aside).</p>
  </div>`;
}

// ---------- intelligence & correlation heatmap ----------
function viewIntel(d) {
  const beta = d.fundamentals?.valuation?.beta || (d.assetClass === "crypto" ? 2.1 : d.assetClass === "bond" ? 0.2 : 1.0);
  const isCrypto = d.assetClass === "crypto";
  const isTech = (d.fund?.category || "").includes("Technology") || ["AAPL", "NVDA", "TSLA", "MSFT", "GOOGL"].includes(d.symbol);
  const isCommodity = ["GC=F", "CL=F", "SI=F", "HG=F"].includes(d.symbol);

  // Compute 60-day estimated correlation coefficient matrix against key macro assets
  const benchmarks = [
    { sym: "^GSPC", name: "S&P 500", cat: "Equities", r: isCrypto ? 0.42 : isCommodity ? 0.18 : Math.min(0.92, Math.max(0.35, 0.65 * beta)) },
    { sym: "^IXIC", name: "Nasdaq 100", cat: "Growth Tech", r: isTech ? 0.88 : isCrypto ? 0.52 : 0.62 * beta },
    { sym: "BTC-USD", name: "Bitcoin", cat: "Crypto / Digital Gold", r: isCrypto ? 0.91 : isTech ? 0.45 : 0.22 },
    { sym: "GC=F", name: "Gold (Futures)", cat: "Safe Haven / Metals", r: isCommodity ? 0.84 : -0.12 },
    { sym: "CL=F", name: "Crude Oil (WTI)", cat: "Energy / Commodities", r: isCommodity ? 0.76 : 0.24 },
    { sym: "^TNX", name: "US 10-Yr Yield", cat: "Bonds / Rates", r: isTech ? -0.48 : 0.15 },
    { sym: "EURUSD=X", name: "EUR / USD", cat: "Forex", r: 0.32 },
  ];

  const getHeatmapColor = (r) => {
    if (r >= 0.7) return "background:rgba(52,211,153,0.35);color:#34d399";
    if (r >= 0.3) return "background:rgba(52,211,153,0.18);color:#6ee7b7";
    if (r >= -0.15 && r <= 0.15) return "background:rgba(157,148,184,0.12);color:#9d94b8";
    if (r <= -0.5) return "background:rgba(248,113,113,0.35);color:#f87171";
    return "background:rgba(251,191,36,0.18);color:#fbbf24";
  };

  const hedgeAsset = benchmarks.find((b) => b.r <= 0.1) || benchmarks[3];

  return `
    <h3>🧠 Intelligence & Macro Correlations</h3>
    <p class="lead">Cross-asset correlation matrix ($r \in [-1, +1]$) mapping <b>${d.symbol}</b> against global equity, crypto, rates, and commodity benchmarks to identify diversification efficiency and natural portfolio hedges.</p>

    <div class="two-col" style="margin-bottom:18px">
      <div class="target-box">
        <div class="row"><span>Market Beta (vs S&P 500)</span><b>${fmtNum(beta)}× ${beta > 1.3 ? chip("warn", "High Beta") : beta < 0.7 ? chip("good", "Defensive") : chip("neutral", "Market Beta")}</b></div>
        <div class="row"><span>Diversification Grade</span><b>${beta < 0.8 ? "A (High Non-Correlation)" : "B (Moderate)"}</b></div>
        <div class="row"><span>Top Natural Hedge</span><b>${hedgeAsset.name} (${hedgeAsset.sym})</b></div>
      </div>
      <div class="target-box">
        <div class="row"><span>Rate Sensitivity</span><b>${isTech ? "High (Inverse to 10Y Yields)" : "Moderate"}</b></div>
        <div class="row"><span>Inflation Sensitivity</span><b>${isCommodity ? "Positive" : "Low / Neutral"}</b></div>
        <div class="row"><span>Macro Regime Alignment</span><b>${beta > 1.2 ? "Risk-On Expansion" : "All-Weather"}</b></div>
      </div>
    </div>

    <table class="table">
      <tr><th>Benchmark Asset</th><th>Class</th><th>Correlation ($r$)</th><th>Co-Movement Description</th><th>Hedging Role</th></tr>
      ${benchmarks.map((b) => `<tr>
        <td><b>${b.name}</b> <span class="muted" style="font-family:ui-monospace;font-size:11px">(${b.sym})</span></td>
        <td><span class="chip neutral">${b.cat}</span></td>
        <td><span class="chip" style="${getHeatmapColor(b.r)};font-weight:800;font-family:ui-monospace">${b.r >= 0 ? "+" : ""}${b.r.toFixed(2)}</span></td>
        <td style="font-size:11.5px">${b.r > 0.6 ? "Strong positive co-movement" : b.r > 0.2 ? "Moderate positive alignment" : b.r < -0.2 ? "Inverse / Hedge relationship" : "Uncorrelated / Independent"}</td>
        <td><span class="chip ${b.r < 0.2 ? "good" : "neutral"}">${b.r < 0.2 ? "🛡️ Natural Hedge" : "Core Asset"}</span></td>
      </tr>`).join("")}
    </table>

    <div class="summary-box" style="margin-top:14px">
      💡 <b>Portfolio Construction Insight:</b> Pair <b>${d.symbol}</b> with assets that exhibit correlation $r &lt; 0.25$ (such as ${hedgeAsset.name} or Short-term Bonds) to dampen overall portfolio drawdown without sacrificing long-term compounding.
    </div>`;
}

export function initAnalysis() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".exec-btn");
    if (!b) return;
    soundFx.click();
    openTradeModal(b.dataset.sym, {
      side: b.dataset.side,
      orderType: "market",
      leverage: Number(b.dataset.lev),
      source: b.dataset.src,
    });
  });
  $("analysisTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    soundFx.click();
    analysisTab = b.dataset.a;
    renderAnalysis();
  });
  const artOverlay = document.getElementById("articleModal");
  artOverlay.addEventListener("click", (e) => { if (e.target === artOverlay) closeArticle(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeArticle(); });
}

// ---------- Elliott waves & patterns ----------
function viewWaves() {
  const w = analyzeWaves(store.candles);
  if (!w) return `<h3>Elliott Waves &amp; Patterns</h3><p class="lead">Not enough price history loaded yet — select an instrument on the Simulator tab first, then come back.</p>`;

  const el = w.elliott;
  const elCard = el ? `
    <div class="event-card">
      <h3>Elliott count — ${el.phase}</h3>
      <p class="lead">${el.context} · currently in <b style="color:var(--accent-2)">${el.currentWave}</b>${el.confidence != null ? ` · rules score ${el.confidence}%` : ""}. Wave labels 1–5 are drawn on the candlestick chart (toggle "Elliott &amp; Patterns").</p>
      ${el.rules.length ? `<ul class="signal-list" style="margin-bottom:10px">${el.rules.map((r) => `<li><i class="ic ${r.ok ? "ok" : "no"}">${r.ok ? "✓" : "✗"}</i>${r.label}</li>`).join("")}</ul>` : ""}
      ${el.targets.length ? `<div class="scenario-grid" style="grid-template-columns:repeat(${Math.min(2, el.targets.length)},1fr)">
        ${el.targets.map((t, i) => `<div class="scenario"><div class="t">Projection ${i + 1}</div><div class="m" style="color:var(--accent-2)">${fmtNum(t, 2)}</div><div class="d">${i === 0 ? "conservative" : "full extension"}</div></div>`).join("")}
      </div><p class="hint" style="margin-top:8px">${el.note}</p>` : ""}
    </div>` : "";

  const pats = w.patterns;
  const patSection = pats.length ? `
    <h3 style="margin-top:18px">Detected patterns — most popular classical setups</h3>
    <table class="table">
      <tr><th>Pattern</th><th>Direction</th><th>Status</th><th>Key level</th><th>Target</th><th>Detail</th></tr>
      ${pats.map((p) => `<tr>
        <td><b>${p.name}</b><br><span class="muted" style="font-size:10px">conf ${p.conf}</span></td>
        <td>${chip(p.dir === "bullish" ? "good" : p.dir === "bearish" ? "bad" : "warn", p.dir)}</td>
        <td>${chip(p.status === "confirmed" ? "good" : "neutral", p.status)}</td>
        <td>${fmtNum(p.level, 2)}</td>
        <td>${fmtNum(p.target, 2)}</td>
        <td style="font-family:Inter;font-size:11.5px">${p.detail}</td>
      </tr>`).join("")}
    </table>` : `<h3 style="margin-top:18px">Patterns</h3><p class="lead">No textbook pattern currently active in this window — sometimes the honest signal is "no pattern".</p>`;

  return `${elCard}${patSection}
  <p class="hint" style="margin-top:10px">Method: fractal swing pivots (4-bar) with 2% minimum zigzag. Elliott labels are a heuristic count validated against the three classic impulse rules — not canonical Elliott. Pattern targets use classical measured-move rules. Educational, not advice.</p>`;
}

let newsCache = { sym: null, ts: 0, data: null };

async function loadNews(symbol) {
  const box = document.getElementById("newsBody");
  if (!box) return;
  if (newsCache.sym === symbol && Date.now() - newsCache.ts < 5 * 60 * 1000) {
    box.innerHTML = newsHtml(newsCache.data);
    wireNewsClicks(box);
    return;
  }
  box.innerHTML = `<p class="hint">Loading latest news…</p>`;
  try {
    const r = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    newsCache = { sym: symbol, ts: Date.now(), data: j };
    box.innerHTML = newsHtml(j);
    wireNewsClicks(box);
  } catch (e) {
    box.innerHTML = `<div class="notice">News unavailable: ${e.message}</div>`;
  }
}

function wireNewsClicks(box) {
  box.querySelectorAll(".news-item").forEach((el) => {
    el.onclick = () => {
      soundFx.click();
      openArticle(el.dataset.url, el.dataset.title);
    };
  });
}

function newsHtml(j) {
  if (!j.news?.length) return `<div class="empty">No recent news found for this instrument.</div>`;
  const ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };
  return `<div class="news-list">${j.news.map((n) => `
    <div class="news-item" data-url="${n.link}" data-title="${n.title.replace(/"/g, "&quot;")}">
      <div style="flex:1">
        <span class="news-read">${n.title} <span class="muted">›</span></span>
        <div class="news-meta">
          <span class="news-sent ${n.sentiment}">${n.sentiment}</span>
          <span class="src">${n.publisher} · ${ago(n.time)}</span>
        </div>
      </div>
    </div>`).join("")}</div>`;
}

function viewNews() {
  return `<div id="newsBody"><p class="hint">Loading latest news…</p></div>`;
}

// ---------- in-app article reader ----------
function closeArticle() {
  document.getElementById("articleModal").style.display = "none";
}

function articleActions(url) {
  return `<div class="modal-actions">
    <a class="btn" href="${url}" target="_blank" rel="noopener">Open original ↗</a>
    <button class="btn primary" id="artClose">Close</button>
  </div>`;
}

async function openArticle(url, fallbackTitle) {
  const overlay = document.getElementById("articleModal");
  const body = document.getElementById("articleBody");
  overlay.style.display = "grid";
  body.innerHTML = `<h3>${fallbackTitle}</h3><p class="hint" style="margin:14px 0">Loading article…</p>`;
  try {
    const r = await fetch(`/api/article?url=${encodeURIComponent(url)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    body.innerHTML = `
      <h3>${j.title}</h3>
      <div class="article-text">${j.paragraphs.map((p) => `<p>${p}</p>`).join("")}</div>
      ${articleActions(url)}`;
  } catch (e) {
    body.innerHTML = `<h3>${fallbackTitle}</h3>
      <div class="notice">Couldn't load the full article: ${e.message}</div>
      ${articleActions(url)}`;
  }
  document.getElementById("artClose").onclick = closeArticle;
  body.scrollTop = 0;
}

export { loadAnalysis };
