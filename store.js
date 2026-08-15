// Tiny shared state between app / chart / analysis modules.
export const store = { candles: null, symbol: null, cat: "stock" };

// section collapse persistence
const KEY = "tbc_collapsed";
export const collapse = {
  get(key) {
    try { return !!(JSON.parse(localStorage.getItem(KEY) || "{}")[key]); } catch { return false; }
  },
  set(key, val) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
    s[key] = val;
    localStorage.setItem(KEY, JSON.stringify(s));
  },
};
