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
  const [price, insider, halts] = await Promise.all([
    priceOf(symbol),
    isIndex ? Promise.resolve({ prints: [], recent: { form4: 0, d13: 0, k8: 0 } }) : edgarInsider(symbol),
    haltsFeed(symbol),
  ]);
  // options flow
  let opt = null;
  try {
    const oc = await fetchOptions(symbol);
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
  const insight = {
    text: `${opt?.pc != null ? `Options positioning leans <b>${opt.pc < 0.7 ? "bullish" : opt.pc > 1.3 ? "defensive" : "neutral"}</b> — put/call <b>${opt.pc}</b> on ${opt.cv.toLocaleString()} calls vs ${opt.pv.toLocaleString()} puts${opt.maxPain ? `, max pain pins <b>${opt.maxPain}</b> for ${opt.expDate}` : ""}.` : "No options chain available for this symbol."} ${insider.recent.form4 ? `Insiders filed <b>${insider.recent.form4} Form 4s</b> in 45 days${insider.prints[0] ? ` — latest: <b>${insider.prints[0].owner}</b> ${insider.prints[0].action === "A" || insider.prints[0].action === "BUY" ? "bought" : "sold"} ${insider.prints[0].shares.toLocaleString()} shares${insider.prints[0].price ? ` @ $${insider.prints[0].price}` : ""}` : ""}.` : "No recent insider filings."}${halts.mine.length ? ` The stock was <b>halted ${halts.mine[0].date}</b> (${halts.mine[0].reason}).` : ""}`,
    chips: [
      ...(opt?.pc != null && opt.pc < 0.7 ? [{ cls: "good", label: `🟢 call-heavy ${opt.pc}` }] : opt?.pc > 1.3 ? [{ cls: "bad", label: `⚠ put-heavy ${opt.pc}` }] : []),
      ...(insider.prints.some((p) => p.action === "BUY") ? [{ cls: "good", label: "🐋 insider buying" }] : []),
      ...(opt?.unusual?.length ? [{ cls: "warn", label: "⚡ unusual options" }] : []),
      ...(halts.mine.length ? [{ cls: "bad", label: "🛑 halted recently" }] : []),
    ],
  };
  return {
    chain: "EQ", symbol, price, chainName: isIndex ? "Index" : "Equity",
    stats, gauge: { value: gaugeVal, label: gaugeLabel, low: "put flow", high: "call flow", kind: "bias" },
    flows: [...insiderFlows, ...(opt?.unusual || [])].slice(0, 8),
    activity: activity.length ? activity : [{ name: "no unusual contracts", count: 0 }],
    activityLabel: "unusual options (vol vs OI)",
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
    chain: "BTC", symbol, price,
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

export const SHRED_CHAINS = { ...PRICE_SYM };

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || req.body?.symbol || "SOL-USD").toUpperCase();
  try {
    if (symbol === "BTC-USD" || symbol === "BTC=F") return res.status(200).json(await btcDecoder(symbol));
    if (EVM[symbol]) return res.status(200).json(await evmDecoder(symbol));
    const cat = CATALOG.find((i) => i.sym === symbol)?.cat;
    if (cat === "stock" || cat === "etf" || cat === "index") return res.status(200).json(await equityDecoder(symbol));
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
