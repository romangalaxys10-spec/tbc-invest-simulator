# 📋 Feature Registry — TBC Invest Simulator

> **THE canonical record of every feature and where its code lives.**
> Rule: any update that adds/changes/moves a feature MUST update this file in the same commit,
> run `node scripts/verify.js`, and tag the release. Never lose anything again.

**Live:** https://tbc-invest-simulator-ryzenadvanceds-projects.vercel.app
**Repo:** https://github.com/romangalaxys10-spec/tbc-invest-simulator
**Universe:** 238 instruments — Stocks(89) · ETFs(10) · Bonds(10) · Futures(39) · Crypto(35) · Forex(38) · Indices(17)

---

## 1. Instruments & Data Layer

| Feature | Code |
|---|---|
| 238-instrument catalog, 7 categories | `instruments.js` (`CATALOG`, `CATEGORY_LABELS`) |
| Category tabs above layout | `index.html` `.asset-tabs` · `app.js` `els.tabs` handler |
| Live candles+quotes (Yahoo, browser-UA, GBp→GBP) | `api/history.js` · `lib/yahoo.js` `fetchChart/chartToCandles` |
| Yahoo crumb auth (quoteSummary) | `lib/yahoo.js` `fetchQuoteSummary/getAuth` |
| FX: any ccy→USD, inverse pairs, USX cents | `fx.js` · `portfolio.js` `getFx` |

## 2. What-if Simulator

| Feature | Code |
|---|---|
| Hidden by default with 1-click launcher buttons | `store.js` `collapse.get` · `app.js` `toggleSimulator/openSimulator` · `index.html` `#simToggleBtn/#openSimTopBtn` |
| 4-field entry (date/amount/horizon/target) with sliders | `index.html` `.ctrl-card` · `app.js` |
| Instrument context bar + timeline (entry→horizon, today marker) | `app.js` `compute()` (`simInstrument`, `simTimeline`) |
| Narrative result sentence + inline mini-result + See-result btn | `app.js` (`simNarrative`, `simInlineResult`, `seeResultBtn`) |
| Total-return math (adj close), goal-hit date, μ±σ projection | `app.js` `compute()` |
| Triple currency (native + USD + GEL) | `fx.js` + `app.js` `conv()` |
| 🎬 Time scrubber (value/P·L/goal per day + chart marker) | `index.html` `#simScrub` · `app.js` `initScrubber/renderScrub` |

## 3. Chart Terminal

| Feature | Code |
|---|---|
| Candlesticks + hover crosshair tooltip | `chart.js` `render()` |
| Volume / RSI / MACD panels | `chart.js` |
| SMA20/50/200 + Bollinger overlays, 1M/3M/6M/1Y ranges | `chart.js` toggles |
| On-chart signals (golden/death cross, MACD, RSI exits, 52w) | `chart.js` `detectSignals()` |
| Elliott zigzag + wave labels on chart | `chart.js` (waves overlay) · `waves.js` |
| Pattern lines + E/S/T1/T2 trade-plan levels | `chart.js` |
| Instrument watermark (TradingView-style) | `chart.js` `chart-watermark` |
| 420-day dedicated feed (timeframe fix) | `app.js` `refreshCandles/chartHistCache` |

## 4. Analysis & Signals

| Feature | Code |
|---|---|
| 5 analysis tabs (analysts/tech/fund/waves/news) | `analysis.js` |
| 40+ Wall Street analysts, targets, upgrades | `api/analysis.js` · `analysis.js` `viewAnalysts` |
| Technicals: 8-signal trend score, RSI/MACD/ATR/S&R | `api/analysis.js` `computeTechnicals` |
| Fundamentals w/ verdicts; asset-class n/a handling | `api/analysis.js` · `analysis.js` `viewFund` |
| Earnings impact (real next-day reactions, scenarios) | `api/analysis.js` `earningsImpact` · `viewEvents` |
| 3 desk signals: Morgan Stanley/Goldman Sachs/Warren Bufft (+targets, ⚡Execute) | `api/analysis.js` `morganStanleySignal/goldmanSachsSignal/warrenBufftSignal` · `analysis.js` `renderSignals` |
| Elliott waves (heuristic count, rules, projections) | `waves.js` `elliott()` · `analysis.js` `viewWaves` |
| 17 patterns w/ trade plans (cup&handle, wedges, channels…) | `waves.js` `patterns()` |

## 5. Pattern Lab (UI)

| Feature | Code |
|---|---|
| Dedicated panel w/ schematics, plans, explainers | `patterns.js` · `index.html` `#patternLab` |
| Bill Williams toolkit (fractals, Alligator, AO, %R) + Execute | `waves.js` `williams()` · `patterns.js` |

## 6. Investment Packages

| Feature | Code |
|---|---|
| 16 packages, buy/sell/mixed types + filter pills | `api/packages.js` `PACKAGES` · `packages.js` |
| LONG/SHORT roles, net exposure, avg correlation | `api/packages.js` · `packages.js` |
| ⚡ Live Market Curation (real-time auto-built book) | `api/packages.js` (universe/pick/livePackage) |
| One-click paper-invest (weighted, role-aware) | `portfolio.js` `investPackage` |

## 7. Virtual Portfolio & Orders

| Feature | Code |
|---|---|
| $100k account, positions, P/L since fill vs Day move | `portfolio.js` `renderPortfolio/positionView` |
| Order ticket: buy/sell, long/short, market/limit/stop/auction, 1×/2×/5× leverage, liquidations, togglable SL/TP brackets | `portfolio.js` `openTradeModal/executeAtMarket/checkLiquidations/toggleSL/toggleTP` |
| Pending orders table + trigger execution + hourly auction tick | `portfolio.js` `processPendingOrders` |
| 🎯 Exit ladders (portions at prices, presets, auto-exec) | `portfolio.js` `openExitsModal/processExits` |
| Short positions (negative units) | `portfolio.js` |
| Multi-user tokens (generate/link/copy/unlink, auto-sync push+pull) | `api/token.js` · `api/portfolio.js` · `portfolio.js` `cloudToken` |
| Token banner on main screen (status/generate/load) | `portfolio.js` `initTokenBanner/renderTokenBar` |
| Vercel Blob private store (portfolios/{token}.json — survives deploys) | `api/portfolio.js` |

## 8. Intraday Radar & Alerts

| Feature | Code |
|---|---|
| Hourly scan of all 238 (signals+patterns, strength-sorted) | `api/scan.js` |
| Radar UI: hero stats, bull/bear filters, signal cards w/ Execute | `alerts.js` `renderIntraday` |
| Category-scoped alerts (follows active tab) | `alerts.js` (store.cat filter) |
| 🔔 Bell + per-hour dedupe + browser notifications | `alerts.js` `initAlerts/renderBell` |

## 9. Universal Shreds (crypto chains)

| Feature | Code |
|---|---|
| Router: BTC/EVM/SOL decoders → unified payload | `api/shreds.js` |
| BTC: mempool.space (pre-confirmation mempool, fees, whales) | `api/shreds.js` `btcDecoder` |
| EVM: ETH/AVAX/ARB/OP public RPCs (gas, routers, whales) | `api/shreds.js` `evmDecoder` |
| SOL: multi-slot blocks, Jupiter/Raydium flow, providers | `api/shreds-sol.js` |
| Animated flow map (chain-colored pipes + particles) | `shreds.js` `flowMapHtml` |
| Gauge (bias/gas/pressure) | `shreds.js` + API `gauge` |
| 🫀 Live pulse: buy/sell cans + split bar + live candles | `shreds.js` `liveFlowHtml/pushTick` |
| 🧠 "What the shreds say" narrative + chips (per chain) | `api/shreds.js` `insight` · `shreds.js` |
| 🧭 Beginner cards w/ Execute | API `cards` · `shreds.js` |
| 🔌 External providers (add/test/health, max 3) | `api/shreds-sol.js` provider pool · `shreds.js` `openProviderModal` |
| ⚡ Entry badge (unsupported crypto → SOL) | `shreds.js` `initShreds` badge |
| Per-instrument visibility (SUPPORTED set) | `shreds.js` |

## 9b. Equity Shreds (stocks / ETFs / indices — 116 symbols)

| Feature | Code |
|---|---|
| Insider Form 4 prints (EDGAR, keyless, owner/shares/price parsed) | `api/shreds.js` `edgarInsider/tickerToCik` |
| Options flow via existing crumb auth (P/C, volumes, max pain) | `lib/yahoo.js` `fetchOptions` · `api/shreds.js` |
| Unusual contracts (vol ≫ OI, notional, links) | `api/shreds.js` `equityDecoder` |
| Trade-halts feed (NasdaqTrader RSS, per-symbol) | `api/shreds.js` `haltsFeed` |
| Equity cards (insider buying, call/put-heavy, halts) + insight | `api/shreds.js` `equityDecoder` |
| Frontend routing + EQ theme for stock/etf/index cats | `shreds.js` `SUPPORTED/THEME.EQ` |

## 10. News

| Feature | Code |
|---|---|
| Per-instrument news + sentiment | `api/news.js` · `analysis.js` `viewNews/loadNews` |
| In-app article reader (extraction, modal) | `api/article.js` · `analysis.js` `openArticle` |

## 11. UI System

| Feature | Code |
|---|---|
| Section collapse + drag-reorder + ↑↓ (persisted) | `app.js` (collapse/drag handlers) · `store.js` `collapse` |
| Deep links `#sym=` + Share button + hashchange | `app.js` `symbolFromHash` |
| Views: Simulator / Packages / Portfolio | `app.js` `showView` |
| Dark-native forms | `styles.css` global input rules |
| Footer badges (GLM 5.3 invite, Telegram) | `index.html` `.app-footer` |
| Execute buttons: event delegation (never rAF/direct onclick) | `analysis.js` `.exec-btn` delegation · `patterns.js`/`alerts.js`/`shreds.js` |
| JS cache-busting (must-revalidate headers) | `vercel.json` headers |

## 11b. Telegram Bot Integration (Multi-user per token)

| Feature | Code |
|---|---|
| Telegram bot proxy & test connection API | `api/telegram.js` |
| Personal bot modal: setup guide, BotFather links, test & save | `portfolio.js` `openTelegramModal` · `index.html` `#telegramModal` |
| Live notification dispatcher (trades/orders/exits/radar) | `portfolio.js` `notifyTelegram` · `alerts.js` |
| Cloud sync token attachment for bot configuration | `api/portfolio.js` (telegram schema) · `portfolio.js` `cloudToken` |
| Interactive 2-Way Commands (`/portfolio`, `/price`, `/radar`, `/shreds`, `/help`) | `api/telegram-webhook.js` · `api/telegram.js` (setWebhook/setMyCommands) |

## 11c. Charting & Technical Analysis Enhancements

| Feature | Code |
|---|---|
| Multi-timeframe candle switcher (1D / 1W / 1M dynamic aggregation) | `chart.js` `aggregateCandles` · `index.html` `.cd-timeframes` |
| Interactive Drawing Toolbar (S/R Horizontal Ray, 2-Point Trendline, Cursor) | `chart.js` `cd-draw-toolbar` · `saveDrawings/loadDrawings` |
| Fibonacci Retracement Overlay (0.0%, 23.6%, 38.2%, 50.0%, 61.8% Golden Pocket, 78.6%, 100%) | `chart.js` `fibSvg` · `index.html` `data-o="fib"` |
| Interactive Chart Price Alerts (Click canvas price to arm alert + Telegram push) | `chart.js` `checkPriceAlerts/loadAlerts` · `portfolio.js` `notifyTelegram` |

## 11d. Intelligence, Macro Heatmap & Sound/Haptic System

| Feature | Code |
|---|---|
| Macro Correlation Matrix & Cross-Asset Heatmap (Equities, Crypto, Yields, Gold, Oil, Forex) | `analysis.js` `viewIntel` · `index.html` `data-a="intel"` |
| Macro Economic Playbook & Global Calendar (Event catalysts, consensus, prior, and expected Bullish vs. Bearish triggers) | `analysis.js` `viewEvents` (macroHtml table) |
| Latency-free Web Audio synthesizer (Trade fill, TP chord, SL tone, Radar chirp, Tap) | `audio.js` `soundFx` |
| Tactile vibration haptics on mobile browsers (`navigator.vibrate`) | `audio.js` `vibrate` |
| Sound & Haptics toggle control button (persisted in localStorage) | `audio.js` `setSoundEnabled` · `index.html` `#soundToggleBtn` |

## 12. Storage Registry (never migrate blindly)

| Key | What |
|---|---|
| `tbc_portfolio_v2` | local portfolio |
| `tbc_token` | cloud token |
| `tbc_alerts_v1` | seen alert keys |
| `tbc_collapsed` | collapsed sections |
| `tbc_section_order` | section order |
| `tbc_shred_providers` | external RPC list |
| `tbc_shred_ticks_{CHAIN}` | live candle ticks |
| `tbc_drawings_{SYMBOL}` | custom chart drawings per instrument |
| `tbc_price_alerts` | user custom chart price alerts |
| `tbc_sound_enabled` | sound & haptics enabled/muted setting |
| Vercel Blob `portfolios/{token}.json` | cloud portfolios + personal telegram bot configs (**survives deploys**) |

## 13. Release & Recovery Protocol

1. Update code + `FEATURES.md` in the same commit
2. `node scripts/verify.js` — must print ALL OK
3. `git tag -a vX.Y.Z -m "..."` + `git push --tags`
4. Deploy, then run verify against prod: `node scripts/verify.js https://…vercel.app`
5. Lost something? `git diff vX.Y.Z..HEAD -- <file>` or restore: `git checkout vX.Y.Z -- <file>`

**Tags:** `v2.0.0` = full feature-complete snapshot (this document's state)

