#!/usr/bin/env node
// Feature loss detector — checks every registered feature's code marker.
// Usage: node scripts/verify.js [baseUrl]   (baseUrl checks the DEPLOYED app)
import { readFileSync, existsSync } from "node:fs";

const BASE = process.argv[2] || null;
const cache = {};
const isApi = (f) => f.startsWith("api/");
const load = async (f) => {
  if (BASE) {
    const root = BASE.replace(/\/$/, "");
    // API files are serverless functions on prod: verify the endpoint is reachable
    if (isApi(f)) {
      const url = root + "/" + f.replace(/\.js$/, "");
      cache[f] ??= await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then((r) => (r.status === 404 || r.status === 500 ? `__ERR_${r.status}` : `__OK_${r.status} ${f}`))
        .catch(() => null);
      return cache[f];
    }
    const url = root + "/" + f;
    cache[f] ??= await fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    return cache[f];
  }
  return existsSync(f) ? readFileSync(f, "utf8") : null;
};

// feature → [file, marker-regex]  (ANY marker hit = present)
const MANIFEST = [
  ["catalog-238", ["instruments.js", /238|CATALOG/]],
  ["category-tabs", ["index.html", /data-cat="index"/]],
  ["live-history-api", ["api/history.js", /fetchChart/]],
  ["crumb-auth", ["lib/yahoo.js", /getcrumb|fetchQuoteSummary/]],
  ["fx-triple-currency", ["fx.js", /gelPerUsd|usdRate/]],
  ["whatif-sliders", ["index.html", /horizonRange|targetRange/]],
  ["whatif-timeline", ["app.js", /simTimeline|tl-track/]],
  ["whatif-narrative", ["app.js", /simNarrative/]],
  ["time-scrubber", ["app.js", /initScrubber|renderScrub/]],
  ["candle-terminal", ["chart.js", /function render\(\)/]],
  ["chart-signals", ["chart.js", /detectSignals/]],
  ["elliott-overlay", ["chart.js", /wavesSvg|Elliott/]],
  ["chart-watermark", ["chart.js", /chart-watermark/]],
  ["analysis-5-tabs", ["index.html", /data-a="news"/]],
  ["desk-signals-3", ["api/analysis.js", /morganStanleySignal|goldmanSachsSignal/]],
  ["graham-target", ["api/analysis.js", /8\.5 \+ 2/]],
  ["earnings-impact", ["api/analysis.js", /earningsImpact/]],
  ["elliott-engine", ["waves.js", /function elliott/]],
  ["patterns-17", ["waves.js", /Cup & Handle|Rising Wedge/]],
  ["williams-toolkit", ["waves.js", /function williams/]],
  ["pattern-lab-ui", ["patterns.js", /renderPatternLab/]],
  ["pattern-exec", ["patterns.js", /pat-exec/]],
  ["packages-16", ["api/packages.js", /livebook|bearkit/]],
  ["packages-types", ["api/packages.js", /const type = shorts === 0/]],
  ["package-roles", ["packages.js", /SHORT|LONG/]],
  ["live-curation", ["api/packages.js", /livePackage|pick\("long"\)/]],
  ["invest-package", ["portfolio.js", /investPackage/]],
  ["order-ticket", ["portfolio.js", /typeSeg|sideSeg/]],
  ["leverage-liquidations", ["portfolio.js", /checkLiquidations|liquidation/]],
  ["pending-orders", ["portfolio.js", /processPendingOrders/]],
  ["exit-ladders", ["portfolio.js", /openExitsModal|processExits/]],
  ["shorts", ["portfolio.js", /shortProceeds|short: true/]],
  ["token-system", ["api/token.js", /randomBytes/]],
  ["blob-sync", ["api/portfolio.js", /portfolios\/|@vercel\/blob/]],
  ["cloud-autopull", ["portfolio.js", /pullFromCloud/]],
  ["token-banner", ["portfolio.js", /initTokenBanner|renderTokenBar/]],
  ["hourly-scan", ["api/scan.js", /getRecentPerformanceSamples|analyzeWaves/]],
  ["radar-ui", ["alerts.js", /renderIntraday/]],
  ["radar-category-scope", ["alerts.js", /a\.cat === cat/]],
  ["alert-bell", ["alerts.js", /renderBell|alertBell/]],
  ["shreds-router", ["api/shreds.js", /btcDecoder|evmDecoder/]],
  ["shreds-btc-mempool", ["api/shreds.js", /mempool\.space/]],
  ["shreds-evm", ["api/shreds.js", /eth_getBlockByNumber/]],
  ["shreds-sol", ["api/shreds-sol.js", /getRecentPerformanceSamples/]],
  ["shreds-flow-map", ["shreds.js", /flowMapHtml/]],
  ["shreds-live-pulse", ["shreds.js", /liveFlowHtml|can-liquid/]],
  ["shreds-insight", ["shreds.js", /What the shreds say/]],
  ["shreds-cards", ["shreds.js", /nc-exec/]],
  ["shreds-providers", ["shreds.js", /openProviderModal/]],
  ["shreds-entry-badge", ["shreds.js", /shredsBadge/]],
  ["shreds-visibility", ["shreds.js", /SUPPORTED/]],
  ["equity-shreds-edgar", ["api/shreds.js", /edgarInsider|company_tickers/]],
  ["equity-shreds-options", ["lib/yahoo.js", /fetchOptions/]],
  ["equity-shreds-halts", ["api/shreds.js", /tradehalts/]],
  ["equity-shreds-frontend", ["shreds.js", /THEME\.EQ|EQ:/]],
  ["news-api", ["api/news.js", /v1\/finance\/search/]],
  ["article-reader", ["api/article.js", /maxHeaderSize/]],
  ["section-collapse", ["app.js", /collapse-btn|tbc_collapsed/]],
  ["section-reorder", ["app.js", /tbc_section_order|dragover/]],
  ["deep-links", ["app.js", /symbolFromHash/]],
  ["share-button", ["app.js", /shareBtn/]],
  ["footer-badges", ["index.html", /z\.ai\/subscribe|VibeCodePrompterSystem/]],
  ["telegram-bot-api", ["api/telegram.js", /api\.telegram\.org\/bot/]],
  ["telegram-bot-ui", ["portfolio.js", /openTelegramModal|notifyTelegram/]],
  ["telegram-bot-interactive", ["api/telegram-webhook.js", /handlePortfolioCommand|handlePriceCommand/]],
];

let fail = 0;
console.log(`\n🔍 Feature verify ${BASE ? "→ " + BASE : "→ local files"} (${MANIFEST.length} features)\n`);
for (const [name, [file, re]] of MANIFEST) {
  const src = await load(file);
  const ok = BASE && isApi(file) ? !!src && !src.startsWith("__ERR") : !!src && re.test(src);
  if (!ok) fail++;
  console.log(` ${ok ? "✅" : "❌"} ${name.padEnd(26)} ${file}`);
}
console.log(`\n${fail === 0 ? "✅ ALL FEATURES PRESENT" : `❌ ${fail} FEATURE(S) MISSING`}\n`);
process.exit(fail ? 1 : 0);
