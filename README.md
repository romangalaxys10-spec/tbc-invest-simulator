<div align="center">

# 📈 TBC Invest Simulator

### One prompt in. A live investment product out.

[![Live Demo](https://img.shields.io/badge/▶_LIVE_DEMO-tbc--invest--simulator-8b5cf6?style=for-the-badge)](https://tbc-invest-simulator-ryzenadvanceds-projects.vercel.app)
[![GitHub](https://img.shields.io/badge/⭐_SOURCE-GitHub-181717?style=for-the-badge&logo=github)](https://github.com/romangalaxys10-spec/tbc-invest-simulator)
[![Blog](https://img.shields.io/badge/📖_BUILD_STORY-Claw_Blog-FC3F1D?style=for-the-badge)](https://claw.rommark.dev/blog/56-tbc-invest-assistant-glm-53.html)

[![Built with GLM 5.3](https://img.shields.io/badge/BUILT_WITH-GLM_5.3-10b981?style=flat-square)](https://z.ai/subscribe?ic=ROK78RJKNW)
[![Try GLM 5.3 — 10% OFF coding plan](https://img.shields.io/badge/⚡_Try_GLM_5.3-10%25_OFF_coding_plan-FFCC00?style=flat-square)](https://z.ai/subscribe?ic=ROK78RJKNW)

**[▶ Open the live app](https://tbc-invest-simulator-ryzenadvanceds-projects.vercel.app)** · **[★ Star this repo](https://github.com/romangalaxys10-spec/tbc-invest-simulator)** · **[📖 Read the build story](https://claw.rommark.dev/blog/56-tbc-invest-assistant-glm-53.html)**

</div>

---

## 🧠 This is not a tutorial project

This entire app — every file, every feature, every serverless function, the deployment, the blog article about it, and this README — was **thought, planned, built, debugged, and shipped by [GLM 5.3](https://z.ai/subscribe?ic=ROK78RJKNW) in one continuous session** inside Codex IDE, driven by a human with one sentence:

> *"create a dashboard where i can select any of the ETF/BOND/STOCK instruments of Georgian bank TBC, select day of entry, amount of entry (simulation) based on REAL LIVE prices, and then set goal, in X days show me how much that entry would gain."*

No frameworks were hired for the frontend. No template was copied. No API key was purchased. The model **researched which free price APIs actually work in 2026**, reverse-engineered Yahoo's cookie-and-crumb authentication, computed technical indicators from raw candles, modeled earnings impact from real historical reactions, and deployed the result to Vercel — then wrote a [full build log](https://claw.rommark.dev/blog/56-tbc-invest-assistant-glm-53.html) about its own bugs.

Seven user turns. One afternoon. **~3,500 lines of vanilla JS. Zero frontend dependencies.**

---

## ✨ What it does

| | Feature | Reality check |
|---|---|---|
| 🏦 | **33 real instruments** — TBCG.L, BGEO.L, AAPL, NVDA… + ETFs + bond ETFs | The actual universe TBC Bank Georgia brokerage gives retail investors |
| 💹 | **Live prices** — delayed/real-time per exchange | Yahoo Finance via browser-UA proxy, GBp→GBP normalized |
| 🎯 | **Goal simulator** — pick any past date, amount, X-day horizon, target % | Total-return math (dividends & splits adjusted), goal-hit date, μ±σ projection |
| 📊 | **Full analysis** — valuation, profitability, growth, health | P/E, PEG, EV/EBITDA, ROE, margins, D/E, FCF — each with a verdict |
| 🧑‍💼 | **40+ Wall Street analysts** per large cap | AAPL: 41 analysts, targets, upgrades/downgrades with firms |
| 📐 | **Technicals computed from raw candles** | 8-signal trend score, RSI-14, MACD, Bollinger %B, ATR, support/resistance |
| 📅 | **Earnings impact engine** | Beat/in-line/miss scenarios from the stock's *own* last 4–8 earnings reactions |
| 🧙 | **Morgan Stanley, Goldman Sachs & Warren Bufft desks** | Three real methodology engines (revisions/risk-reward, macro-momentum, Graham value) with price targets + ⚡ Execute buttons |
| 🕯️ | **Candlestick terminal** | Volume/RSI/MACD panels, hover crosshair, golden-cross & earnings markers |
| 📰 | **In-app news reader** | Click a headline → read the full article in the app |
| 💼 | **Multi-user paper trading** | $100k virtual cash, token-based cloud sync (Vercel Blob), works across devices |
| 📦 | **Investment packages** | 6 balanced groups with live entry signals, avg-correlation balance metric, one-click weighted investing |
| 🕯️ | **Pattern Lab** | Elliott waves + 17 classical patterns (incl. Cup & Handle, wedges, channels) with entry/stop/target/R:R trade plans, schematics & Bill Williams toolkit |
| ⚡ | **Full order ticket** | Buy/sell, long/short, limit/stop/auction orders, 2×/5× leverage with liquidations, hourly execution scan |
| 🔔 | **Hourly market scan** | All 33 instruments scanned for signals & pattern triggers with actionable alerts |

---

## 🏗️ Architecture: small on purpose

```text
index.html      the whole UI shell
app.js          simulator engine + glue
analysis.js     analysis tabs (analysts/tech/fund/events/news)
chart.js        candlestick terminal + indicator engine
portfolio.js    paper trading engine: market/limit/stop/auction orders,
                long/short, leverage + liquidations, cloud sync
instruments.js  the curated TBC universe

api/history.js    candles + live quotes  (Yahoo chart, crumb-free)
api/analysis.js   fundamentals + analysts + computed technicals (crumb-auth)
api/news.js       per-instrument news
api/article.js    in-app article extraction (node:https, 128KB headers)
api/token.js      user token generation
api/portfolio.js  private Vercel Blob sync (survives deploys)
api/packages.js   balanced packages + entry signals + correlation
api/scan.js       hourly market-wide signal & pattern scan
```

**One server-side dependency** (`@vercel/blob`) — everything else is vanilla JS and SVG.

---

## 🐛 The bug hunt (why the build log is worth reading)

The interesting part of any AI-built project is what went wrong. Receipts in the [blog article](https://claw.rommark.dev/blog/56-tbc-invest-assistant-glm-53.html):

- 🕳️ Vercel deployed **Ready** — anonymous visitors got a 302 to an SSO wall. Patched via API.
- 🍪 Yahoo `quoteSummary` → `Invalid Crumb` → cookie-and-crumb dance, cached 30 min.
- 🤯 `UND_ERR_HEADERS_OVERFLOW` — Yahoo's article headers exceed Node's fetch limits → raw `node:https` with 128KB header budget.
- 🧬 Yahoo changed their article DOM → extractor rewritten for `text-block paragraph` classes.
- ⏳ News tab stuck on "Loading…" forever → loader ran before the container existed in the DOM.
- 🫥 Private Blob `get()` doesn't return a Blob → stream-to-text via `Response()`.

---

## 🚀 Run it yourself

```bash
git clone https://github.com/romangalaxys10-spec/tbc-invest-simulator
cd tbc-invest-simulator
npm install          # only @vercel/blob
npx vercel dev       # http://localhost:3000
```

Deploy your own: `npx vercel` — then (optional) create a Blob store for portfolio sync: `npx vercel blob create-store my-db --access private`.

---

## 📣 Want this workflow on your own idea?

Everything here was one session with **GLM 5.3** in **Codex IDE**. It runs on Z.ai's coding plan:

<div align="center">

[![Try GLM 5.3 — 10% OFF coding plan](https://img.shields.io/badge/⚡_Try_GLM_5.3_on_Z.ai-10%25_OFF_coding_plan-FC3F1D?style=for-the-badge)](https://z.ai/subscribe?ic=ROK78RJKNW)

Invite token: `ROK78RJKNW` · [z.ai/subscribe?ic=ROK78RJKNW](https://z.ai/subscribe?ic=ROK78RJKNW)

📚 More builds & LLM news → [The LLM News Channel on Telegram](https://t.me/VibeCodePrompterSystem)

</div>

---

## ⚖️ Reality disclaimer

Paper trading only, for education. Prices from Yahoo Finance (unofficial API, delayed for some exchanges). Analyst data = Wall Street consensus as reported by Yahoo. "Morgan Sachs" and "Warren Bufft" are **fictional signal engines with transparent formulas** — not affiliated with any real firm or person. Not investment advice. TBC is a trademark of TBC Bank Group; this project is unofficial and unaffiliated.

---

<div align="center">

**[▶ Try the live app](https://tbc-invest-simulator-ryzenadvanceds-projects.vercel.app)** — generate a token, place your first paper trade, and see what GLM 5.3 built in an afternoon.

*Built by GLM 5.3 · August 2026 · one session, seven prompts, zero frameworks*

</div>
