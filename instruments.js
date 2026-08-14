// Curated universe of instruments available to retail investors via
// TBC Bank Georgia / TBC Capital brokerage (US, UK & EU listings).
// Bond exposure is represented by liquid bond ETFs — same access TBC offers.

export const CATALOG = [
  // Georgian banks listed in London
  { sym: "TBCG.L", name: "TBC Bank Group PLC", cat: "stock", note: "LSE · Parent of TBC Bank Georgia", ccy: "GBP" },
  { sym: "BGEO.L", name: "Bank of Georgia Group", cat: "stock", note: "LSE · Georgian banking peer", ccy: "GBP" },
  // US stocks
  { sym: "AAPL", name: "Apple Inc.", cat: "stock", note: "NASDAQ", ccy: "USD" },
  { sym: "MSFT", name: "Microsoft Corp.", cat: "stock", note: "NASDAQ", ccy: "USD" },
  { sym: "NVDA", name: "NVIDIA Corp.", cat: "stock", note: "NASDAQ", ccy: "USD" },
  { sym: "GOOGL", name: "Alphabet Inc.", cat: "stock", note: "NASDAQ", ccy: "USD" },
  { sym: "AMZN", name: "Amazon.com Inc.", cat: "stock", note: "NASDAQ", ccy: "USD" },
  { sym: "META", name: "Meta Platforms", cat: "stock", note: "NASDAQ", ccy: "USD" },
  { sym: "TSLA", name: "Tesla Inc.", cat: "stock", note: "NASDAQ", ccy: "USD" },
  { sym: "JPM", name: "JPMorgan Chase", cat: "stock", note: "NYSE", ccy: "USD" },
  { sym: "V", name: "Visa Inc.", cat: "stock", note: "NYSE", ccy: "USD" },
  { sym: "KO", name: "Coca-Cola Co.", cat: "stock", note: "NYSE", ccy: "USD" },
  { sym: "WMT", name: "Walmart Inc.", cat: "stock", note: "NYSE", ccy: "USD" },
  // Equity ETFs
  { sym: "VTI", name: "Vanguard Total Stock Market", cat: "etf", note: "US total market", ccy: "USD" },
  { sym: "VOO", name: "Vanguard S&P 500", cat: "etf", note: "S&P 500", ccy: "USD" },
  { sym: "SPY", name: "SPDR S&P 500 Trust", cat: "etf", note: "S&P 500", ccy: "USD" },
  { sym: "QQQ", name: "Invesco QQQ Trust", cat: "etf", note: "Nasdaq-100", ccy: "USD" },
  { sym: "VEA", name: "Vanguard Developed Markets", cat: "etf", note: "Ex-US developed", ccy: "USD" },
  { sym: "VWO", name: "Vanguard Emerging Markets", cat: "etf", note: "Emerging markets", ccy: "USD" },
  { sym: "VXUS", name: "Vanguard Total Intl Stock", cat: "etf", note: "Ex-US total", ccy: "USD" },
  { sym: "VWRA.L", name: "Vanguard FTSE All-World (Acc)", cat: "etf", note: "LSE · Accumulating", ccy: "USD" },
  { sym: "CSPX.L", name: "iShares Core S&P 500", cat: "etf", note: "LSE · UCITS", ccy: "USD" },
  { sym: "EIMI.L", name: "iShares Core MSCI EM IMI", cat: "etf", note: "LSE · UCITS", ccy: "USD" },
  // Bond ETFs
  { sym: "BND", name: "Vanguard Total Bond Market", cat: "bond", note: "US aggregate bonds", ccy: "USD" },
  { sym: "AGG", name: "iShares Core US Aggregate", cat: "bond", note: "US aggregate bonds", ccy: "USD" },
  { sym: "IEF", name: "iShares 7-10Y Treasury", cat: "bond", note: "US Treasuries", ccy: "USD" },
  { sym: "TLT", name: "iShares 20+Y Treasury", cat: "bond", note: "Long US Treasuries", ccy: "USD" },
  { sym: "SHY", name: "iShares 1-3Y Treasury", cat: "bond", note: "Short US Treasuries", ccy: "USD" },
  { sym: "LQD", name: "iShares iBoxx Inv Grade", cat: "bond", note: "Corporate bonds", ccy: "USD" },
  { sym: "HYG", name: "iShares High Yield Corp", cat: "bond", note: "High yield", ccy: "USD" },
  { sym: "EMB", name: "iShares JPM USD EM Bond", cat: "bond", note: "EM sovereigns", ccy: "USD" },
  { sym: "VWOB", name: "Vanguard EM Gov Bond USD", cat: "bond", note: "EM government", ccy: "USD" },
  { sym: "BNDX", name: "Vanguard Total Intl Bond", cat: "bond", note: "Ex-US bonds (hedged)", ccy: "USD" },
];

export const CATEGORY_LABELS = { stock: "Stocks", etf: "ETFs", bond: "Bonds" };
