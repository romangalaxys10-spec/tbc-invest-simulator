// Tiny shared state between app / chart / analysis modules.
export const store = { candles: null, symbol: null, cat: "stock" };

// section collapse persistence
const KEY = "tbc_collapsed";
export const collapse = {
  get(key) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (key in s) return !!s[key];
      }
      // What-if simulator controls and result are hidden/collapsed by default
      if (key === "controls" || key === "result") return true;
      return false;
    } catch {
      return key === "controls" || key === "result";
    }
  },
  set(key, val) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
    s[key] = val;
    localStorage.setItem(KEY, JSON.stringify(s));
  },
};
