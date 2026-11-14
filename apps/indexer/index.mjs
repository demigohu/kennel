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
import { candles, extractEvents, score } from "./lib.mjs";

const CONTRACT = process.env.KENNEL_CONTRACT ?? "kennel.testnet";
const NETWORK = process.env.KENNEL_NETWORK ?? "testnet";
const TX_API = process.env.FASTNEAR_TX_API ?? (NETWORK === "mainnet" ? "https://tx.main.fastnear.com/v0" : "https://tx.test.fastnear.com/v0");
const API_KEY = process.env.FASTNEAR_API_KEY;
const START_BLOCK = Number(process.env.START_BLOCK ?? 277615873);
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

app.get("/litters", async (c) => {
  const sort = c.req.query("sort") ?? "new";
  const stats = await rowsOf(
    `SELECT data->>'symbol' AS symbol, count(*) AS trades,
            sum((data->>'near')::numeric) FILTER (WHERE ts > now() - interval '24 hours') AS volume_24h
       FROM events WHERE kind = 'trade' GROUP BY 1`,
  );
  const bySymbol = Object.fromEntries(stats.map((s) => [s.symbol, s]));
  let list = (await coins()).map((coin) => ({
    ...coin,
    trades: Number(bySymbol[coin.symbol]?.trades ?? 0),
    volume_24h_near: Number(bySymbol[coin.symbol]?.volume_24h ?? 0) / 1e24,
  }));
  if (sort === "graduated") list = list.filter((x) => x.status === "Graduated");
  else if (sort === "trending") list.sort((a, b) => b.volume_24h_near - a.volume_24h_near || b.trades - a.trades);
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

app.onError((e, c) => {
  console.error(e);
  return c.json({ ok: false, error: e.message }, 500);
});

serve({ fetch: app.fetch, port: PORT });
console.log(`kennel indexer: ${CONTRACT} from block ${START_BLOCK}, API on :${PORT}`);
indexLoop();
