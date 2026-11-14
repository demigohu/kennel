// Trading analytics over kennel events (pump.fun-style numbers, in NEAR). Pure functions,
// unit-tested in analytics.test.mjs. Amount strings are base units: NEAR 1e24, tokens 1e18.

const nearOf = (y) => Number(BigInt(y ?? 0)) / 1e24;
const tokensOf = (u) => Number(BigInt(u ?? 0)) / 1e18;
export const TF = { "5m": 300e3, "1h": 3600e3, "6h": 21600e3, "24h": 86400e3, "1d": 86400e3, "1w": 604800e3, all: Infinity };

/** NEAR per whole token: bonding curve while on it, Rhea pool reserves after graduation. */
export function priceOf(coin, cfg, pool) {
  if (coin.status === "Graduated" && pool) {
    const i = pool.token_account_ids.indexOf(coin.token_id);
    return nearOf(pool.amounts[1 - i]) / tokensOf(pool.amounts[i]);
  }
  const x = BigInt(cfg.virtual_near) + BigInt(coin.near_reserve);
  const y = BigInt(cfg.virtual_tokens) - BigInt(coin.tokens_sold);
  return Number((x * 10n ** 18n) / y) / 1e24;
}

export const supplyOf = (coin, cfg) => tokensOf(BigInt(cfg.total_supply) - BigInt(coin.burned));

/** Price of the last trade at or before `at` (ms); falls back to the first trade after it. */
export function priceAt(trades, at) {
  let p = null;
  for (const t of trades) {
    if (Date.parse(t.ts) > at) return p ?? Number(t.price) / 1e24;
    p = Number(t.price) / 1e24;
  }
  return p;
}

/**
 * Average-cost positions per (account, symbol) from time-ordered events
 * ({ts, kind, data}: trade, launch, trick_passed, trick_burned). A creator's dev buy is held
 * "locked" until a trick unlocks it or burns it; a burn is a realized loss.
 */
export function positions(events) {
  const creatorOf = {};
  const pos = new Map();
  const get = (account, symbol) => {
    const k = `${account}|${symbol}`;
    if (!pos.has(k)) {
      pos.set(k, { account, symbol, held: 0, locked: 0, cost: 0, realized: 0, spent: 0, received: 0, buys: 0, sells: 0, first: null, last: null, realizedLog: [] });
    }
    return pos.get(k);
  };
  for (const e of events) {
    const d = e.data;
    if (e.kind === "launch") creatorOf[d.symbol] = d.creator;
    if (e.kind === "trade") {
      const p = get(d.account, d.symbol);
      const tokens = tokensOf(d.tokens);
      p.first ??= e.ts;
      p.last = e.ts;
      if (d.side === "sell") {
        const proceeds = nearOf(d.near) - nearOf(d.fee);
        const basis = p.cost * Math.min(1, tokens / (p.held + p.locked || 1));
        p.cost -= basis;
        p.held = Math.max(0, p.held - tokens);
        p.realized += proceeds - basis;
        p.received += proceeds;
        p.sells++;
        p.realizedLog.push({ ts: e.ts, amount: proceeds - basis });
      } else {
        p.cost += nearOf(d.near);
        p.spent += nearOf(d.near);
        if (d.side === "dev_buy") p.locked += tokens;
        else p.held += tokens;
        p.buys++;
      }
    }
    if ((e.kind === "trick_passed" || e.kind === "trick_burned") && creatorOf[d.symbol]) {
      const p = get(creatorOf[d.symbol], d.symbol);
      const amount = Math.min(tokensOf(d.amount), p.locked);
      p.locked -= amount;
      if (e.kind === "trick_passed") p.held += amount;
      else {
        const basis = p.cost * (amount / (p.held + p.locked + amount || 1));
        p.cost -= basis;
        p.realized -= basis;
        p.realizedLog.push({ ts: e.ts, amount: -basis });
      }
    }
  }
  return [...pos.values()];
}

/** Adds value / unrealized / total PnL / avg entry at the current price. */
export function mark(p, price, supply) {
  const size = p.held + p.locked;
  const value = size * price;
  const unrealized = value - p.cost;
  return {
    ...p,
    price,
    value,
    unrealized,
    pnl: p.realized + unrealized,
    pnl_pct: p.spent ? ((p.realized + unrealized) / p.spent) * 100 : 0,
    avg_entry_mcap: size ? (p.cost / size) * supply : null,
    open: size > 1e-9,
  };
}

/** PnL inside a window: realized in the window plus the current unrealized of open positions. */
export function windowPnl(marked, since) {
  return marked.reduce(
    (a, p) => a + p.realizedLog.filter((r) => Date.parse(r.ts) >= since).reduce((s, r) => s + r.amount, 0) + (p.open ? p.unrealized : 0),
    0,
  );
}

/** pump.fun's side-panel stats for one coin over a window. */
export function coinStats(trades, since, priceNow) {
  const w = trades.filter((t) => Date.parse(t.ts) >= since && t.side !== "dev_buy");
  const buys = w.filter((t) => t.side === "buy");
  const sells = w.filter((t) => t.side === "sell");
  const p0 = priceAt(trades, since);
  return {
    price_change_pct: p0 && priceNow ? (priceNow / p0 - 1) * 100 : 0,
    volume: w.reduce((a, t) => a + nearOf(t.near), 0),
    buys: buys.length,
    sells: sells.length,
    buy_volume: buys.reduce((a, t) => a + nearOf(t.near), 0),
    sell_volume: sells.reduce((a, t) => a + nearOf(t.near), 0),
    buyers: new Set(buys.map((t) => t.account)).size,
    sellers: new Set(sells.map((t) => t.account)).size,
  };
}

/** All-time-high market cap from trade prices (and the current price). */
export function athMcap(trades, priceNow, supply) {
  return Math.max(priceNow, ...trades.map((t) => Number(t.price) / 1e24)) * supply;
}

/** Portfolio value over time: holdings replayed through the account's events, priced at each point. */
export function portfolioSeries(accountEvents, tradesBySymbol, nowPrices, now = Date.now()) {
  const held = {};
  const points = [];
  const valueAt = (at, final) =>
    Object.entries(held).reduce((a, [s, q]) => a + q * ((final ? nowPrices[s] : priceAt(tradesBySymbol[s] ?? [], at)) ?? 0), 0);
  for (const e of accountEvents) {
    const d = e.data;
    if (e.kind === "trade" && d.side !== "dev_buy") held[d.symbol] = (held[d.symbol] ?? 0) + (d.side === "sell" ? -1 : 1) * tokensOf(d.tokens);
    if (e.kind === "trick_passed") held[d.symbol] = (held[d.symbol] ?? 0) + tokensOf(d.amount);
    points.push({ time: Date.parse(e.ts), value: valueAt(Date.parse(e.ts), false) });
  }
  points.push({ time: now, value: valueAt(now, true) });
  return points;
}
