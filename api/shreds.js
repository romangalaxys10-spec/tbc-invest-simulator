// Crypto shreds: raw on-chain telemetry from free public Solana RPCs.
// Scans ~8 confirmed blocks: DEX program flow (top + inner instructions),
// largest token flows with live SOL pricing, fail ratio, network velocity.
// (True shred streaming = Jito ShredStream gRPC, paid; this is the free
// raw-RPC approximation, slot-fresh.)

import { fetchChart } from "../lib/yahoo.js";

const RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];

async function rpc(method, params = []) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("RPC failed");
}

const PROGRAMS = [
  { id: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", name: "Jupiter" },
  { id: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", name: "Raydium AMM" },
  { id: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", name: "Raydium CLMM" },
  { id: "6EF8rrecthR8Dkzon1NaiLja4gDr39TQF5k9pQN1K4uj", name: "Pump.fun" },
  { id: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", name: "Orca" },
  { id: "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", name: "OpenBook" },
];
const MINTS = {
  So11111111111111111111111111111111111111112: "wSOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};

export default async function handler(req, res) {
  try {
    const [perf, info, solChart] = await Promise.all([
      rpc("getRecentPerformanceSamples", [6]),
      rpc("getEpochInfo"),
      fetchChart("SOL-USD", Math.floor(Date.now() / 1000) - 5 * 86400, Math.floor(Date.now() / 1000) + 86400).catch(() => null),
    ]);
    const solPrice = solChart?.meta?.regularMarketPrice ?? null;
    const latest = perf[0];
    const tps = latest.numTransactions / latest.samplePeriodSecs;
    const slotMs = (latest.samplePeriodSecs / latest.numSlots) * 1000;
    const slot = info.absoluteSlot;

    const blocks = (
      await Promise.all(
        [2, 3, 4, 5, 6, 7, 8, 9].map((off) =>
          rpc("getBlock", [slot - off, { encoding: "jsonParsed", transactionDetails: "full", rewards: false, maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null)
        )
      )
    ).filter(Boolean);

    const counts = Object.fromEntries(PROGRAMS.map((p) => [p.id, 0]));
    const flows = [];
    let vol = { wSOL: 0, USDC: 0, USDT: 0 };
    let fails = 0, totalTx = 0;

    for (const b of blocks) {
      for (const tx of b.transactions || []) {
        totalTx++;
        if (tx.meta?.err) fails++;
        const all = [...(tx.transaction?.message?.instructions || [])];
        for (const inn of tx.meta?.innerInstructions || []) all.push(...(inn.instructions || []));
        const sig = tx.transaction?.signatures?.[0];
        for (const ix of all) {
          if (ix.programId in counts) counts[ix.programId]++;
          const p = ix.parsed;
          if (!p) continue;
          // native SOL transfers
          if (p.type === "transfer" && p.info?.lamports >= 20 * 1e9) {
            flows.push({ sym: "SOL", amt: p.info.lamports / 1e9, usd: ((p.info.lamports / 1e9) * (solPrice || 0)), from: p.info.source, to: p.info.destination, sig, slot: slot - 1 });
          }
          // token transfers (wSOL + stables)
          if ((p.type === "transferChecked" || p.type === "transfer") && p.info?.tokenAmount?.uiAmount != null) {
            const sym = MINTS[p.info.mint];
            if (!sym) continue;
            const amt = p.info.tokenAmount.uiAmount;
            vol[sym] += amt;
            const usd = sym === "wSOL" ? amt * (solPrice || 0) : amt;
            if (usd >= 3000) {
              flows.push({ sym, amt, usd, from: p.info.source || p.info.authority || "?", to: p.info.destination || "?", sig, slot: slot - 1 });
            }
          }
        }
      }
    }

    flows.sort((a, b) => b.usd - a.usd);
    const programs = PROGRAMS.map((p) => ({ name: p.name, count: counts[p.id] })).sort((a, b) => b.count - a.count);
    const volUsd = { wSOL: vol.wSOL * (solPrice || 0), USDC: vol.USDC, USDT: vol.USDT };

    // SOL momentum from the chart we already fetched
    let solChange24h = null, solChange7d = null;
    try {
      const cs = solChart ? (solChart.timestamp || []) : [];
      const cls = solChart ? (solChart.indicators?.quote?.[0]?.close || []) : [];
      const lastC = cls[cls.length - 1];
      if (lastC && cls.length > 2) solChange24h = lastC / cls[cls.length - 2] - 1;
      if (lastC && cls.length > 8) solChange7d = lastC / cls[cls.length - 8] - 1;
    } catch {}

    // flow bias: stablecoin share vs SOL share into DEX flow, adjusted by momentum & congestion
    const stableVolUsd = volUsd.USDC + volUsd.USDT;
    const totalFlow = stableVolUsd + volUsd.wSOL;
    let buyBias = 50;
    if (totalFlow > 0) buyBias += ((stableVolUsd / totalFlow) - 0.5) * 60;
    if (solChange24h != null) buyBias += solChange24h > 0 ? 8 : -8;
    if (totalTx && fails / totalTx > 0.18) buyBias = 50 + (buyBias - 50) * 0.6; // congestion = uncertainty
    buyBias = Math.max(2, Math.min(98, Math.round(buyBias)));
    const biasLabel = buyBias >= 65 ? "Strong buy flow" : buyBias >= 55 ? "Buy lean" : buyBias > 45 ? "Balanced" : buyBias > 35 ? "Sell lean" : "Strong sell flow";

    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=15");
    res.status(200).json({
      slot, solPrice, tps: +tps.toFixed(0), slotMs: +slotMs.toFixed(0),
      blocksScanned: blocks.length, slotsRange: blocks.length ? [slot - blocks.length - 1, slot - 2] : null,
      totalTx, failRate: totalTx ? +(fails / totalTx).toFixed(3) : null,
      dexCalls: programs.reduce((s, p) => s + p.count, 0),
      flows: flows.slice(0, 10),
      programs, volUsd, solChange24h: solChange24h != null ? +solChange24h.toFixed(4) : null, solChange7d: solChange7d != null ? +solChange7d.toFixed(4) : null, buyBias, biasLabel,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    res.status(502).json({ error: `Shred feed unavailable (${e.message})` });
  }
}
