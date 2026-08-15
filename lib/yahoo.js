// Shared Yahoo Finance helpers with crumb-based auth for quoteSummary.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HOSTS = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];

let auth = { cookie: "", crumb: "", ts: 0 }; // module-global cache (per lambda instance)

async function refreshAuth() {
  const cookieParts = [];
  try {
    const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
    const setCookies = r.headers.getSetCookie?.() || [];
    for (const c of setCookies) cookieParts.push(c.split(";")[0]);
  } catch {
    /* some regions work without the initial cookie */
  }
  const cookie = cookieParts.join("; ");
  const crumb = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  }).then((r) => r.text());
  if (!crumb || crumb.length > 40 || crumb.includes("<")) throw new Error("crumb failed");
  auth = { cookie, crumb, ts: Date.now() };
  return auth;
}

export async function getAuth(force = false) {
  if (!force && auth.crumb && Date.now() - auth.ts < 30 * 60 * 1000) return auth;
  return refreshAuth();
}

export async function fetchChart(symbol, period1, period2) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const url =
        `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplit&includeAdjustedClose=true`;
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) {
        lastErr = new Error(`upstream ${r.status}`);
        continue;
      }
      const j = await r.json();
      const result = j?.chart?.result?.[0];
      if (!result) {
        lastErr = new Error(j?.chart?.error?.description || "no data");
        continue;
      }
      return result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("chart failed");
}

export async function fetchQuoteSummary(symbol, modules) {
  const qs = `modules=${modules.join(",")}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await getAuth(attempt > 0);
    try {
      const url =
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?${qs}&crumb=${encodeURIComponent(a.crumb)}`;
      const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: a.cookie } });
      const j = await r.json().catch(() => ({}));
      if (j?.quoteSummary?.result?.[0]) return j.quoteSummary.result[0];
      const desc = j?.quoteSummary?.error?.description || `HTTP ${r.status}`;
      if (attempt === 0 && /crumb|unauthor/i.test(desc)) continue; // retry with fresh auth
      throw new Error(desc);
    } catch (e) {
      if (attempt > 0) throw e;
    }
  }
  throw new Error("quoteSummary failed");
}

export function chartToCandles(result) {
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close == null) continue;
    out.push({ t: ts[i] * 1000, o: q.open?.[i] ?? close, h: q.high?.[i] ?? close, l: q.low?.[i] ?? close, c: close, v: q.volume?.[i] ?? 0, ac: adj[i] ?? close });
  }
  return out;
}

export async function fetchOptions(symbol) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await getAuth(attempt > 0);
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(a.crumb)}`;
      const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: a.cookie } });
      const j = await r.json().catch(() => ({}));
      const res = j?.optionChain?.result?.[0];
      if (res?.options?.length) return res;
      const desc = j?.optionChain?.error?.description || `HTTP ${r.status}`;
      if (attempt === 0 && /crumb|unauthor/i.test(desc)) continue;
      throw new Error(desc);
    } catch (e) {
      if (attempt > 0) throw e;
    }
  }
  throw new Error("options failed");
}
