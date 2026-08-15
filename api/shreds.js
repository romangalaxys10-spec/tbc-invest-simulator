// Crypto shreds: raw on-chain telemetry from free public Solana RPCs —
// network velocity, whale transfers and DEX program flow, slot-fresh.
// (True shred streaming requires Jito ShredStream gRPC membership; this is
// the free approximation via raw RPC data.)

const RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];

async function rpc(method, params = []) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
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
  { id: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", name: "Orca Whirlpool" },
  { id: "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", name: "OpenBook" },
];
const STABLES = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};

export default async function handler(req, res) {
  try {
    const perf = await rpc("getRecentPerformanceSamples", [6]);
    const latest = perf[0];
    const tps = latest.numTransactions / latest.samplePeriodSecs;
    const slotMs = (latest.samplePeriodSecs / latest.numSlots) * 1000;

    const info = await rpc("getEpochInfo");
    const slot = info.absoluteSlot;

    let whales = [], programs = [];
    const blockSlot = slot - 2;
    const block = await rpc("getBlock", [blockSlot, { encoding: "jsonParsed", transactionDetails: "full", rewards: false, maxSupportedTransactionVersion: 0 }]);
    if (block?.transactions) {
      const counts = Object.fromEntries(PROGRAMS.map((p) => [p.id, 0]));
      for (const tx of block.transactions.slice(0, 4000)) {
        const sig = tx.transaction?.signatures?.[0];
        for (const ix of tx.transaction?.message?.instructions || []) {
          if (ix.programId in counts) counts[ix.programId]++;
          const p = ix.parsed;
          if (p?.type === "transfer" && p.info?.lamports >= 500 * 1e9) {
            whales.push({ slot: blockSlot, sig, from: p.info.source, to: p.info.destination, amount: p.info.lamports / 1e9, kind: "SOL" });
          }
          if ((p?.type === "transferChecked" || p?.type === "transfer") && p.info?.tokenAmount) {
            const amt = p.info.tokenAmount.uiAmount;
            const mint = p.info.mint;
            if (amt != null && mint in STABLES && amt >= 100000) {
              whales.push({ slot: blockSlot, sig, from: p.info.source || p.info.authority, to: p.info.destination, amount: amt, kind: STABLES[mint] });
            }
          }
        }
      }
      whales = whales.sort((a, b) => b.amount - a.amount).slice(0, 8);
      programs = PROGRAMS.map((p) => ({ name: p.name, count: counts[p.id] })).sort((a, b) => b.count - a.count);
    }

    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=15");
    res.status(200).json({
      slot, tps: +tps.toFixed(0), slotMs: +slotMs.toFixed(0),
      blockHeight: block?.blockHeight ?? null,
      whales, programs,
      sampledTx: block?.transactions?.length ?? 0,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    res.status(502).json({ error: `Shred feed unavailable (${e.message})` });
  }
}
