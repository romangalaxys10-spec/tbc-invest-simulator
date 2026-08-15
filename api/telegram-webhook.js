// Two-way interactive Telegram Bot webhook handler.
// Supports per-user Telegram bots with interactive commands:
// /start or /help   - Command reference & status
// /portfolio or /p  - Live equity, cash, open positions & unrealized P&L
// /price <SYM> or /q - Live quote, day change & valuation summary
// /radar            - Top high-strength market breakout alerts across universe
// /shreds <SYM>     - Real-time flow, buy/sell cans pressure, whale prints & insights

import { get } from "@vercel/blob";
import { CATALOG } from "../instruments.js";
import { fetchChart, chartToCandles } from "../lib/yahoo.js";

const KEY = (t) => `portfolios/${t}.json`;

function normalizeCurrency(cur, x) {
  if (cur === "GBp" || cur === "ZAc") return { currency: cur === "GBp" ? "GBP" : "ZAR", value: x / 100 };
  return { currency: cur, value: x };
}

function fmtMoney(num, ccy = "USD") {
  const symbol = ccy === "GEL" ? "₾" : ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : "$";
  const abs = Math.abs(num);
  return `${num < 0 ? "-" : ""}${symbol}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function sendTelegramMessage(botToken, chatId, text, keyboard = null) {
  const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (keyboard) body.reply_markup = keyboard;
  try {
    await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("sendTelegramMessage error:", e.message);
  }
}

async function handlePortfolioCommand(botToken, chatId, token) {
  if (!token) {
    return sendTelegramMessage(
      botToken,
      chatId,
      `⚠️ <b>No Cloud Token Attached</b>\n\nTo view your live portfolio and open positions, connect your Telegram bot in the TBC Invest Simulator under <b>Portfolio ➜ Multi-user Cloud Sync ➜ ✈ Telegram Bot</b>.`
    );
  }

  try {
    const blob = await get(KEY(token), { access: "private" });
    if (!blob || blob.statusCode === 404) {
      return sendTelegramMessage(botToken, chatId, `⚠️ No portfolio data found for cloud token <code>••••${token.slice(-4)}</code>.`);
    }
    const text = blob.blob instanceof Blob ? await blob.blob.text() : await new Response(blob.stream).text();
    const pf = JSON.parse(text);

    const positions = pf.positions || [];
    const cash = Number(pf.cash) || 0;
    const startEq = Number(pf.startEquity) || 100000;

    let posLines = [];
    let totalPosVal = 0;

    for (const p of positions.slice(0, 10)) {
      const sym = p.symbol;
      const units = p.units || 0;
      const entryPrice = p.entryPrice || 0;
      const isShort = units < 0;
      const notional = Math.abs(units) * entryPrice;
      totalPosVal += notional;
      posLines.push(
        `• <b>${sym}</b>: ${isShort ? "🔴 SHORT" : "🟢 LONG"} ${Math.abs(units).toFixed(units % 1 !== 0 ? 3 : 0)} units @ $${entryPrice.toFixed(2)}${p.leverage && p.leverage > 1 ? ` (${p.leverage}× lev)` : ""}${p.sl ? ` | SL $${p.sl}` : ""}${p.tp ? ` | TP $${p.tp}` : ""}`
      );
    }

    const estEquity = cash + totalPosVal;
    const totalPnl = estEquity - startEq;
    const totalPnlPct = startEq ? (totalPnl / startEq) * 100 : 0;
    const pnlIcon = totalPnl >= 0 ? "🟢" : "🔴";

    const msg = [
      `💼 <b>TBC Invest Simulator — Live Portfolio</b>`,
      `Token: <code>••••${token.slice(-4)}</code>`,
      ``,
      `💵 <b>Available Cash:</b> ${fmtMoney(cash)}`,
      `📊 <b>Open Position Notional:</b> ${fmtMoney(totalPosVal)}`,
      `🏦 <b>Total Virtual Equity:</b> ${fmtMoney(estEquity)}`,
      `${pnlIcon} <b>Overall P&L:</b> ${totalPnl >= 0 ? "+" : ""}${fmtMoney(totalPnl)} (${totalPnl >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%)`,
      ``,
      `<b>Open Positions (${positions.length}):</b>`,
      posLines.length ? posLines.join("\n") : "<i>No open positions. Use the web app to execute trades!</i>",
      positions.length > 10 ? `<i>...and ${positions.length - 10} more positions</i>` : "",
    ].filter(Boolean).join("\n");

    const keyboard = {
      inline_keyboard: [
        [
          { text: "📊 Top Radar Alerts", callback_data: "/radar" },
          { text: "⚡ SOL Shreds", callback_data: "/shreds SOL-USD" },
        ],
      ],
    };

    return sendTelegramMessage(botToken, chatId, msg, keyboard);
  } catch (e) {
    return sendTelegramMessage(botToken, chatId, `❌ Failed to fetch portfolio: ${e.message}`);
  }
}

async function handlePriceCommand(botToken, chatId, rawSym) {
  const query = (rawSym || "").trim().toUpperCase();
  if (!query) {
    return sendTelegramMessage(
      botToken,
      chatId,
      `💡 <b>Usage:</b> <code>/price AAPL</code> or <code>/q BTC-USD</code>\n\nSupported categories: Stocks, ETFs, Crypto, FX, Georgian Banks.`
    );
  }

  const match = CATALOG.find(
    (i) => i.sym.toUpperCase() === query || i.sym.toUpperCase() === `${query}-USD` || i.name.toUpperCase().includes(query)
  );
  const symbol = match ? match.sym : query;
  const now = Math.floor(Date.now() / 1000);

  try {
    const raw = await fetchChart(symbol, now - 45 * 86400, now + 86400);
    const m = raw.meta || {};
    const candles = chartToCandles(raw);
    if (!candles.length) throw new Error("No price history found");

    const scale = m.currency === "GBp" || m.currency === "ZAc" ? 100 : 1;
    const lastC = candles.at(-1);
    const prevC = candles.length > 1 ? candles.at(-2) : lastC;
    const price = (m.regularMarketPrice ?? lastC?.c ?? 0) / scale;
    const prevPrice = (m.chartPreviousClose ?? prevC?.c ?? price) / scale;
    const chg = price - prevPrice;
    const chgPct = prevPrice ? (chg / prevPrice) * 100 : 0;
    const isUp = chg >= 0;

    const norm = normalizeCurrency(m.currency || match?.ccy || "USD", price);
    const name = m.longName || m.shortName || match?.name || symbol;

    const msg = [
      `📈 <b>${name} (${symbol})</b>`,
      `Category: <b>${match?.cat || m.instrumentType || "Instrument"}</b> · Exchange: <b>${m.exchangeName || "Global"}</b>`,
      ``,
      `💵 <b>Live Price:</b> ${fmtMoney(norm.value, norm.currency)}`,
      `${isUp ? "🟢" : "🔴"} <b>Day Change:</b> ${isUp ? "+" : ""}${fmtMoney(chg, norm.currency)} (${isUp ? "+" : ""}${chgPct.toFixed(2)}%)`,
      `📊 <b>Day Range:</b> ${fmtMoney((m.regularMarketDayLow ?? lastC.l) / scale, norm.currency)} – ${fmtMoney((m.regularMarketDayHigh ?? lastC.h) / scale, norm.currency)}`,
      m.fiftyTwoWeekHigh ? `🎯 <b>52w High:</b> ${fmtMoney(m.fiftyTwoWeekHigh / scale, norm.currency)} · <b>52w Low:</b> ${fmtMoney(m.fiftyTwoWeekLow / scale, norm.currency)}` : "",
    ].filter(Boolean).join("\n");

    const keyboard = {
      inline_keyboard: [
        [
          { text: `⚡ Shreds for ${symbol}`, callback_data: `/shreds ${symbol}` },
          { text: "💼 My Portfolio", callback_data: "/portfolio" },
        ],
      ],
    };

    return sendTelegramMessage(botToken, chatId, msg, keyboard);
  } catch (e) {
    return sendTelegramMessage(botToken, chatId, `❌ Could not load price for <b>${symbol}</b> (${e.message}). Try a valid symbol like <code>AAPL</code>, <code>BTC-USD</code>, <code>SOL-USD</code>, or <code>NVDA</code>.`);
  }
}

async function handleRadarCommand(botToken, chatId) {
  try {
    const syms = CATALOG.slice(0, 40).map((i) => i.sym);
    const now = Math.floor(Date.now() / 1000);
    const p1 = now - 120 * 86400, p2 = now + 86400;

    const settled = await Promise.allSettled(syms.map((s) => fetchChart(s, p1, p2)));
    const alerts = [];

    syms.forEach((sym, idx) => {
      if (settled[idx].status !== "fulfilled") return;
      const raw = settled[idx].value;
      const scale = raw.meta?.currency === "GBp" ? 100 : 1;
      const candles = chartToCandles(raw).map((k) => ({ ...k, c: k.c / scale, h: k.h / scale, l: k.l / scale }));
      if (candles.length < 65) return;
      const closes = candles.map((c) => c.c);
      const price = closes[closes.length - 1];
      const inst = CATALOG.find((i) => i.sym === sym);

      const w60 = candles.slice(-61, -1);
      if (w60.length === 60) {
        const hi = Math.max(...w60.map((c) => c.h)), lo = Math.min(...w60.map((c) => c.l));
        if (price > hi) alerts.push({ sym, name: inst?.name || sym, price, type: "60-day breakout", dir: "bullish", strength: 3 });
        if (price < lo) alerts.push({ sym, name: inst?.name || sym, price, type: "60-day breakdown", dir: "bearish", strength: 3 });
      }
    });

    const top = alerts.slice(0, 6);
    const rows = top.map(
      (a) => `• <b>${a.sym}</b> ($${a.price.toFixed(2)}): ${a.dir === "bullish" ? "🟢" : "🔴"} <b>${a.type}</b> (★★★)`
    );

    const msg = [
      `🚨 <b>TBC Market Radar — High Strength Alerts (★★★)</b>`,
      `Scanned 40 active market instruments in real-time.`,
      ``,
      rows.length ? rows.join("\n") : "<i>No active 60-day breakout or breakdown triggers right now. Markets are in range!</i>",
      ``,
      `💡 <i>Type <code>/price SYM</code> or click buttons below for details:</i>`,
    ].join("\n");

    const keyboard = {
      inline_keyboard: [
        top.slice(0, 3).map((a) => ({ text: `📈 ${a.sym}`, callback_data: `/price ${a.sym}` })),
        [
          { text: "💼 My Portfolio", callback_data: "/portfolio" },
          { text: "⚡ SOL Shreds", callback_data: "/shreds SOL-USD" },
        ],
      ].filter((r) => r.length > 0),
    };

    return sendTelegramMessage(botToken, chatId, msg, keyboard);
  } catch (e) {
    return sendTelegramMessage(botToken, chatId, `❌ Failed to run radar scan: ${e.message}`);
  }
}

async function handleShredsCommand(botToken, chatId, rawSym) {
  const query = (rawSym || "SOL-USD").trim().toUpperCase();
  const symbol = query || "SOL-USD";

  try {
    const shredsHandler = (await import("./shreds.js")).default;
    let payload = null;

    const mockReq = { query: { symbol }, body: { symbol } };
    const mockRes = {
      status(s) { this.statusCode = s; return this; },
      json(j) { payload = j; return this; },
      setHeader() { return this; },
    };

    await shredsHandler(mockReq, mockRes);
    if (!payload || payload.error) throw new Error(payload?.error || "Shreds unavailable");

    const gauge = payload.gauge || {};
    const insight = payload.insight || {};
    const stats = payload.stats || [];

    const statLines = stats.slice(0, 4).map((s) => `• <b>${s.label}:</b> ${s.value}`);

    const msg = [
      `⚡ <b>Shreds Real-Time Telemetry — ${payload.chainName || payload.chain || symbol}</b>`,
      `Gauge: <b>${gauge.label || "Active"}</b> (Score: ${gauge.value ?? "—"}/100)`,
      ``,
      `<b>Live Metrics:</b>`,
      statLines.join("\n"),
      ``,
      `🧠 <b>What the Shreds Say:</b>`,
      insight.text ? insight.text.replace(/<[^>]+>/g, "") : "Real-time institutional & on-chain flow telemetry active.",
    ].join("\n");

    const keyboard = {
      inline_keyboard: [
        [
          { text: "⚡ BTC Shreds", callback_data: "/shreds BTC-USD" },
          { text: "⚡ AAPL Shreds", callback_data: "/shreds AAPL" },
        ],
        [
          { text: "💼 My Portfolio", callback_data: "/portfolio" },
          { text: "🚨 Market Radar", callback_data: "/radar" },
        ],
      ],
    };

    return sendTelegramMessage(botToken, chatId, msg, keyboard);
  } catch (e) {
    return sendTelegramMessage(botToken, chatId, `❌ Could not load shreds for <b>${symbol}</b> (${e.message}).`);
  }
}

function handleHelpCommand(botToken, chatId, token) {
  const msg = [
    `🤖 <b>TBC Invest Simulator — Interactive Bot</b>`,
    `Connected Account: <code>${token ? `••••${token.slice(-4)}` : "Local / Unattached"}</code>`,
    ``,
    `<b>Available Commands:</b>`,
    `• <code>/portfolio</code> or <code>/p</code> — Live virtual equity, cash, open positions & P&L`,
    `• <code>/price &lt;SYM&gt;</code> or <code>/q &lt;SYM&gt;</code> — Live quote, 24h change & day range (e.g. <code>/price AAPL</code>)`,
    `• <code>/radar</code> — Top 60-day breakouts & market signals across 238 instruments`,
    `• <code>/shreds &lt;SYM&gt;</code> — Real-time buy/sell pressure, whale prints & DEX flow (e.g. <code>/shreds SOL-USD</code>)`,
    `• <code>/help</code> — Show this menu`,
    ``,
    `💡 <i>Tip: You can also tap the interactive buttons below!</i>`,
  ].join("\n");

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💼 Portfolio", callback_data: "/portfolio" },
        { text: "🚨 Radar Signals", callback_data: "/radar" },
      ],
      [
        { text: "⚡ SOL Shreds", callback_data: "/shreds SOL-USD" },
        { text: "📈 AAPL Quote", callback_data: "/price AAPL" },
      ],
    ],
  };

  return sendTelegramMessage(botToken, chatId, msg, keyboard);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { botToken, token: queryToken } = req.query || {};
  const update = req.body || {};

  const cleanBotToken = typeof botToken === "string" ? botToken.trim() : "";
  if (!cleanBotToken || !/^[0-9]+:[A-Za-z0-9_-]{30,50}$/.test(cleanBotToken)) {
    return res.status(400).json({ error: "Invalid bot token" });
  }

  // Handle incoming message or callback query
  const message = update.message || update.edited_message;
  const callbackQuery = update.callback_query;

  const chatId = message ? message.chat?.id : callbackQuery ? callbackQuery.message?.chat?.id : null;
  const rawText = message ? message.text || "" : callbackQuery ? callbackQuery.data || "" : "";

  if (!chatId || !rawText) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  const text = rawText.trim();
  const [cmd, ...args] = text.split(/\s+/);
  const lowerCmd = cmd.toLowerCase();

  if (lowerCmd === "/start" || lowerCmd === "/help") {
    await handleHelpCommand(cleanBotToken, chatId, queryToken);
  } else if (lowerCmd === "/p" || lowerCmd === "/portfolio") {
    await handlePortfolioCommand(cleanBotToken, chatId, queryToken);
  } else if (lowerCmd === "/q" || lowerCmd === "/price" || lowerCmd === "/quote") {
    await handlePriceCommand(cleanBotToken, chatId, args[0]);
  } else if (lowerCmd === "/radar" || lowerCmd === "/signals") {
    await handleRadarCommand(cleanBotToken, chatId);
  } else if (lowerCmd === "/shreds" || lowerCmd === "/flow") {
    await handleShredsCommand(cleanBotToken, chatId, args[0]);
  } else if (text.startsWith("/")) {
    await sendTelegramMessage(
      cleanBotToken,
      chatId,
      `❓ Unknown command <code>${text}</code>. Send <code>/help</code> for available commands.`
    );
  }

  // Acknowledge callback query if applicable
  if (callbackQuery?.id) {
    try {
      await fetch(`https://api.telegram.org/bot${cleanBotToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQuery.id }),
      });
    } catch {}
  }

  return res.status(200).json({ ok: true });
}
