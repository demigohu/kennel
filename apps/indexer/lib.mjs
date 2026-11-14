// Pure helpers shared by the indexer loop and the API (unit-tested in lib.test.mjs).

/**
 * Kennel NEP-297 events from one FastNEAR transaction (POST /v0/transactions item):
 * [{receipt_id, idx, kind, data, ts, height, tx_hash}].
 */
export function extractEvents(tx, contract) {
  const txHash = tx.transaction.hash;
  const events = [];
  for (const r of tx.receipts ?? []) {
    const eo = r.execution_outcome;
    const o = eo.outcome;
    if (o.executor_id !== contract) continue;
    // A failed receipt rolls back its state, so its logs describe nothing that happened.
    if (o.status?.Failure) continue;
    const ts = new Date(Number(BigInt(eo.block_timestamp) / 1_000_000n));
    o.logs.forEach((log, idx) => {
      if (!log.startsWith("EVENT_JSON:")) return;
      let ev;
      try {
        ev = JSON.parse(log.slice("EVENT_JSON:".length));
      } catch {
        return;
      }
      if (ev.standard !== "kennel") return;
      events.push({ receipt_id: eo.id, idx, kind: ev.event, data: ev.data?.[0] ?? {}, ts, height: eo.block_height, tx_hash: txHash });
    });
  }
  return events;
}

/** Contract prices are yoctoNEAR per whole token (10^18 units). */
export const priceNear = (yoctoPerToken) => Number(BigInt(yoctoPerToken)) / 1e24;

/** OHLCV candles from trades sorted by time. interval in seconds. */
export function candles(trades, interval) {
  const out = [];
  for (const t of trades) {
    const time = Math.floor(new Date(t.ts).getTime() / 1000 / interval) * interval;
    const p = priceNear(t.price);
    const vol = Number(BigInt(t.near)) / 1e24;
    const last = out.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, p);
      last.low = Math.min(last.low, p);
      last.close = p;
      last.volume += vol;
    } else {
      out.push({ time, open: last ? last.close : p, high: p, low: p, close: p, volume: vol });
      const c = out.at(-1);
      c.high = Math.max(c.high, c.open);
      c.low = Math.min(c.low, c.open);
    }
  }
  return out;
}

/** Price (NEAR/token) in effect at time `at`: the last trade at or before it. */
export function priceAt(trades, at) {
  let p = null;
  for (const t of trades) {
    if (new Date(t.ts).getTime() > at) break;
    p = priceNear(t.price);
  }
  return p;
}

/**
 * Kennel score for one pup from its events.
 * launch score = 3*graduated + passed tricks - 2*burned tricks
 * bark record = barks whose lock has ended, judged by price at bark vs at lock end.
 */
export function score({ coinsCreated, graduated, tricksPassed, tricksBurned, barks, tradesBySymbol, now = Date.now() }) {
  let correct = 0;
  let judged = 0;
  for (const b of barks) {
    const end = Number(b.lock_until);
    if (end > now) continue;
    const trades = tradesBySymbol[b.coin] ?? [];
    const p0 = priceAt(trades, Number(b.ts));
    const p1 = priceAt(trades, end);
    if (p0 === null || p1 === null) continue;
    judged++;
    if ((b.stance === "Bull" && p1 > p0) || (b.stance === "Bear" && p1 < p0)) correct++;
  }
  return {
    coins_created: coinsCreated,
    graduated,
    tricks_passed: tricksPassed,
    tricks_burned: tricksBurned,
    launch_score: 3 * graduated + tricksPassed - 2 * tricksBurned,
    barks: barks.length,
    barks_judged: judged,
    barks_correct: correct,
  };
}

/**
 * Keeper work the contract can't schedule itself (NEAR has no cron):
 * - check_tricks for coins with a pending trick past its deadline (burns it),
 * - graduate for coins left Graduating (a last buy without enough gas, or a failed step),
 * - unlock_token for graduated coins whose token is still leashed.
 * `graduatingSince` maps symbol -> first time seen Graduating; a grace period lets an in-flight
 * graduation finish on its own.
 */
export function keeperJobs(coins, nowMs, { graduatingSince = new Map(), leashed = new Set(), graceMs = 60_000 } = {}) {
  const jobs = [];
  for (const c of coins) {
    if (c.status === "Curve" && c.tricks.some((t) => t.status === "Pending" && Number(t.deadline_ms) < nowMs)) {
      jobs.push({ method: "check_tricks", symbol: c.symbol });
    } else if (c.status === "Graduating") {
      if (!graduatingSince.has(c.symbol)) graduatingSince.set(c.symbol, nowMs);
      if (nowMs - graduatingSince.get(c.symbol) >= graceMs) jobs.push({ method: "graduate", symbol: c.symbol });
    } else if (c.status === "Graduated" && leashed.has(c.symbol)) {
      jobs.push({ method: "unlock_token", symbol: c.symbol });
    }
    if (c.status !== "Graduating") graduatingSince.delete(c.symbol);
  }
  return jobs;
}
