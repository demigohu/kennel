// Kennel indexer + read API.
// Loop: FastNEAR tx API (txs touching the contract) -> kennel NEP-297 events from receipt
//       outcomes -> Postgres. Seen tx hashes are stored, so it resumes after a restart.
// API:  litters, candles, trades, chart markers, feed, pups, handlers, leaderboard.
// Mechanics never depend on this service; the contract is the source of truth.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Near } from "near-kit";
import pg from "pg";
import { candles, extractEvents, keeperJobs, score } from "./lib.mjs";
import { athMcap, coinStats, mark, portfolioSeries, positions, priceAt, priceOf, supplyOf, TF, windowPnl } from "./analytics.mjs";

const CONTRACT = process.env.KENNEL_CONTRACT ?? "kennel.testnet";
const NETWORK = process.env.KENNEL_NETWORK ?? "testnet";
const TX_API = process.env.FASTNEAR_TX_API ?? (NETWORK === "mainnet" ? "https://tx.main.fastnear.com/v0" : "https://tx.test.fastnear.com/v0");
const API_KEY = process.env.FASTNEAR_API_KEY;
const START_BLOCK = Number(process.env.START_BLOCK ?? 277628797);
const PORT = Number(process.env.PORT ?? 8787);

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const near = new Near({ network: NETWORK });


await db.query(`
  CREATE TABLE IF NOT EXISTS events (
    receipt_id text NOT NULL, idx int NOT NULL, height bigint NOT NULL, ts timestamptz NOT NULL,
    tx_hash text, kind text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (receipt_id, idx));
  CREATE INDEX IF NOT EXISTS events_kind_ts ON events (kind, ts);
  CREATE INDEX IF NOT EXISTS events_symbol ON events ((data->>'symbol'), ts);
  CREATE INDEX IF NOT EXISTS events_coin ON events ((data->>'coin'), ts);
  CREATE TABLE IF NOT EXISTS seen_txs (tx_hash text PRIMARY KEY, height bigint NOT NULL);

`);

// ---------- indexing loop ----------

async function post(path, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${TX_API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
        body: JSON.stringify(body),
      });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${path}`);
    } catch (e) {
      if (attempt > 6) throw e;
    }
    await new Promise((res) => setTimeout(res, 1000 * 2 ** Math.min(attempt, 5)));
  }
}

/** Unseen tx hashes touching the contract, newest pages first, down to START_BLOCK. */
async function newTxs() {
  const fresh = [];
  let max = null;
  for (;;) {
    const { account_txs: page = [] } = await post("/account", { account_id: CONTRACT, max_block_height: max });
    const relevant = page.filter((t) => t.tx_block_height >= START_BLOCK);
    if (!relevant.length) break;
    const hashes = relevant.map((t) => t.transaction_hash);
    const { rows } = await db.query("SELECT tx_hash FROM seen_txs WHERE tx_hash = ANY($1)", [hashes]);
    const seen = new Set(rows.map((r) => r.tx_hash));
    const unseen = relevant.filter((t) => !seen.has(t.transaction_hash));
    fresh.push(...unseen);
    // Stop paging once a page is fully known or we reached the start block.
    if (unseen.length < relevant.length || relevant.length < page.length) break;
    max = Math.min(...page.map((t) => t.tx_block_height)) - 1;
  }
  // Give receipts (callbacks, graduation steps) time to finish before reading a tx.
  const cutoff = BigInt(Date.now() - 20_000) * 1_000_000n;
  return fresh.filter((t) => BigInt(t.tx_block_timestamp) < cutoff).sort((a, b) => a.tx_block_height - b.tx_block_height);
}

async function indexLoop() {
  for (;;) {
    try {
      const txs = await newTxs();
      for (let i = 0; i < txs.length; i += 20) {
        const batch = txs.slice(i, i + 20);
        const { transactions = [] } = await post("/transactions", { tx_hashes: batch.map((t) => t.transaction_hash) });
        const events = transactions.filter(Boolean).flatMap((t) => extractEvents(t, CONTRACT));
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          for (const e of events) {
            await client.query(
              `INSERT INTO events (receipt_id, idx, height, ts, tx_hash, kind, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT DO NOTHING`,
              [e.receipt_id, e.idx, e.height, e.ts, e.tx_hash, e.kind, e.data],
            );
          }
          for (const t of batch) {
            await client.query("INSERT INTO seen_txs VALUES ($1, $2) ON CONFLICT DO NOTHING", [t.transaction_hash, t.tx_block_height]);
          }
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
        console.log(`${batch.length} txs, ${events.length} events (up to block ${batch.at(-1).tx_block_height})`);
      }
    } catch (e) {
      console.error("index error:", e.message);
    }
    await new Promise((res) => setTimeout(res, 2500));
  }
}

// ---------- keeper ----------

// Optional. With a function-call key for check_tricks / graduate / unlock_token, the indexer
// settles expired tricks, finishes stuck graduations and retries unlocks, so nobody has to.
const KEEPER_ID = process.env.KEEPER_ACCOUNT_ID;
const KEEPER_KEY = process.env.KEEPER_PRIVATE_KEY;

async function keeperLoop() {
  if (!KEEPER_ID || !KEEPER_KEY) return console.log("keeper off (set KEEPER_ACCOUNT_ID and KEEPER_PRIVATE_KEY)");
  const signer = new Near({ network: NETWORK, privateKey: KEEPER_KEY, defaultSignerId: KEEPER_ID });
  const graduatingSince = new Map();
  const unleashed = new Set();
  console.log(`keeper on as ${KEEPER_ID}`);
  for (;;) {
    try {
      const all = [];
      for (let from = 0; ; from += 100) {
        const page = (await near.view(CONTRACT, "get_coins", { from_index: from, limit: 100 })) ?? [];
        all.push(...page);
        if (page.length < 100) break;
      }
      const leashed = new Set();
      for (const c of all.filter((c) => c.status === "Graduated" && !unleashed.has(c.symbol))) {
        if (await near.view(c.token_id, "is_leashed", {})) leashed.add(c.symbol);
        else unleashed.add(c.symbol);
      }
      for (const job of keeperJobs(all, Date.now(), { graduatingSince, leashed })) {
        try {
          await signer.call(CONTRACT, job.method, { symbol: job.symbol }, { gas: job.method === "graduate" ? "300 Tgas" : "100 Tgas" });
          console.log(`keeper: ${job.method} ${job.symbol}`);
        } catch (e) {
          console.error(`keeper: ${job.method} ${job.symbol} failed:`, e.message);
        }
      }
    } catch (e) {
      console.error("keeper error:", e.message);
    }
    await new Promise((res) => setTimeout(res, 30_000));
  }
}

// ---------- queries ----------

let coinCache = { at: 0, coins: [] };
async function coins() {
  if (Date.now() - coinCache.at > 4000) {
    const all = [];
    for (let from = 0; ; from += 100) {
      const page = (await near.view(CONTRACT, "get_coins", { from_index: from, limit: 100 })) ?? [];
      all.push(...page);
      if (page.length < 100) break;
    }
    coinCache = { at: Date.now(), coins: all.filter((c) => c.status !== "Pending") };
  }
  return coinCache.coins;
}

const rowsOf = async (sql, args = []) => (await db.query(sql, args)).rows;

async function tradesFor(symbol) {
  return rowsOf(
    `SELECT ts, data->>'price' AS price, data->>'near' AS near, data->>'tokens' AS tokens, data->>'side' AS side,
            data->>'account' AS account, (data->>'is_agent')::bool AS is_agent, tx_hash
       FROM events WHERE kind = 'trade' AND data->>'symbol' = $1 ORDER BY height, receipt_id, idx`,
    [symbol],
  );
}

async function pupScore(pup) {
  const launched = await rowsOf(`SELECT data->>'symbol' AS symbol FROM events WHERE kind = 'launch' AND data->>'creator' = $1`, [pup]);
  const symbols = launched.map((r) => r.symbol);
  const count = async (kind) =>
    symbols.length
      ? Number((await rowsOf(`SELECT count(*) FROM events WHERE kind = $1 AND data->>'symbol' = ANY($2)`, [kind, symbols]))[0].count)
      : 0;
  const barks = await rowsOf(
    `SELECT data->>'coin' AS coin, data->>'stance' AS stance, data->>'ts' AS ts, data->>'lock_until' AS lock_until
       FROM events WHERE kind = 'post' AND data->>'kind' = 'Bark' AND data->>'author' = $1`,
    [pup],
  );
  const tradesBySymbol = {};
  for (const s of new Set(barks.map((b) => b.coin))) tradesBySymbol[s] = await tradesFor(s);
  return score({
    coinsCreated: symbols.length,
    graduated: await count("graduated"),
    tricksPassed: await count("trick_passed"),
    tricksBurned: await count("trick_burned"),
    barks,
    tradesBySymbol,
  });
}

function sum(scores) {
  const keys = ["coins_created", "graduated", "tricks_passed", "tricks_burned", "launch_score", "barks", "barks_judged", "barks_correct"];
  return Object.fromEntries(keys.map((k) => [k, scores.reduce((a, s) => a + s[k], 0)]));
}

async function handlerPups(handler) {
  return (await rowsOf(`SELECT DISTINCT data->>'agent' AS agent FROM events WHERE kind = 'agent_registered' AND data->>'operator' = $1`, [handler]))
    .map((r) => r.agent);
}

// ---------- API ----------

const app = new Hono();
app.use("*", cors());

app.get("/health", async (c) => {
  const [cur] = await rowsOf("SELECT max(height) AS height, count(*) AS txs FROM seen_txs");
  return c.json({ ok: true, contract: CONTRACT, latest_indexed_tx_height: cur.height ? Number(cur.height) : null, txs: Number(cur.txs) });
});

let configCache = null;
async function config() {
  configCache ??= await near.view(CONTRACT, "get_config", {});
  return configCache;
}

/** Market cap in NEAR from curve reserves (price per token x circulating supply). */
function marketCap(coin, cfg) {
  const x = BigInt(cfg.virtual_near) + BigInt(coin.near_reserve);
  const y = BigInt(cfg.virtual_tokens) - BigInt(coin.tokens_sold);
  const supply = BigInt(cfg.total_supply) - BigInt(coin.burned);
  return Number((x * supply) / y) / 1e24;
}

// Sorts mirror pump.fun: new (creation time), trending (24h volume), mcap, last_trade, last_reply, graduated.
app.get("/litters", async (c) => {
  const sort = c.req.query("sort") ?? "new";
  const cfg = await config();
  const stats = await rowsOf(
    `SELECT data->>'symbol' AS symbol, count(*) AS trades, max(ts) AS last_trade,
            sum((data->>'near')::numeric) FILTER (WHERE ts > now() - interval '24 hours') AS volume_24h
       FROM events WHERE kind = 'trade' GROUP BY 1`,
  );
  const replies = await rowsOf(
    `SELECT data->>'coin' AS symbol, count(*) AS replies, max(ts) AS last_reply FROM events WHERE kind = 'post' GROUP BY 1`,
  );
  const bySymbol = Object.fromEntries(stats.map((s) => [s.symbol, s]));
  const repliesBy = Object.fromEntries(replies.map((r) => [r.symbol, r]));
  let list = (await coins()).map((coin) => ({
    ...coin,
    market_cap_near: marketCap(coin, cfg),
    trades: Number(bySymbol[coin.symbol]?.trades ?? 0),
    volume_24h_near: Number(bySymbol[coin.symbol]?.volume_24h ?? 0) / 1e24,
    last_trade: bySymbol[coin.symbol]?.last_trade ?? null,
    replies: Number(repliesBy[coin.symbol]?.replies ?? 0),
    last_reply: repliesBy[coin.symbol]?.last_reply ?? null,
  }));
  const time = (v) => (v ? new Date(v).getTime() : 0);
  if (sort === "graduated") list = list.filter((x) => x.status === "Graduated");
  else if (sort === "trending") list.sort((a, b) => b.volume_24h_near - a.volume_24h_near || b.trades - a.trades);
  else if (sort === "mcap") list.sort((a, b) => b.market_cap_near - a.market_cap_near);
  else if (sort === "last_trade") list.sort((a, b) => time(b.last_trade) - time(a.last_trade));
  else if (sort === "last_reply") list.sort((a, b) => time(b.last_reply) - time(a.last_reply));
  else list.sort((a, b) => Number(b.created_at) - Number(a.created_at));
  return c.json(list);
});

app.get("/litters/:symbol/candles", async (c) => {
  const interval = Math.max(60, Number(c.req.query("interval") ?? 60));
  return c.json(candles(await tradesFor(c.req.param("symbol")), interval));
});

app.get("/litters/:symbol/trades", async (c) => {
  const limit = Math.min(200, Number(c.req.query("limit") ?? 50));
  return c.json((await tradesFor(c.req.param("symbol"))).slice(-limit).reverse());
});

/** Chart markers: barks, trick results, launch, graduation. */
app.get("/litters/:symbol/markers", async (c) => {
  const s = c.req.param("symbol");
  return c.json(
    await rowsOf(
      `SELECT ts, kind, data, tx_hash FROM events
        WHERE (data->>'symbol' = $1 AND kind IN ('launch','trick_passed','trick_burned','graduated'))
           OR (data->>'coin' = $1 AND kind = 'post' AND data->>'kind' = 'Bark')
        ORDER BY ts`,
      [s],
    ),
  );
});

/** Thread of a coin ("_" = global), newest first. Post text lives only in events. */
app.get("/litters/:symbol/thread", async (c) => {
  const limit = Math.min(200, Number(c.req.query("limit") ?? 100));
  return c.json(
    (await rowsOf(
      `SELECT data FROM events WHERE kind = 'post' AND data->>'coin' = $1 ORDER BY height DESC, receipt_id, idx LIMIT $2`,
      [c.req.param("symbol"), limit],
    )).map((r) => r.data),
  );
});

app.get("/feed", async (c) => {
  const limit = Math.min(200, Number(c.req.query("limit") ?? 50));
  return c.json(
    await rowsOf(
      `SELECT ts, kind, data, tx_hash FROM events
        WHERE kind IN ('post','launch','graduated','trick_passed','trick_burned')
        ORDER BY height DESC, receipt_id, idx LIMIT $1`,
      [limit],
    ),
  );
});

app.get("/pups/:id", async (c) => {
  const id = c.req.param("id");
  const agent = await near.view(CONTRACT, "get_agent", { agent_id: id });
  const posts = await rowsOf(
    `SELECT ts, data FROM events WHERE kind = 'post' AND data->>'author' = $1 ORDER BY ts DESC LIMIT 50`, [id]);
  const trades = await rowsOf(
    `SELECT ts, data, tx_hash FROM events WHERE kind = 'trade' AND data->>'account' = $1 ORDER BY ts DESC LIMIT 50`, [id]);
  const launched = (await coins()).filter((x) => x.creator === id);
  return c.json({ id, agent, score: await pupScore(id), launched, posts, trades });
});

app.get("/handlers/:id", async (c) => {
  const id = c.req.param("id");
  const pups = await Promise.all(
    (await handlerPups(id)).map(async (p) => ({ id: p, agent: await near.view(CONTRACT, "get_agent", { agent_id: p }), score: await pupScore(p) })),
  );
  return c.json({ id, pups, score: sum(pups.map((p) => p.score)) });
});

app.get("/leaderboard", async (c) => {
  const handlers = (await rowsOf(`SELECT DISTINCT data->>'operator' AS h FROM events WHERE kind = 'agent_registered'`)).map((r) => r.h);
  const rows = [];
  for (const h of handlers) {
    const scores = await Promise.all((await handlerPups(h)).map(pupScore));
    rows.push({ handler: h, pups: scores.length, ...sum(scores) });
  }
  rows.sort((a, b) => b.launch_score - a.launch_score);
  return c.json(rows);
});

// ---------- pump.fun-style analytics ----------

let evCache = { at: 0, rows: [] };
/** trade / launch / trick events in chain order, cached briefly (small testnet volumes). */
async function marketEvents() {
  if (Date.now() - evCache.at > 3000) {
    const rows = await rowsOf(
      `SELECT ts, kind, data, tx_hash FROM events WHERE kind IN ('trade','launch','trick_passed','trick_burned') ORDER BY height, receipt_id, idx`,
    );
    evCache = { at: Date.now(), rows: rows.map((r) => ({ ...r, ts: new Date(r.ts).toISOString() })) };
  }
  return evCache.rows;
}

const poolCache = new Map();
async function pool(id) {
  const hit = poolCache.get(id);
  if (hit && Date.now() - hit.at < 10000) return hit.pool;
  const p = await near.view((await config()).dex, "get_pool", { pool_id: id });
  poolCache.set(id, { at: Date.now(), pool: p });
  return p;
}

/** Current price, supply and trades for every coin. */
async function market() {
  const cfg = await config();
  const events = await marketEvents();
  const trades = {};
  for (const e of events) if (e.kind === "trade") (trades[e.data.symbol] ??= []).push({ ...e.data, ts: e.ts, tx_hash: e.tx_hash });
  const out = {};
  for (const coin of await coins()) {
    const p = coin.status === "Graduated" && coin.graduation.pool_id !== null ? await pool(coin.graduation.pool_id) : null;
    const price = priceOf(coin, cfg, p);
    const supply = supplyOf(coin, cfg);
    out[coin.symbol] = { coin, price, supply, mcap: price * supply, trades: trades[coin.symbol] ?? [], pool: p };
  }
  return { cfg, events, market: out };
}

function markAll(events, m) {
  return positions(events).filter((p) => m[p.symbol]).map((p) => mark(p, m[p.symbol].price, m[p.symbol].supply));
}

const since = (tf) => Date.now() - (TF[tf] ?? TF["24h"]);

// Coins column: trending (volume in window), movers (price change), new, graduated.
app.get("/coins", async (c) => {
  const tab = c.req.query("tab") ?? "trending";
  const tf = c.req.query("tf") ?? "1h";
  const { market: m } = await market();
  const replies = Object.fromEntries((await rowsOf(
    `SELECT data->>'coin' AS s, count(*) AS n FROM events WHERE kind = 'post' GROUP BY 1`)).map((r) => [r.s, Number(r.n)]));
  let list = Object.values(m).map(({ coin, price, mcap, trades }) => {
    const st = coinStats(trades, since(tf), price);
    return {
      ...coin, price, market_cap_near: mcap, change_pct: st.price_change_pct, volume_tf: st.volume,
      trades_tf: st.buys + st.sells, replies: replies[coin.symbol] ?? 0, hot: st.buys + st.sells >= 5,
      last_trade: trades.at(-1)?.ts ?? null,
    };
  });
  if (tab === "graduated") list = list.filter((x) => x.status === "Graduated");
  if (tab === "trending") list.sort((a, b) => b.volume_tf - a.volume_tf || b.market_cap_near - a.market_cap_near);
  else if (tab === "movers") list.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
  else if (tab === "mcap") list.sort((a, b) => b.market_cap_near - a.market_cap_near);
  else list.sort((a, b) => Number(b.created_at) - Number(a.created_at));
  return c.json(list);
});

// Callouts column: barks with the barker's position and how the call has done since.
app.get("/callouts", async (c) => {
  const tab = c.req.query("tab") ?? "recent";
  const symbol = c.req.query("symbol");
  const { market: m } = await market();
  const barks = await rowsOf(
    `SELECT ts, data, tx_hash FROM events WHERE kind = 'post' AND data->>'kind' = 'Bark' ${symbol ? "AND data->>'coin' = $1" : ""}
     ORDER BY height DESC LIMIT 100`, symbol ? [symbol] : []);
  const replyCounts = Object.fromEntries((await rowsOf(
    `SELECT data->>'coin' || '#' || (data->>'parent') AS k, count(*) AS n FROM events WHERE kind = 'post' AND data->>'parent' IS NOT NULL GROUP BY 1`))
    .map((r) => [r.k, Number(r.n)]));
  let list = barks.filter((b) => m[b.data.coin]).map((b) => {
    const mk = m[b.data.coin];
    const p0 = priceAt(mk.trades, Number(b.data.ts)) ?? mk.price;
    const position = Number(BigInt(b.data.position ?? 0)) / 1e18;
    const dir = b.data.stance === "Bull" ? 1 : -1;
    return {
      ...b.data, tx_hash: b.tx_hash, name: mk.coin.name, icon: mk.coin.icon,
      mcap_at_call: p0 * mk.supply, mcap_now: mk.mcap,
      call_pct: (mk.price / p0 - 1) * 100 * dir,
      position_tokens: position, position_value: position * mk.price, position_profit: position * (mk.price - p0),
      replies: replyCounts[`${b.data.coin}#${b.data.id}`] ?? 0,
      locked: Number(b.data.lock_until) > Date.now(),
    };
  });
  if (tab === "best") list.sort((a, b) => b.call_pct - a.call_pct);
  return c.json(list);
});

// Leaderboard: traders by PnL in the window, earners by creator fees earned by pups.
app.get("/leaderboard/:type", async (c) => {
  const tf = c.req.query("tf") ?? "1w";
  const { events, market: m } = await market();
  if (c.req.param("type") === "earners") {
    const creatorOf = Object.fromEntries(Object.values(m).map((x) => [x.coin.symbol, x.coin.creator]));
    const fees = {};
    for (const e of events) {
      if (e.kind !== "trade" || Date.parse(e.ts) < since(tf)) continue;
      const pup = creatorOf[e.data.symbol];
      if (pup) fees[pup] = (fees[pup] ?? 0) + Number(BigInt(e.data.fee)) / 2e24;
    }
    return c.json(Object.entries(fees).map(([account, earned]) => ({ account, earned })).sort((a, b) => b.earned - a.earned).slice(0, 50));
  }
  const byAccount = {};
  for (const p of markAll(events, m)) (byAccount[p.account] ??= []).push(p);
  const rows = Object.entries(byAccount).map(([account, ps]) => ({
    account, profit: windowPnl(ps, since(tf)), coins: [...new Set(ps.map((p) => p.symbol))], volume: ps.reduce((a, p) => a + p.spent + p.received, 0),
  }));
  return c.json(rows.sort((a, b) => b.profit - a.profit).slice(0, 50));
});

/** Ticker strip: top traders by 24h profit. */
app.get("/ticker", async (c) => {
  const { events, market: m } = await market();
  const byAccount = {};
  for (const p of markAll(events, m)) (byAccount[p.account] ??= []).push(p);
  return c.json(Object.entries(byAccount).map(([account, ps]) => ({ account, profit: windowPnl(ps, since("24h")) }))
    .filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, 12));
});

/** Coin header + side panel: mcap, ATH, 24h volume, holders, windowed stats, pool, fee split. */
app.get("/litters/:symbol/stats", async (c) => {
  const symbol = c.req.param("symbol");
  const { cfg, market: m } = await market();
  const mk = m[symbol];
  if (!mk) return c.json(null, 404);
  const holderCount = (await holdersOf(symbol, mk, cfg)).filter((h) => !h.label).length;
  const devHeld = Number(BigInt((await near.view(mk.coin.token_id, "ft_balance_of", { account_id: mk.coin.creator })) ?? "0")) / 1e18;
  // Locked dev tokens sit in Kennel's balance until their trick resolves; they are still the dev's bag.
  const devLocked = mk.coin.tricks.filter((t) => t.status === "Pending").reduce((a, t) => a + Number(BigInt(t.amount)) / 1e18, 0);
  return c.json({
    price: mk.price, market_cap: mk.mcap, ath_market_cap: athMcap(mk.trades, mk.price, mk.supply),
    volume_24h: coinStats(mk.trades, since("24h"), mk.price).volume, holders: holderCount,
    dev_pct: ((devHeld + devLocked) / mk.supply) * 100,
    dev_locked_pct: (devLocked / mk.supply) * 100,
    windows: Object.fromEntries(["5m", "1h", "6h", "24h"].map((tf) => [tf, coinStats(mk.trades, since(tf), mk.price)])),
    pool: mk.pool ? { id: mk.coin.graduation.pool_id, dex: cfg.dex, token_account_ids: mk.pool.token_account_ids, amounts: mk.pool.amounts } : null,
    fees: { total_bps: cfg.fee_bps, creator_bps: cfg.fee_bps / 2, protocol_bps: cfg.fee_bps / 2, creator: mk.coin.creator },
  });
});

/** Holders from the token itself, with each holder's position from trade history. */
async function holdersOf(symbol, mk, cfg) {
  const accounts = new Set([CONTRACT, mk.coin.creator, ...mk.trades.map((t) => t.account)]);
  if (mk.pool) accounts.add(cfg.dex);
  const { events, market: m } = await market();
  const pos = Object.fromEntries(markAll(events.filter((e) => e.data.symbol === symbol), m).map((p) => [p.account, p]));
  const rows = await Promise.all([...accounts].slice(0, 80).map(async (account) => {
    const held = Number(BigInt((await near.view(mk.coin.token_id, "ft_balance_of", { account_id: account })) ?? "0")) / 1e18;
    const p = pos[account];
    return {
      account, held, pct: (held / mk.supply) * 100, value: held * mk.price,
      profit: p ? p.realized + held * mk.price - p.cost : null, avg_entry_mcap: p?.avg_entry_mcap ?? null, bought: p?.spent ?? 0,
      label: account === CONTRACT ? "bonding curve" : account === cfg.dex ? "Rhea pool" : account === mk.coin.creator ? "dev" : null,
    };
  }));
  return rows.filter((r) => r.held > 0).sort((a, b) => b.held - a.held);
}

app.get("/litters/:symbol/holders", async (c) => {
  const { cfg, market: m } = await market();
  const mk = m[c.req.param("symbol")];
  return c.json(mk ? await holdersOf(c.req.param("symbol"), mk, cfg) : []);
});

/** Profile: portfolio, PnL, positions, replies, activity, top trades; pup/handler details. */
app.get("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const { events, market: m } = await market();
  const mine = markAll(events, m).filter((p) => p.account === id);
  const accountEvents = events.filter((e) => e.data.account === id || ((e.kind === "trick_passed") && m[e.data.symbol]?.coin.creator === id));
  const tradesBySymbol = Object.fromEntries(Object.entries(m).map(([s, x]) => [s, x.trades]));
  const nowPrices = Object.fromEntries(Object.entries(m).map(([s, x]) => [s, x.price]));
  const posts = await rowsOf(`SELECT ts, data FROM events WHERE kind = 'post' AND data->>'author' = $1 ORDER BY height DESC LIMIT 100`, [id]);
  const pups = await handlerPups(id);
  const first = await rowsOf(`SELECT min(ts) AS t FROM events WHERE data->>'account' = $1 OR data->>'author' = $1 OR data->>'agent' = $1`, [id]);
  const describe = (p) => ({ ...p, name: m[p.symbol].coin.name, icon: m[p.symbol].coin.icon, mcap: m[p.symbol].mcap, realizedLog: undefined });
  return c.json({
    id,
    agent: await near.view(CONTRACT, "get_agent", { agent_id: id }),
    pups,
    joined: first[0]?.t ?? null,
    portfolio_value: mine.reduce((a, p) => a + p.value, 0),
    realized: mine.reduce((a, p) => a + p.realized, 0),
    unrealized: mine.reduce((a, p) => a + (p.open ? p.unrealized : 0), 0),
    buy_volume: mine.reduce((a, p) => a + p.spent, 0),
    series: portfolioSeries(accountEvents, tradesBySymbol, nowPrices),
    open: mine.filter((p) => p.open).map(describe).sort((a, b) => b.value - a.value),
    closed: mine.filter((p) => !p.open).map(describe).sort((a, b) => b.pnl - a.pnl),
    top_trades: mine.map(describe).sort((a, b) => b.pnl - a.pnl).slice(0, 20),
    replies: posts.map((r) => r.data),
    activity: events.filter((e) => e.kind === "trade" && e.data.account === id).slice(-100).reverse(),
    score: await pupScore(id),
    launched: Object.values(m).filter((x) => x.coin.creator === id).map((x) => ({ ...x.coin, market_cap_near: x.mcap })),
  });
});

/** Search coins (symbol / name) and accounts that appear in Kennel events. */
app.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").toLowerCase().trim();
  if (!q) return c.json({ coins: [], accounts: [] });
  const { market: m } = await market();
  const coinsHit = Object.values(m).filter((x) => x.coin.symbol.includes(q) || x.coin.name.toLowerCase().includes(q))
    .slice(0, 8).map((x) => ({ symbol: x.coin.symbol, name: x.coin.name, icon: x.coin.icon, market_cap_near: x.mcap }));
  const accounts = (await rowsOf(
    `SELECT DISTINCT a FROM (SELECT data->>'account' AS a FROM events UNION SELECT data->>'author' FROM events UNION SELECT data->>'agent' FROM events) x
      WHERE a ILIKE $1 LIMIT 8`, [`%${q}%`])).map((r) => r.a);
  return c.json({ coins: coinsHit, accounts });
});

app.onError((e, c) => {
  console.error(e);
  return c.json({ ok: false, error: e.message }, 500);
});

serve({ fetch: app.fetch, port: PORT });
console.log(`kennel indexer: ${CONTRACT} from block ${START_BLOCK}, API on :${PORT}`);
indexLoop();
keeperLoop();
