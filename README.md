# TBC Invest Simulator

**Live demo:** https://tbc-invest-simulator-ryzenadvanceds-projects.vercel.app

Live-price "what if I had invested" simulator for instruments retail investors can trade via
TBC Bank Georgia / TBC Capital brokerage: Georgian banks on the LSE, US stocks, global equity
ETFs, and bond ETFs.

## Features
- Instrument picker (Stocks / ETFs / Bonds) with live prices & daily change
- Pick entry date + invested amount + X-day horizon + target gain %
- Real historical adj-close prices → paper P/L, annualized return, goal-hit date, progress bar
- Volatility-based projection (μ±σ) when the horizon extends into the future
- Total-return basis (dividends & splits adjusted)

## Data
Yahoo Finance chart API via a serverless proxy (`/api/history`) with browser UA and host fallback.
No API key needed. Unofficial tool — not affiliated with or endorsed by TBC Bank.

## Run locally

```bash
vercel dev
```
