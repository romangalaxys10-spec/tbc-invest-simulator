// Client-side FX helpers: instrument currency → USD, and USD → GEL (Georgian Lari).
const usdCache = {};
let gelCache = { rate: null, ts: 0 };

async function fetchPrice(sym) {
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const p1 = p2 - 5 * 86400;
  const r = await fetch(`/api/history?symbol=${encodeURIComponent(sym)}&period1=${p1}&period2=${p2}`);
  const j = await r.json();
  if (!r.ok || !j.price) throw new Error(j.error || `no price for ${sym}`);
  return j.price;
}

// rate to convert 1 unit of ccy → USD
export async function usdRate(ccy) {
  if (!ccy || ccy === "USD" || ccy === "USX") return ccy === "USX" ? 0.01 : 1;
  const c = usdCache[ccy];
  if (c && Date.now() - c.ts < 5 * 60 * 1000) return c.rate;
  let rate = null;
  try { rate = await fetchPrice(`${ccy}USD=X`); } catch { rate = null; }
  if (!rate) {
    try { rate = 1 / (await fetchPrice(`USD${ccy}=X`)); } catch { rate = null; }
  }
  if (!rate) throw new Error(`FX ${ccy} unavailable`);
  usdCache[ccy] = { rate, ts: Date.now() };
  return rate;
}

// GEL per 1 USD
export async function gelPerUsd() {
  if (gelCache.rate && Date.now() - gelCache.ts < 5 * 60 * 1000) return gelCache.rate;
  const rate = await fetchPrice("GEL=X");
  gelCache = { rate, ts: Date.now() };
  return rate;
}

const fmtCur = (v, ccy) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(v); }
  catch { return `${v.toFixed(2)} ${ccy}`; }
};
export const fmtUsd = (v) => fmtCur(v, "USD");
export const fmtGel = (v) => `₾${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
