// Universal shreds: per-chain raw telemetry from free, keyless sources.
// BTC -> mempool.space (real mempool: pre-confirmation data)
// ETH/AVAX/ARB/OP -> public EVM RPCs (block flow, whales, DEX routers)
// SOL -> public Solana RPCs (blocks, whales, Jupiter/Raydium flow)

import { fetchChart, fetchOptions } from "../lib/yahoo.js";
import { CATALOG } from "../instruments.js";

const PRICE_SYM = {
  "BTC-USD": "BTC-USD", "BTC=F": "BTC-USD",
  "ETH-USD": "ETH-USD", "ETH=F": "ETH-USD",
  "AVAX-USD": "AVAX-USD", "ARB-USD": "ARB-USD", "OP-USD": "OP-USD",
  "SOL-USD": "SOL-USD", "BONK-USD": "SOL-USD", "WIF-USD": "SOL-USD",
};


// ---------------- Equity decoder (EDGAR insiders + options flow + halts) ----------------
const SEC_UA = "EquityShreds research admin@claw.rommark.dev";
let cikMap = { ts: 0, map: null };
async function tickerToCik(sym) {
  if (Date.now() - cikMap.ts < 24 * 3600e3 && cikMap.map) return cikMap.map[sym];
  try {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": SEC_UA } });
    const j = await r.json();
    const m = {};
    for (const k of Object.keys(j)) m[j[k].ticker.toUpperCase()] = String(j[k].cik_str).padStart(10, "0");
    cikMap = { ts: Date.now(), map: m };
    return m[sym];
  } catch { return null; }
}

async function edgarInsider(sym) {
  const EMPTY = { cik: null, prints: [], recent: { form4: 0, d13: 0, k8: 0 } };
  try {
  const cik = await tickerToCik(sym);
  if (!cik) return { cik: null, prints: [], recent: { form4: 0, d13: 0, k8: 0 } };
  const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": SEC_UA } });
  const j = await r.json();
  const rec = j.filings.recent;
  const now = Date.now();
  const rows = [];
  let form4 = 0, d13 = 0, k8 = 0;
  for (let i = 0; i < rec.form.length && rows.length < 60; i++) {
    const f = rec.form[i];
    const ts = new Date(rec.filingDate[i]).getTime();
    if (now - ts > 45 * 864e5) continue;
    if (f === "4") form4++;
    else if (f === "SC 13D/A" || f === "SC 13D" || f === "SC 13G/A" || f === "SC 13G") d13++;
    else if (f === "8-K") k8++;
    if (f === "4") rows.push({ date: rec.filingDate[i], acc: rec.accessionNumber[i], doc: rec.primaryDocument[i], cik });
  }
  // fetch details for the latest 2 Form 4s
  const prints = [];
  for (const p of rows.slice(0, 2)) {
    try {
      const dir = `https://www.sec.gov/Archives/edgar/data/${p.cik}/${p.acc.replace(/-/g, "")}/`;
      const doc = await (await fetch(dir + p.doc, { headers: { "User-Agent": SEC_UA } })).text();
      const owner = (doc.match(/<rptOwnerName>([^<]+)/) || [])[1]?.trim() || "insider";
      const shares = Number((doc.match(/<transactionShares>[\s\S]*?<value>([\d.]+)/) || [])[1] || 0);
      const price = Number((doc.match(/<transactionPricePerShare>[\s\S]*?<value>([\d.]+)/) || [])[1] || 0);
      const code = ((doc.match(/<transactionAcquiredDisposedCode>[\s\S]*?<value>([AD])/) || [])[1] || "?");
      prints.push({ owner, shares, price, action: code === "A" ? "BUY" : code === "D" ? "SELL" : "?", date: p.date, link: dir + p.doc });
    } catch {}
  }
  return { cik, prints, recent: { form4, d13, k8 }, dates: rows.slice(0, 6).map((x) => x.date) };
  } catch { return EMPTY; }
}

async function haltsFeed(sym) {
  try {
    const xml = await (await fetch("https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts")).text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 60).map((m) => m[1]);
    const parse = (it) => ({
      sym: (it.match(/<title>([^<]+)/) || [])[1]?.trim(),
      date: (it.match(/<ndaq:HaltDate>([^<]+)/) || [])[1]?.trim(),
      time: (it.match(/<ndaq:HaltTime>([^<]+)/) || [])[1]?.trim(),
      reason: (it.match(/<ndaq:ReasonCode>([^<]+)/) || [])[1]?.trim(),
    });
    const all = items.map(parse).filter((x) => x.sym);
    const mine = all.filter((x) => x.sym.toUpperCase() === sym.toUpperCase()).slice(0, 3);
    return { mine, latest: all.slice(0, 5) };
  } catch { return { mine: [], latest: [] }; }
}

async function equityDecoder(symbol) {
  const cat = CATALOG.find((i) => i.sym === symbol)?.cat;
  const isIndex = cat === "index";
  const isFutures = cat === "futures";
  const isBond = cat === "bond";
  const isForex = cat === "forex";
  const noInsider = isIndex || isFutures || isBond || isForex;
  const [price, insider, halts] = await Promise.all([
    priceOf(symbol),
    noInsider ? Promise.resolve({ prints: [], recent: { form4: 0, d13: 0, k8: 0 } }) : edgarInsider(symbol),
    haltsFeed(symbol),
  ]);
  // options flow & proxy routing
  let opt = null, ocCalls = [], ocPuts = [];
  const OPT_PROXY = {
    "^GSPC": "^SPX", "^IXIC": "^NDX", "^DJI": "^DJX", "^RUT": "^RUT", "^VIX": "^VIX",
    // Futures to liquid ETF / underlying options proxies
    "ES=F": "SPY", "NQ=F": "QQQ", "YM=F": "DIA", "RTY=F": "IWM",
    "CL=F": "USO", "BZ=F": "BNO", "NG=F": "UNG",
    "GC=F": "GLD", "SI=F": "SLV", "HG=F": "CPER",
    "ZN=F": "IEF", "ZB=F": "TLT", "ZF=F": "IEI", "ZT=F": "SHY", "UB=F": "TLT",
    "ZC=F": "CORN", "ZW=F": "WEAT", "ZS=F": "SOYB",
    "ETH=F": "ETH-USD", "NKD=F": "EWJ",
    // Bond ETF & Forex proxies
    "EURUSD=X": "FXE", "USDJPY=X": "FXY", "GBPUSD=X": "FXB", "AUDUSD=X": "FXA", "USDCAD=X": "FXC", "USDCHF=X": "FXF"
  };
  try {
    const oc = await fetchOptions(OPT_PROXY[symbol] || symbol);
    const expDate = new Date(oc.options[0].expirationDate * 1000).toISOString().slice(0, 10);
    const calls = oc.options[0].calls || [], puts = oc.options[0].puts || [];
    const cv = calls.reduce((s, c) => s + (c.volume || 0), 0);
    const pv = puts.reduce((s, p) => s + (p.volume || 0), 0);
    const pc = cv ? +(pv / cv).toFixed(2) : null;
    // max pain
    let best = null;
    for (const k of [...new Set([...calls.map((c) => c.strike), ...puts.map((p) => p.strike)])]) {
      const payout = calls.reduce((s, c) => s + Math.max(0, (k - c.strike)) * (c.openInterest || 0) * 100, 0) +
                     puts.reduce((s, p) => s + Math.max(0, (p.strike - k)) * (p.openInterest || 0) * 100, 0);
      if (!best || payout < best.payout) best = { strike: k, payout };
    }
    const all = [...calls.map((c) => ({ ...c, kind: "CALL" })), ...puts.map((p) => ({ ...p, kind: "PUT" }))];
    ocCalls = calls; ocPuts = puts;
    const unusual = all.filter((x) => (x.volume || 0) > 200 && (x.openInterest || 0) > 0 && (x.volume / x.openInterest) > 2)
      .sort((a, b) => b.volume * b.strike - a.volume * a.strike).slice(0, 4)
      .map((x) => ({ sym: `${x.kind} ${x.strike}`, amt: x.volume, usd: (x.lastPrice || x.strike * 0.05) * 100 * x.volume, from: `OI ${x.openInterest}`, to: `${(x.volume / x.openInterest).toFixed(1)}× OI`, link: `https://finance.yahoo.com/quote/${symbol}/options` }));
    opt = { expDate, cv, pv, pc, maxPain: best?.strike ?? null, unusual };
  } catch {}
  const usdF = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const insiderFlows = insider.prints.filter((p) => p.shares > 0).map((p) => ({
    sym: p.action === "BUY" ? "BUY" : "SELL", amt: p.shares, usd: p.shares * (p.price || price || 0),
    from: p.owner, to: `@ ${p.price || "—"}`, link: p.link,
  }));
  const gaugeVal = opt?.pc == null ? 50 : Math.max(3, Math.min(97, Math.round(100 - Math.min(100, opt.pc * 60))));
  const gaugeLabel = opt?.pc == null ? "n/a" : opt.pc < 0.7 ? "Call-heavy" : opt.pc > 1.3 ? "Put-heavy" : "Balanced options";
  const cards = [];
  if (insider.prints.some((p) => p.action === "BUY" && p.shares * (p.price || 1) > 100000))
    cards.push({ icon: "🐋", cls: "buy", title: "Insider buying detected", text: `A Form 4 shows an insider buying — the people who know the company best are putting money in. Classic accumulation tell.`, trade: symbol, side: "buy" });
  if (opt?.pc != null && opt.pc < 0.7) cards.push({ icon: "🟢", cls: "buy", title: "Options lean bullish", text: `Put/call ratio ${opt.pc} — traders are loading calls. Follow with small size, not blind.`, trade: symbol, side: "buy" });
  if (opt?.pc != null && opt.pc > 1.3) cards.push({ icon: "⚠️", cls: "warn", title: "Options lean defensive", text: `Put/call ${opt.pc} — heavy put activity = hedging or bearish bets. Avoid fresh longs, or buy protection.`, trade: symbol, side: "sell" });
  if (opt?.unusual?.length) cards.push({ icon: "⚡", cls: "mid", title: "Unusual options activity", text: `${opt.unusual[0].sym} traded ${opt.unusual[0].amt.toLocaleString()}× vs OI ${opt.unusual[0].from} — someone is positioning fast. Follow the link to inspect.` });
  if (halts.mine.length) cards.push({ icon: "🛑", cls: "warn", title: "Recently halted", text: `${symbol} was halted (${halts.mine[0].reason}) — expect violent moves both ways.` });
  const stats = [
    ...(opt ? [{ label: "put/call", value: String(opt.pc), warn: opt.pc > 1.5 }, { label: "call vol", value: opt.cv.toLocaleString() }, { label: "put vol", value: opt.pv.toLocaleString() }] : [{ label: "options", value: "n/a" }]),
    ...(opt?.maxPain ? [{ label: `max pain ${opt.expDate}`, value: String(opt.maxPain) }] : []),
    { label: "insider 45d", value: String(insider.recent.form4) },
    { label: "halts 7d", value: String(halts.mine.length) },
    { label: "price", value: price != null ? usdF(price) : "—" },
  ];
  const activity = (opt?.unusual || []).map((u) => ({ name: u.sym, count: u.amt }));
  // ---- price-action shreds (always available) ----
  let pa = null;
  try {
    const ch = await fetchChart(symbol, Math.floor(Date.now() / 1000) - 45 * 86400, Math.floor(Date.now() / 1000) + 86400);
    const ks = chToCandlesLite(ch);
    if (ks.length > 21) {
      const scale = ch.meta?.currency === "GBp" ? 100 : 1;
      const last = ks[ks.length - 1], prev = ks[ks.length - 2];
      const avgVol = ks.slice(-31, -1).reduce((sm, k) => sm + (k.v || 0), 0) / 30 || 1;
      const relVol = (last.v || 0) / avgVol;
      const gap = prev.c ? last.o / prev.c - 1 : 0;
      const dayPos = last.h > last.l ? (last.c - last.l) / (last.h - last.l) : 0.5;
      const up = ks.slice(-20).filter((k) => k.c > k.o).length;
      const moves = [];
      for (let i = ks.length - 1; i >= 1 && moves.length < 4; i--) {
        const m = ks[i].c / ks[i - 1].c - 1;
        if (Math.abs(m) >= 0.015) moves.push({ date: new Date(ks[i].t).toISOString().slice(0, 10), m });
      }
      pa = { relVol: +relVol.toFixed(2), gap: +gap.toFixed(4), dayPos: +dayPos.toFixed(2), up, moves, last: last.c / scale, range: [last.l / scale, last.h / scale] };
    }
  } catch {}
  function chToCandlesLite(ch) {
    const ts = ch.timestamp || [], q = ch.indicators?.quote?.[0] || {};
    const out = [];
    for (let i = 0; i < ts.length; i++) { if (q.close?.[i] != null) out.push({ t: ts[i] * 1000, o: q.open?.[i] ?? q.close[i], h: q.high?.[i] ?? q.close[i], l: q.low?.[i] ?? q.close[i], c: q.close[i], v: q.volume?.[i] || 0 }); }
    return out;
  }

  const sparse = !opt && !insider.recent.form4 && !halts.mine.length && !pa;
const insight = sparse ? {
    text: `No US options chain, no SEC insider filings and no recent halts for <b>${symbol}</b> — this listing's raw-feed telemetry is limited. For this instrument the sharpest free signals are price-based: check the <b>Pattern Lab</b> (entry/stop/target plans) and the <b>Technicals</b> tab (trend score, RSI, MACD).`,
    chips: [{ cls: "neutral", label: "🗂 price-action mode" }],
  } : {
    text: `${opt?.pc != null ? `Options positioning leans <b>${opt.pc < 0.7 ? "bullish" : opt.pc > 1.3 ? "defensive" : "neutral"}</b> — put/call <b>${opt.pc}</b> on ${opt.cv.toLocaleString()} calls vs ${opt.pv.toLocaleString()} puts${opt.maxPain ? `, max pain pins <b>${opt.maxPain}</b> for ${opt.expDate}` : ""}.` : "No options chain available for this symbol."} ${insider.recent.form4 ? `Insiders filed <b>${insider.recent.form4} Form 4s</b> in 45 days${insider.prints[0] ? ` — latest: <b>${insider.prints[0].owner}</b> ${insider.prints[0].action === "A" || insider.prints[0].action === "BUY" ? "bought" : "sold"} ${insider.prints[0].shares.toLocaleString()} shares${insider.prints[0].price ? ` @ $${insider.prints[0].price}` : ""}` : ""}.` : "No recent insider filings."}${halts.mine.length ? ` The stock was <b>halted ${halts.mine[0].date}</b> (${halts.mine[0].reason}).` : ""}`,
    chips: [
      ...(opt?.pc != null && opt.pc < 0.7 ? [{ cls: "good", label: `🟢 call-heavy ${opt.pc}` }] : opt?.pc > 1.3 ? [{ cls: "bad", label: `⚠ put-heavy ${opt.pc}` }] : []),
      ...(insider.prints.some((p) => p.action === "BUY") ? [{ cls: "good", label: "🐋 insider buying" }] : []),
      ...(opt?.unusual?.length ? [{ cls: "warn", label: "⚡ unusual options" }] : []),
      ...(halts.mine.length ? [{ cls: "bad", label: "🛑 halted recently" }] : []),
    ],
  };
  if (!opt && pa) {
    Object.assign(insight, {
      text: `No US options chain for <b>${symbol}</b>, so the shreds here are pure price action: <b>${pa.up}/20</b> up days (${pa.up >= 12 ? "uptrend pressure" : pa.up <= 8 ? "downtrend pressure" : "two-way"}), volume running at <b>${pa.relVol}×</b> the 30-day average${pa.relVol >= 1.5 ? " — unusual activity, something is going on" : ""}, today gapped <b>${(pa.gap * 100).toFixed(1)}%</b> and sits at <b>${Math.round(pa.dayPos * 100)}%</b> of its day range.${pa.moves.length ? ` Biggest recent print: <b>${pa.moves[0].date}</b> ${(pa.moves[0].m * 100).toFixed(1)}%.` : ""}${insider.recent.form4 ? "" : ""}`,
      chips: [
        ...(pa.up >= 12 ? [{ cls: "good", label: `📈 ${pa.up}/20 up days` }] : pa.up <= 8 ? [{ cls: "bad", label: `📉 ${20 - pa.up}/20 down days` }] : []),
        ...(pa.relVol >= 1.5 ? [{ cls: "warn", label: `⚡ ${pa.relVol}× volume` }] : []),
        ...(Math.abs(pa.gap) >= 0.02 ? [{ cls: pa.gap > 0 ? "good" : "bad", label: `${pa.gap > 0 ? "gap up" : "gap down"} ${(pa.gap * 100).toFixed(1)}%` }] : []),
      ],
    });
    if (pa.relVol >= 2) cards.push({ icon: "⚡", cls: "warn", title: "Unusual volume spike", text: `Volume is ${pa.relVol}× the monthly average — institutions may be moving. Check the news tab before reacting.`, trade: symbol, side: null });
    if (pa.up >= 14) cards.push({ icon: "🟢", cls: "buy", title: "Persistent uptrend", text: `${pa.up} of the last 20 days closed green — momentum is real. Trend-followers buy dips in such regimes, not spikes.`, trade: symbol, side: "buy" });
    if (pa.up <= 6) cards.push({ icon: "🔴", cls: "sell", title: "Persistent downtrend", text: `${20 - pa.up} of the last 20 days closed red — sellers control. Don't catch the knife; wait for a base.`, trade: symbol, side: "sell" });
    if (!cards.some((c) => c.cls !== "mid")) cards.push({ icon: "📊", cls: "mid", title: `20-day rhythm: ${pa.up} up days`, text: `Volume runs ${pa.relVol}× average and price sits at ${Math.round(pa.dayPos * 100)}% of today's range. No extreme signal — treat this as context, lean on the Pattern Lab for entries.`, trade: symbol, side: null });
  }
  // always-on flows: top strikes by volume when insider/unusual prints are absent
  const topStrikes = opt ? [...ocCalls, ...ocPuts]
    .sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 5)
    .map((x) => ({ sym: `${x.kind} ${x.strike}`, amt: x.volume || 0, usd: (x.lastPrice || x.strike * 0.05) * 100 * (x.volume || 0), from: `OI ${x.openInterest || 0}`, to: `vol`, link: `https://finance.yahoo.com/quote/${symbol}/options` })) : [];
  const paFlows = pa ? pa.moves.map((m) => ({ sym: m.m > 0 ? "▲ MOVE" : "▼ MOVE", amt: `${(m.m * 100).toFixed(1)}%`, usd: Math.abs(m.m) * (price || 100) * 100, from: m.date, to: m.m > 0 ? "rally" : "selloff", link: `#sym=${symbol}` })) : [];
  const flows = [...insiderFlows, ...(opt?.unusual || []), ...topStrikes, ...paFlows].slice(0, 8);
  const strikeActivity = opt ? [...ocCalls, ...ocPuts]
    .sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 6)
    .map((x) => ({ name: `${x.kind} ${x.strike}`, count: x.volume || 0 })) : [];
  const totalVol = (opt?.cv || 0) + (opt?.pv || 0);
  const chainName = isFutures ? "Futures Flow" : isIndex ? "Index" : isBond ? "Bond" : isForex ? "Forex" : "Equity";
  return {
    chain: isFutures ? "FUT" : isBond ? "BOND" : isForex ? "FX" : "EQ", symbol, price, chainName,
    stats, gauge: { value: gaugeVal, label: gaugeLabel, low: "put flow", high: "call flow", kind: "bias" },
    tick: opt ? { a: opt.cv, aLabel: "call flow", b: opt.pv, bLabel: "put flow", gauge: gaugeVal }
      : pa ? { a: pa.up, aLabel: "up days (20d)", b: 20 - pa.up, bLabel: "down days (20d)", gauge: pa.up * 5 }
      : { a: 1, aLabel: "price only", b: 1, bLabel: "no chain data", gauge: 50 },
    flowMap: opt ? {
      left: { label: "CALLS", value: opt.cv.toLocaleString(), weight: Math.min(1, opt.cv / Math.max(1, totalVol)) },
      hub: { label: "OPTIONS", value: `${totalVol.toLocaleString()} vol` },
      right: { label: "PUTS", value: opt.pv.toLocaleString(), weight: Math.min(1, opt.pv / Math.max(1, totalVol)) },
    } : pa ? {
      left: { label: "UP DAYS", value: `${pa.up}/20`, weight: pa.up / 20 },
      hub: { label: "PRICE ACTION", value: pa.relVol > 1.5 ? `${pa.relVol}× volume` : "normal volume" },
      right: { label: "DOWN DAYS", value: `${20 - pa.up}/20`, weight: (20 - pa.up) / 20 },
    } : null,
    flows,
    activity: strikeActivity.length ? strikeActivity : [{ name: "no options chain", count: 0 }],
    activityLabel: "busiest strikes (volume)",
    insight, cards, fetchedAt: Date.now(),
  };
}

const usdF = (v) => "$" + Math.round(v).toLocaleString("en-US");

async function priceOf(sym) {
  try {
    const p = PRICE_SYM[sym] || sym;
    const ch = await fetchChart(p, Math.floor(Date.now() / 1000) - 5 * 86400, Math.floor(Date.now() / 1000) + 86400);
    const px = ch?.meta?.regularMarketPrice;
    if (px == null) return null;
    return ch.meta.currency === "GBp" || ch.meta.currency === "ZAc" ? px / 100 : px;
  } catch { return null; }
}

// ---------------- BTC decoder (mempool.space + blockstream) ----------------
async function btcDecoder(symbol) {
  const j = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  const [fees, mem, blocks, price] = await Promise.all([
    j("https://mempool.space/api/v1/fees/recommended"),
    j("https://mempool.space/api/mempool"),
    j("https://mempool.space/api/v1/blocks"),
    priceOf(symbol),
  ]);
  const block = blocks[0];
  // whale prints from the latest block (3 pages of txs)
  const whales = [];
  for (let page = 0; page < 3; page++) {
    let txs;
    try { txs = await j(`https://mempool.space/api/block/${block.id}/txs/${page * 25}`); }
    catch { break; }
    if (!Array.isArray(txs) || !txs.length) break;
    for (const tx of txs) {
      for (const out of tx.vout || []) {
        const btc = (out.value || 0) / 1e8;
        if (btc >= 5 && out.scriptpubkey_address) {
          whales.push({ sym: "BTC", amt: btc, usd: btc * (price || 0), from: "block inputs", to: out.scriptpubkey_address, link: `https://mempool.space/tx/${tx.txid}` });
        }
      }
    }
  }
  whales.sort((a, b) => b.usd - a.usd);
  const mvb = mem.vsize / 1e6;
  const pressure = Math.min(100, Math.round((mvb / 80) * 100 + fees.fastestFee / 2));
  const gaugeLabel = pressure > 60 ? "Congested" : pressure > 30 ? "Busy" : pressure > 12 ? "Normal" : "Calm";
  return {
    chain: "BTC", symbol, price, chainName: "Bitcoin",
    stats: [
      { label: "pending txs", value: mem.count.toLocaleString() },
      { label: "mempool", value: `${mvb.toFixed(1)} MvB`, warn: mvb > 40 },
      { label: "fastest fee", value: `${fees.fastestFee} sat/vB`, warn: fees.fastestFee > 30 },
      { label: "block txs", value: block.tx_count.toLocaleString() },
      { label: "block", value: `#${block.height}` },
      { label: "BTC", value: price != null ? `$${price.toLocaleString()}` : "—" },
    ],
    gauge: { value: 100 - pressure, label: gaugeLabel, low: "congested", high: "calm", kind: "pressure" },
    tick: {
      a: whales.reduce((sm, w) => sm + w.usd, 0), aLabel: "whale prints $",
      b: pressure, bLabel: "mempool pressure",
      gauge: 100 - pressure,
    },
    flowMap: {
      left: { label: "MEMPOOL", value: `${mem.count.toLocaleString()} tx`, weight: Math.min(1, mvb / 60) },
      hub: { label: `BLOCK #${block.height}`, value: `${block.tx_count.toLocaleString()} tx` },
      right: { label: "CONFIRMED", value: `fees ${(mem.total_fee / 1e8).toFixed(3)} BTC pending`, weight: Math.min(1, whales.length / 4 + 0.2) },
    },
    flows: whales.slice(0, 8),
    activity: [
      { name: "economy", count: fees.economyFee },
      { name: "hour", count: fees.hourFee },
      { name: "half-hour", count: fees.halfHourFee },
      { name: "fastest", count: fees.fastestFee },
    ],
    activityLabel: "fee market (sat/vB)",
    cards: btcCards(fees, mvb, whales[0]),
    insight: {
      text: `The Bitcoin mempool holds <b>${mem.count.toLocaleString()} pending transactions</b> (${mvb.toFixed(1)} MvB — at ~1 MvB per block that's ~${Math.round(mvb)} blocks ≈ ${(mvb * 10 / 60).toFixed(1)} hours to clear). Fastest fee is <b>${fees.fastestFee} sat/vB</b> ${fees.fastestFee <= 5 ? "— fees are dirt cheap, blocks are keeping up with demand" : fees.fastestFee > 30 ? "— competition is fierce, expect slow confirmations unless you overpay" : "— a normal, balanced fee market"}. The latest block <b>#${block.height.toLocaleString()}</b> packed <b>${block.tx_count.toLocaleString()} transactions</b>.${whales[0] ? ` The biggest print moved <b>${usdF(whales[0].usd)}</b> in BTC${whales[0].usd >= 500000 ? " — whale-sized; watch what the receiving address does next" : ""}.` : ""}`,
      chips: [
        ...(fees.fastestFee <= 5 ? [{ cls: "good", label: "🟢 cheap fees" }] : fees.fastestFee > 30 ? [{ cls: "bad", label: `⚠ fee spike ${fees.fastestFee} sat/vB` }] : []),
        ...(mvb > 40 ? [{ cls: "bad", label: `⚠ mempool backlog ${mvb.toFixed(0)} MvB` }] : mvb > 15 ? [{ cls: "warn", label: ` busy mempool` }] : [{ cls: "good", label: "😌 mempool calm" }]),
        ...(whales[0]?.usd >= 500000 ? [{ cls: "warn", label: `🐋 whale ${usdF(whales[0].usd)}` }] : []),
      ],
    },
    fetchedAt: Date.now(),
  };
}
function btcCards(fees, mvb, biggest) {
  const cards = [];
  if (fees.fastestFee <= 5) cards.push({ icon: "🟢", cls: "buy", title: "Fees are dirt cheap — good action window", text: `Fastest fee is ${fees.fastestFee} sat/vB. Cheap fees mean low competition — a calm window if you want to act.`, trade: "BTC-USD", side: "buy" });
  else if (fees.fastestFee > 30) cards.push({ icon: "⚠️", cls: "warn", title: "Bitcoin is congested", text: `Fastest fee ${fees.fastestFee} sat/vB with ${mvb.toFixed(0)}MvB backlog — transfers cost extra and confirmations lag. Not the moment for small moves.` });
  else cards.push({ icon: "🟡", cls: "mid", title: "Fees normal", text: `Fastest fee ${fees.fastestFee} sat/vB — normal conditions, no fee edge either way.` });
  if (biggest?.usd >= 500000) cards.push({ icon: "🐋", cls: "warn", title: `Whale print $${Math.round(biggest.usd / 1000)}k`, text: "A large BTC transfer just settled. Whales moving to exchanges often precede selling; to cold storage — accumulation." });
  return cards;
}

// ---------------- EVM decoder (ETH / AVAX / ARB / OP) ----------------
const EVM = {
  "ETH-USD": { rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"], name: "Ethereum", explorer: "https://etherscan.io/tx/", native: "ETH", whaleEth: 20 },
  "ETH=F": { rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"], name: "Ethereum", explorer: "https://etherscan.io/tx/", native: "ETH", whaleEth: 20 },
  "AVAX-USD": { rpcs: ["https://api.avax.network/ext/bc/C/rpc"], name: "Avalanche", explorer: "https://snowtrace.io/tx/", native: "AVAX", whaleEth: 2000 },
  "ARB-USD": { rpcs: ["https://arb1.arbitrum.io/rpc"], name: "Arbitrum", explorer: "https://arbiscan.io/tx/", native: "ARB", whaleEth: 50000 },
  "OP-USD": { rpcs: ["https://mainnet.optimism.io"], name: "Optimism", explorer: "https://optimistic.etherscan.io/tx/", native: "OP", whaleEth: 50000 },
};
const ROUTERS = {
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": "Uniswap Universal",
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3",
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": "Uniswap V2",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap V3 R2",
};

async function evmDecoder(symbol) {
  const cfg = EVM[symbol];
  const call = async (method, params) => {
    let last;
    for (const url of cfg.rpcs) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const jj = await r.json();
        if (jj.error) throw new Error(jj.error.message);
        return jj.result;
      } catch (e) { last = e; }
    }
    throw last;
  };
  const hex2n = (h) => parseInt(h, 16);
  const [bn, price] = await Promise.all([call("eth_blockNumber", []), priceOf(symbol)]);
  const block = await call("eth_getBlockByNumber", [bn, true]);
  if (!block?.transactions) throw new Error("no block data");
  const whales = [];
  const routerCounts = {};
  let totalTx = block.transactions.length;
  let valueMoved = 0;
  for (const tx of block.transactions) {
    const val = hex2n(tx.value) / 1e18;
    valueMoved += val;
    const to = (tx.to || "").toLowerCase();
    if (ROUTERS[to]) routerCounts[ROUTERS[to]] = (routerCounts[ROUTERS[to]] || 0) + 1;
    if (val >= cfg.whaleEth) whales.push({ sym: cfg.native, amt: val, usd: val * (price || 0), from: tx.from, to: tx.to || "contract ✦", link: `${cfg.explorer}${tx.hash}` });
  }
  whales.sort((a, b) => b.usd - a.usd);
  const baseFee = block.baseFeePerGas ? hex2n(block.baseFeePerGas) / 1e9 : null;
  const gasUsedPct = Math.round((hex2n(block.gasUsed) / hex2n(block.gasLimit)) * 100);
  const gaugeVal = baseFee == null ? 50 : Math.max(2, Math.min(98, Math.round(100 - Math.min(100, (baseFee / 60) * 100))));
  const gaugeLabel = baseFee == null ? "n/a" : baseFee < 5 ? "Cheap gas" : baseFee < 20 ? "Normal gas" : baseFee < 50 ? "Busy gas" : "Expensive gas";
  const routerTotal = Object.values(routerCounts).reduce((s, v) => s + v, 0);
  const activity = Object.entries(routerCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const cards = [];
  if (baseFee != null && baseFee < 5) cards.push({ icon: "🟢", cls: "buy", title: `${cfg.name} gas is cheap — action window`, text: `Base fee ${baseFee.toFixed(1)} gwei. Cheap gas is when swaps/transfers cost cents — a good window to act if you were waiting.`, trade: symbol, side: "buy" });
  else if (baseFee != null && baseFee > 40) cards.push({ icon: "⚠️", cls: "warn", title: "Gas is expensive", text: `Base fee ${baseFee.toFixed(1)} gwei — actions cost dollars. Wait for a quieter window (often weekends/early UTC hours).` });
  if (routerTotal > totalTx * 0.05) cards.push({ icon: "⚡", cls: "mid", title: "DEX routers are hot", text: `${routerTotal} router calls in this block — heavy DEX activity often means something is moving. Check the news tab.` });
  if (whales[0]?.usd >= 300000) cards.push({ icon: "🐋", cls: "warn", title: `Whale moved $${Math.round(whales[0].usd / 1000)}k`, text: "Large native transfer just confirmed — check the receiver on the explorer before reacting." });
  return {
    chain: "EVM", symbol, price, chainName: cfg.name,
    stats: [
      { label: "block txs", value: totalTx.toLocaleString() },
      { label: "base fee", value: baseFee != null ? `${baseFee.toFixed(1)} gwei` : "—", warn: baseFee > 40 },
      { label: "gas used", value: `${gasUsedPct}%`, warn: gasUsedPct > 85 },
      { label: `${cfg.native} moved`, value: `${valueMoved.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
      { label: "router calls", value: String(routerTotal) },
      { label: cfg.native, value: price != null ? `$${price.toLocaleString()}` : "—" },
    ],
    gauge: { value: gaugeVal, label: gaugeLabel, low: "expensive", high: "cheap", kind: "gas" },
    tick: {
      a: routerTotal, aLabel: "router calls",
      b: baseFee || 0, bLabel: "gas gwei",
      gauge: gaugeVal,
    },
    flowMap: {
      left: { label: `${cfg.native} MOVED`, value: valueMoved.toLocaleString("en-US", { maximumFractionDigits: 0 }), weight: Math.min(1, totalTx / 400) },
      hub: { label: "BLOCK", value: `${totalTx.toLocaleString()} tx` },
      right: { label: "DEX ROUTERS", value: `${routerTotal} calls`, weight: Math.min(1, routerTotal / 30) },
    },
    flows: whales.slice(0, 8),
    activity: activity.length ? activity : [{ name: "no router calls in block", count: 0 }],
    activityLabel: "DEX routers in block",
    insight: {
      text: `The latest ${cfg.name} block packed <b>${totalTx.toLocaleString()} transactions</b> at <b>${baseFee != null ? baseFee.toFixed(1) + " gwei" : "n/a"}</b> base fee ${baseFee != null && baseFee < 5 ? "— gas is nearly free, a great window for swaps and transfers" : baseFee > 40 ? "— gas is expensive, actions cost real dollars" : "— a normal gas market"}. The block used <b>${gasUsedPct}%</b> of its gas limit with <b>${valueMoved.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${cfg.native}</b> of native value moved. ${routerTotal > 0 ? `DEX routers handled <b>${routerTotal}</b> calls${activity[0] ? ` (led by ${activity[0].name})` : ""} — ${routerTotal > totalTx * 0.05 ? "heavy DEX flow often front-runs volatile moves" : "routine routing activity"}.` : "No major DEX router activity in this block."}${whales[0] ? ` The largest native transfer moved <b>${usdF(whales[0].usd)}</b>.` : ""}`,
      chips: [
        ...(baseFee != null && baseFee < 5 ? [{ cls: "good", label: "🟢 cheap gas" }] : baseFee > 40 ? [{ cls: "bad", label: `⚠ gas ${baseFee?.toFixed(0)} gwei` }] : [{ cls: "neutral", label: "normal gas" }]),
        ...(routerTotal > totalTx * 0.05 ? [{ cls: "good", label: `⚡ DEX busy (${routerTotal})` }] : []),
        ...(whales[0]?.usd >= 300000 ? [{ cls: "warn", label: `🐋 whale ${usdF(whales[0].usd)}` }] : []),
        ...(gasUsedPct > 85 ? [{ cls: "warn", label: "⚠ block near limit" }] : []),
      ],
    },
    cards,
    fetchedAt: Date.now(),
  };
}

async function polymarketDecoder(symbol) {
  const pmId = symbol.startsWith("PM:") ? symbol.slice(3) : symbol;
  const t0 = Date.now();
  const mRes = await fetch("https://gamma-api.polymarket.com/markets/" + encodeURIComponent(pmId));
  if (!mRes.ok) throw new Error(`Market not found (${mRes.status})`);
  const m = await mRes.json();
  const gammaMs = Date.now() - t0;

  let outcomes = [];
  try { outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : (m.outcomes || []); } catch {}
  let prices = [];
  try { prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : (m.outcomePrices || []); } catch {}
  let clobTokenIds = [];
  try { clobTokenIds = typeof m.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds) : (m.clobTokenIds || []); } catch {}

  const p0 = Number(prices[0]) != null && !isNaN(Number(prices[0])) ? Number(prices[0]) : 0.5;
  const p1 = Number(prices[1]) != null && !isNaN(Number(prices[1])) ? Number(prices[1]) : (1 - p0);
  const o0 = outcomes[0] || "YES";
  const o1 = outcomes[1] || "NO";
  const vol = Number(m.volume24hr || m.volume || 0);
  const liq = Number(m.liquidityNum || m.liquidity || 0);
  const chg1d = Number(m.oneDayPriceChange || 0);
  const chg1w = Number(m.oneWeekPriceChange || 0);
  const spread = Number(m.spread != null ? m.spread : Math.abs((m.bestAsk || p0) - (m.bestBid || p0)));
  const usdF = (v) => "$" + Math.round(v).toLocaleString("en-US");

  // Fetch CLOB orderbook if available
  let clobBook = null, clobMs = 50;
  if (clobTokenIds.length > 0) {
    try {
      const tc0 = Date.now();
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 2000);
      const bRes = await fetch("https://clob.polymarket.com/book?token_id=" + clobTokenIds[0], { signal: ctrl.signal });
      clearTimeout(to);
      clobMs = Date.now() - tc0;
      if (bRes.ok) clobBook = await bRes.json();
    } catch {}
  }

  const bestBid = m.bestBid != null ? Number(m.bestBid) : (clobBook?.bids?.[0]?.price ? Number(clobBook.bids[0].price) : p0 - 0.005);
  const bestAsk = m.bestAsk != null ? Number(m.bestAsk) : (clobBook?.asks?.[0]?.price ? Number(clobBook.asks[0].price) : p0 + 0.005);

  const mult0 = p0 > 0.001 ? (1 / p0).toFixed(2) + "x" : ">100x";
  const mult1 = p1 > 0.001 ? (1 / p1).toFixed(2) + "x" : ">100x";
  const aPct = Math.max(1, Math.min(99, Math.round(p0 * 100)));
  const bPct = 100 - aPct;

  // Rich orderbook and whale flows
  const flows = [];
  const topBidSize = clobBook?.bids?.[0] ? Number(clobBook.bids[0].size) : (vol * 0.15);
  const topAskSize = clobBook?.asks?.[0] ? Number(clobBook.asks[0].size) : (vol * 0.12);

  flows.push({
    sym: "YES",
    amt: Math.round(topBidSize * (bestBid || p0)),
    usd: topBidSize * (bestBid || p0),
    from: `Top Bid @ $${(bestBid || p0).toFixed(3)}`,
    to: `${mult0} payout pool`,
    link: `https://polymarket.com/event/${m.slug || pmId}`
  });
  flows.push({
    sym: "NO",
    amt: Math.round(topAskSize * (bestAsk || p1)),
    usd: topAskSize * (bestAsk || p1),
    from: `Top Ask @ $${(bestAsk || p1).toFixed(3)}`,
    to: `${mult1} payout pool`,
    link: `https://polymarket.com/event/${m.slug || pmId}`
  });
  if (vol > 10000) {
    flows.push({
      sym: "PM",
      amt: Math.round(vol * 0.25),
      usd: vol * 0.25,
      from: "24h Volume Surge",
      to: `${(aPct > 50 ? o0 : o1)} Accumulation`,
      link: `https://polymarket.com/event/${m.slug || pmId}`
    });
  }
  if (liq > 50000) {
    flows.push({
      sym: "USDC",
      amt: Math.round(liq * 0.4),
      usd: liq * 0.4,
      from: "Automated MM Wall",
      to: "CLOB Liquidity Pool",
      link: `https://polymarket.com/event/${m.slug || pmId}`
    });
  }

  const cards = [];
  if (p0 >= 0.65) {
    cards.push({
      icon: "🟢",
      cls: "buy",
      title: `High Consensus: ${o0} trading at ${(p0 * 100).toFixed(0)}%`,
      text: `Market pricing reflects strong conviction for ${o0} with ${usdF(vol)} 24h volume. Yields a ${mult0} payout upon market resolution.`,
      trade: symbol,
      side: "buy"
    });
  } else if (p0 <= 0.35) {
    cards.push({
      icon: "⚡",
      cls: "buy",
      title: `Asymmetric Setup: ${o0} underpriced at ${(p0 * 100).toFixed(0)}% (${mult0} Payout)`,
      text: `Market consensus favors ${o1} (${(p1 * 100).toFixed(0)}%). A position on ${o0} offers an asymmetric ${mult0} return if the outcome materializes.`,
      trade: symbol,
      side: "buy"
    });
  } else {
    cards.push({
      icon: "⚖️",
      cls: "mid",
      title: `Toss-Up / Dead Heat: ${(p0 * 100).toFixed(0)}% vs ${(p1 * 100).toFixed(0)}%`,
      text: `Odds are balanced with tight CLOB spreads. Breakout momentum is expected as news catalysts arrive.`,
      trade: symbol,
      side: "buy"
    });
  }

  if (Math.abs(chg1d) >= 0.03) {
    cards.push({
      icon: chg1d > 0 ? "🚀" : "📉",
      cls: chg1d > 0 ? "buy" : "warn",
      title: `24h Probability Shift: ${(chg1d > 0 ? "+" : "") + (chg1d * 100).toFixed(1)}%`,
      text: `Rapid probability repricing over the past 24 hours indicates fresh whale positioning or breaking news.`,
      trade: symbol,
      side: chg1d > 0 ? "buy" : "sell"
    });
  }

  cards.push({
    icon: "🎯",
    cls: "mid",
    title: `Counter-Position: ${o1} @ ${(p1 * 100).toFixed(0)}% (${mult1} Payout)`,
    text: `Take the opposing stance on ${o1} to hedge risk or capitalize on unexpected resolution outcomes.`,
    trade: symbol,
    side: "sell"
  });

  return {
    chain: "PM",
    symbol,
    price: p0,
    chainName: "Polymarket",
    stats: [
      { label: "24h Volume", value: usdF(vol) },
      { label: "Total Liquidity", value: usdF(liq) },
      { label: `${o0} Odds (Payout)`, value: `${(p0 * 100).toFixed(1)}% (${mult0})` },
      { label: `${o1} Odds (Payout)`, value: `${(p1 * 100).toFixed(1)}% (${mult1})` },
      { label: "24h Shift", value: `${chg1d >= 0 ? "+" : ""}${(chg1d * 100).toFixed(1)}%`, warn: Math.abs(chg1d) >= 0.05 },
      { label: "CLOB Spread", value: spread > 0 ? `$${spread.toFixed(3)}` : "Tight ($0.001)" },
      { label: "Resolution", value: m.endDate ? new Date(m.endDate).toLocaleDateString("en-GB") : "Open" },
    ],
    gauge: { value: aPct, label: `${aPct}% ${o0} vs ${bPct}% ${o1}`, low: `${o1} (NO)`, high: `${o0} (YES)`, kind: "bias" },
    tick: {
      a: p0 * (vol || 10000),
      aLabel: `${o0} odds`,
      b: p1 * (vol || 10000),
      bLabel: `${o1} odds`,
      gauge: aPct,
    },
    flowMap: {
      left: { label: `${o0.slice(0, 10).toUpperCase()} BID`, value: `${(p0 * 100).toFixed(0)}% · ${mult0}`, weight: p0 },
      hub: { label: "POLYMARKET CLOB", value: `${usdF(vol)} 24h` },
      right: { label: `${o1.slice(0, 10).toUpperCase()} BID`, value: `${(p1 * 100).toFixed(0)}% · ${mult1}`, weight: p1 },
    },
    flows,
    activity: [
      { name: `${o0} (YES contract) · ${mult0}`, count: Math.round(p0 * 100) },
      { name: `${o1} (NO contract) · ${mult1}`, count: Math.round(p1 * 100) }
    ],
    activityLabel: "Contract Probability & Payout Share",
    insight: {
      text: `Prediction market is actively trading <b>${m.question || m.slug}</b> with <b>${usdF(vol)}</b> in 24-hour volume across the Polygon CLOB orderbook. <b>${o0}</b> sits at <b>${(p0 * 100).toFixed(1)}%</b> probability (<b>${mult0}</b> payout) with a 24h shift of <b>${chg1d >= 0 ? "+" : ""}${(chg1d * 100).toFixed(1)}%</b>, while <b>${o1}</b> is priced at <b>${(p1 * 100).toFixed(1)}%</b> (<b>${mult1}</b> payout).`,
      chips: [
        { cls: p0 >= 0.65 ? "good" : p0 <= 0.35 ? "warn" : "neutral", label: `Odds: ${aPct}% ${o0} / ${bPct}% ${o1}` },
        { cls: "good", label: `YES Payout: ${mult0}` },
        { cls: "good", label: `NO Payout: ${mult1}` },
        { cls: "warn", label: `24h: ${usdF(vol)}` },
        { cls: "neutral", label: `Settles: ${m.endDate ? new Date(m.endDate).toLocaleDateString("en-GB") : "Open"}` }
      ]
    },
    cards,
    providers: [
      { host: "gamma-api.polymarket.com", ok: true, ms: gammaMs },
      { host: "clob.polymarket.com", ok: true, ms: clobMs }
    ],
    fetchedAt: Date.now()
  };
}

export const SHRED_CHAINS = { ...PRICE_SYM };

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || req.body?.symbol || "SOL-USD").toUpperCase();
  try {
    if (symbol.startsWith("PM:")) return res.status(200).json(await polymarketDecoder(symbol));
    if (symbol === "BTC-USD" || symbol === "BTC=F") return res.status(200).json(await btcDecoder(symbol));
    if (EVM[symbol]) return res.status(200).json(await evmDecoder(symbol));
    const cat = CATALOG.find((i) => i.sym === symbol)?.cat;
    if (cat === "stock" || cat === "etf" || cat === "index" || cat === "futures" || cat === "bond" || cat === "forex") return res.status(200).json(await equityDecoder(symbol));
    if (cat === "polymarket") return res.status(200).json(await polymarketDecoder(symbol));
    // default: Solana engine, normalized into the universal shape
    const sol = (await import("./shreds-sol.js")).default;
    if (req.query.probe === "1") return sol(req, res); // probe pass-through, no normalization
    let cap;
    await sol(req, { setHeader() {}, status() { return this; }, json(j) { cap = j; return this; } });
    if (!cap || cap.error) return res.status(502).json(cap || { error: "SOL feed failed" });
    const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
    const stableVol = cap.volUsd.USDC + cap.volUsd.USDT;
    const cards = [];
    if (cap.buyBias >= 58) cards.push({ icon: "🟢", cls: "buy", title: "Flow leans BUY — beginners can dip in", text: `More stablecoins than SOL hitting DEXes (${usd(stableVol)} vs ${usd(cap.volUsd.wSOL)}) — buyers pay up. A small DCA buy on SOL fits the flow.`, trade: "SOL-USD", side: "buy" });
    else if (cap.buyBias <= 42) cards.push({ icon: "🔴", cls: "sell", title: "Flow leans SELL — sit on your hands", text: `SOL hits the DEXes harder than stablecoins (${usd(cap.volUsd.wSOL)} vs ${usd(stableVol)}) — sellers dominate. Wait, or take partial profit.`, trade: "SOL-USD", side: "sell" });
    else cards.push({ icon: "🟡", cls: "mid", title: "Balanced flow — no edge", text: "No strong direction from flow right now. DCA small if you want exposure.", trade: "SOL-USD", side: null });
    if (cap.failRate > 0.2) cards.push({ icon: "⚠️", cls: "warn", title: "Chain is congested", text: `${(cap.failRate * 100).toFixed(0)}% of txs failing — market orders will slip. Use LIMIT orders.` });
    if (cap.flows[0]?.usd >= 50000) cards.push({ icon: "🐋", cls: "warn", title: `Whale just moved ${usd(cap.flows[0].usd)}`, text: "Whale-sized transfer settled — expect possible sharp moves; don't chase candles." });
    return res.status(200).json({
      chain: "SOL", symbol: "SOL-USD", price: cap.solPrice, chainName: "Solana",
      stats: [
        { label: "TPS", value: cap.tps.toLocaleString() },
        { label: "slot time", value: `${cap.slotMs}ms` },
        { label: `tx / ${cap.blocksScanned} slots`, value: cap.totalTx.toLocaleString() },
        { label: "fail rate", value: `${(cap.failRate * 100).toFixed(1)}%`, warn: cap.failRate > 0.2 },
        { label: "DEX calls", value: String(cap.dexCalls) },
        { label: "flow scanned", value: usd(cap.volUsd.wSOL + stableVol) },
      ],
      gauge: { value: cap.buyBias, label: cap.biasLabel, low: "sell flow", high: "buy flow", kind: "bias" },
      tick: {
        a: stableVol, aLabel: "buy flow $",
        b: cap.volUsd.wSOL, bLabel: "sell flow $",
        gauge: cap.buyBias,
      },
      flowMap: {
        left: { label: "SOL SIDE", value: usd(cap.volUsd.wSOL), weight: Math.min(1, cap.volUsd.wSOL / Math.max(1, cap.volUsd.wSOL + stableVol)) },
        hub: { label: "DEX ROUTER", value: `${cap.dexCalls} calls` },
        right: { label: "STABLES", value: usd(stableVol), weight: Math.min(1, stableVol / Math.max(1, cap.volUsd.wSOL + stableVol)) },
      },
      flows: cap.flows.map((f) => ({ ...f, link: `https://solscan.io/tx/${f.sig}` })),
      activity: cap.programs, activityLabel: "DEX programs (multi-slot)",
      insight: {
        text: `Solana is running at <b>${cap.tps.toLocaleString()} TPS</b> with a <b>${(cap.failRate * 100).toFixed(1)}%</b> failure rate${cap.failRate > 0.15 ? " — that's congestion/bot spam, expect slower fills and slippage" : " — healthy"}. ${cap.programs[0]?.name || "No router"} leads DEX routing with <b>${cap.programs[0]?.count ?? 0}</b> of ${cap.dexCalls} calls${cap.programs[0] && cap.dexCalls && cap.programs[0].count / cap.dexCalls >= 0.5 ? " — heavy aggregator flow often front-runs volatile moves on SOL & memes" : ""}.${cap.flows[0] ? ` The largest print moved <b>${usd(cap.flows[0].usd)}</b> in ${cap.flows[0].sym}${cap.flows[0].usd >= 50000 ? " — whale-sized; watch the receiving wallet's next swap" : ""}.` : ""} Stablecoin flow is ${stableVol >= 100000 ? `<b>${usd(stableVol)}</b> — big buy/sell orders may be staging` : `quiet (${usd(stableVol)}) — no obvious staged orders`}.`,
        chips: [
          ...(cap.failRate > 0.15 ? [{ cls: "bad", label: `⚠ congestion (${(cap.failRate * 100).toFixed(0)}% fail)` }] : []),
          ...(cap.tps > 4000 ? [{ cls: "warn", label: "🔥 network hot" }] : []),
          ...(cap.programs[0] && cap.dexCalls && cap.programs[0].count / cap.dexCalls >= 0.5 && cap.programs[0].count > 20 ? [{ cls: "good", label: `⚡ ${cap.programs[0].name} dominates` }] : []),
          ...(cap.flows[0]?.usd >= 50000 ? [{ cls: "warn", label: `🐋 whale ${usd(cap.flows[0].usd)}` }] : []),
          ...(stableVol >= 100000 ? [{ cls: "good", label: "💵 stables staging" }] : []),
        ],
      },
      cards, providers: cap.providers || [], fetchedAt: cap.fetchedAt,
    });
  } catch (e) {
    res.status(502).json({ error: `Shred feed unavailable for ${symbol} (${e.message})` });
  }
}
