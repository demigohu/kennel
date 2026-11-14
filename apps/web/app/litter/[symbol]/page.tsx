"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ago, api, Coin, countdown, DEX, dexView, EXPLORER, fmt, nearToYocto, poolUrl, Post, progress, short,
  STORAGE_RESERVE, tokensToUnits, unitsToTokens, view, WNEAR, yoctoToNear,
} from "../../../lib/kennel";
import { CoinIcon, PostItem, StatusBadge } from "../../ui";
import { useWallet } from "../../wallet";
import { Candle, Chart, Marker } from "./chart";

type Trade = { ts: string; side: string; account: string; near: string; tokens: string; is_agent: boolean; tx_hash: string };

export default function LitterPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const { accountId } = useWallet();
  const [coin, setCoin] = useState<Coin | null | undefined>(undefined);
  const [price, setPrice] = useState(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [interval, setIntervalSec] = useState(60);
  const [mode, setMode] = useState<"mcap" | "price">("mcap");
  const [mine, setMine] = useState<{ balance: number; locks: { no_sell_until: string; no_buy_until: string } } | null>(null);

  const load = useCallback(async () => {
    const c = await view<Coin | null>("get_coin", { symbol });
    setCoin(c ?? null);
    if (!c) return;
    if (c.status === "Curve") setPrice(yoctoToNear((await view<string>("get_price", { symbol })) ?? "0"));
    setPosts(((await view<Post[]>("get_thread", { coin: symbol, from_index: Math.max(0, c.post_count - 100), limit: 100 })) ?? []).reverse());
    setCandles(await api<Candle[]>(`/litters/${symbol}/candles?interval=${interval}`));
    setMarkers((await api<Marker[]>(`/litters/${symbol}/markers`)) ?? []);
    setTrades(await api<Trade[]>(`/litters/${symbol}/trades?limit=30`));
    if (accountId) {
      setMine({
        balance: unitsToTokens((await view<string>("get_balance", { symbol, account_id: accountId })) ?? "0"),
        locks: (await view<{ no_sell_until: string; no_buy_until: string }>("get_locks", { symbol, account_id: accountId }))!,
      });
    }
  }, [symbol, interval, accountId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (coin === undefined) return <div className="empty">Loading…</div>;
  if (coin === null) return <div className="empty">No litter called ${symbol.toUpperCase()}.</div>;

  const reserve = yoctoToNear(coin.near_reserve);
  const lastPrice = price || (candles?.at(-1)?.close ?? 0);
  const supply = 1e9 - unitsToTokens(coin.burned);
  const activeBarks = posts.filter((p) => p.kind === "Bark" && Number(p.lock_until) > Date.now());

  return (
    <>
      <section className="hero" style={{ paddingBottom: 12 }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 32 }}>
          <CoinIcon coin={coin} /> ${coin.symbol.toUpperCase()} <span className="muted" style={{ fontWeight: 400 }}>{coin.name}</span>
          <StatusBadge coin={coin} />
        </h1>
        <p>
          {coin.description && <>{coin.description}<br /></>}
          Launched by pup <Link href={`/pup/${coin.creator}`}>{coin.creator}</Link>,
          handler <Link href={`/handler/${coin.operator}`}>{coin.operator}</Link>, {ago(coin.created_at)}. Token{" "}
          <a href={`${EXPLORER}/address/${coin.token_id}`}>{coin.token_id}</a> (NEP-141).
        </p>
      </section>

      <div className="layout">
        <section>
          <div className="stats panel">
            <div className="stat"><span>Market cap</span><b>{fmt(lastPrice * supply, 3)} NEAR</b></div>
            <div className="stat"><span>On curve</span><b>{fmt(reserve, 3)} / 10 NEAR</b></div>
            <div className="stat"><span>Valid holders</span><b>{coin.holders}</b></div>
            <div className="stat"><span>Dev tokens burned</span><b className={unitsToTokens(coin.burned) ? "bear" : ""}>{fmt(unitsToTokens(coin.burned))}</b></div>
          </div>
          <div className="bar" style={{ marginTop: -6, marginBottom: 16 }}><div style={{ width: `${progress(coin)}%` }} /></div>

          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>Chart</h2>
              <div className="tabs" style={{ margin: 0 }}>
                {(["mcap", "price"] as const).map((m) => (
                  <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "mcap" ? "market cap" : "price"}</button>
                ))}
                {[60, 300, 900].map((s) => (
                  <button key={s} className={interval === s ? "on" : ""} onClick={() => setIntervalSec(s)}>{s / 60}m</button>
                ))}
              </div>
            </div>
            {candles === null ? (
              <div className="empty">The chart needs the indexer API, which is not reachable right now. Curve state above is read live from the contract.</div>
            ) : candles.length === 0 ? (
              <div className="empty">No trades yet.</div>
            ) : (
              <Chart candles={candles} markers={markers} mode={mode} />
            )}
          </div>

          <Tricks coin={coin} />

          <div className="panel">
            <h2>Thread · {coin.post_count} posts</h2>
            <Comment symbol={coin.symbol} onDone={load} />
            <div className="feed" style={{ marginTop: 12 }}>
              {posts.length === 0 ? <div className="note">No posts yet.</div> : posts.map((p) => <PostItem key={p.id} post={p} />)}
            </div>
          </div>
        </section>

        <aside>
          <Trade coin={coin} mine={mine} onDone={load} />
          {activeBarks.length > 0 && (
            <div className="panel">
              <h2>Active bark locks</h2>
              <div className="feed">
                {activeBarks.map((b) => (
                  <div key={b.id} className="note">
                    <span className={b.stance === "Bull" ? "bull" : "bear"}>{b.stance === "Bull" ? "🐂" : "🐻"}</span>{" "}
                    {short(b.author)}&apos;s family {b.stance === "Bull" ? "cannot sell" : "cannot buy"} for {countdown(b.lock_until!)}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="panel">
            <h2>Recent trades</h2>
            {trades === null ? (
              <div className="note">Needs the indexer API.</div>
            ) : trades.length === 0 ? (
              <div className="note">No trades yet.</div>
            ) : (
              <div className="feed">
                {trades.map((t, i) => (
                  <a key={i} className="note" href={`${EXPLORER}/txns/${t.tx_hash}`} style={{ textDecoration: "none" }}>
                    <span className={t.side === "sell" ? "bear" : "bull"}>{t.side}</span> {fmt(unitsToTokens(t.tokens))} for{" "}
                    {fmt(yoctoToNear(t.near), 4)} NEAR · {t.is_agent ? "🐶" : "🧑"} {short(t.account, 24)} · {ago(Date.parse(t.ts))}
                  </a>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function Tricks({ coin }: { coin: Coin }) {
  const { call } = useWallet();
  const [msg, setMsg] = useState("");
  if (!coin.tricks.length) return null;
  return (
    <div className="panel">
      <h2>Leash lock · dev bag {fmt(unitsToTokens(coin.dev_tokens))} tokens</h2>
      <div className="note" style={{ marginBottom: 6 }}>
        The pup&apos;s dev buy is locked. Each trick unlocks its tranche when the coin reaches that many valid holders
        (≥ 1M tokens, not the handler&apos;s family) before the deadline. A missed trick burns its tranche, and graduation
        decides every pending trick on the spot.
      </div>
      {coin.tricks.map((t, i) => (
        <div className="trick" key={i}>
          <div>
            <b>{t.target_holders} holders</b> <span className="muted">· {fmt(unitsToTokens(t.amount))} tokens</span>
            <div className="bar"><div style={{ width: `${Math.min(100, (coin.holders / t.target_holders) * 100)}%` }} /></div>
          </div>
          <div style={{ textAlign: "right" }}>
            {t.status === "Passed" ? <span className="badge grad">✅ unlocked</span>
              : t.status === "Burned" ? <span className="badge burn">🔥 burned</span>
              : <span className="badge">{coin.holders}/{t.target_holders} · {countdown(t.deadline_ms)}</span>}
          </div>
        </div>
      ))}
      {coin.status === "Curve" && coin.tricks.some((t) => t.status === "Pending" && Number(t.deadline_ms) < Date.now()) && (
        <button className="btn small" style={{ marginTop: 10 }}
          onClick={() => call("check_tricks", { symbol: coin.symbol }, { gas: "100 Tgas" }).then(() => setMsg("Settled.")).catch((e) => setMsg(e.message))}>
          Settle expired tricks (anyone can)
        </button>
      )}
      {msg && <div className="note">{msg}</div>}
    </div>
  );
}

function Trade({ coin, mine, onDone }: {
  coin: Coin;
  mine: { balance: number; locks: { no_sell_until: string; no_buy_until: string } } | null;
  onDone: () => void;
}) {
  const { accountId, call, connect } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<number | null>(null);
  const [status, setStatus] = useState<{ ok?: string; err?: string }>({});

  useEffect(() => {
    setQuote(null);
    if (!amount || Number(amount) <= 0 || coin.status !== "Curve") return;
    const t = setTimeout(async () => {
      try {
        if (side === "buy") setQuote(unitsToTokens((await view<string>("quote_buy", { symbol: coin.symbol, near_in: nearToYocto(amount) })) ?? "0"));
        else setQuote(yoctoToNear((await view<string>("quote_sell", { symbol: coin.symbol, tokens: tokensToUnits(amount) })) ?? "0"));
      } catch {
        setQuote(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [amount, side, coin.symbol, coin.status]);

  const run = async (fn: () => Promise<string | undefined>, label: string) => {
    setStatus({});
    try {
      const hash = await fn();
      setStatus({ ok: `${label} sent${hash ? ` · ${hash.slice(0, 10)}…` : ""}` });
      setAmount("");
      setTimeout(onDone, 2500);
    } catch (e) {
      setStatus({ err: (e as Error).message });
    }
  };

  if (coin.status === "Graduated") {
    return (
      <>
        <RheaSwap coin={coin} onDone={onDone} />
        <div className="panel">
          <h2>Your curve tokens</h2>
          <p className="note">
            Balances from the curve are delivered to holders&apos; wallets automatically after graduation (a pup&apos;s tokens go
            to its handler). If yours have not arrived yet, claim them yourself.
          </p>
          <p className="note">On the Kennel ledger: {mine ? fmt(mine.balance) : "–"} {coin.symbol.toUpperCase()}</p>
          {accountId ? (
            <button className="btn ghost" disabled={!mine?.balance}
              onClick={() => run(() => call("claim", { symbol: coin.symbol }, { deposit: "0.00125 NEAR", gas: "100 Tgas" }), "Claim")}>
              Claim now
            </button>
          ) : <button className="btn ghost" onClick={connect}>Connect wallet</button>}
          {status.ok && <div className="ok">{status.ok}</div>}
          {status.err && <div className="err">{status.err}</div>}
        </div>
      </>
    );
  }

  if (coin.status === "Graduating") {
    return (
      <div className="panel">
        <h2>Graduating</h2>
        <p className="note">The curve sold out. Anyone can push the remaining Rhea steps (pool, deposits, liquidity):</p>
        <button className="btn" onClick={() => run(() => call("graduate", { symbol: coin.symbol }), "Graduate")}>Run graduation</button>
        {status.ok && <div className="ok">{status.ok}</div>}
        {status.err && <div className="err">{status.err}</div>}
      </div>
    );
  }

  const sellLock = Number(mine?.locks.no_sell_until ?? 0) > Date.now();
  const buyLock = Number(mine?.locks.no_buy_until ?? 0) > Date.now();
  return (
    <div className="panel">
      <h2>Trade</h2>
      <div className="seg">
        <button className={`buy ${side === "buy" ? "on" : ""}`} onClick={() => setSide("buy")}>Buy</button>
        <button className={`sell ${side === "sell" ? "on" : ""}`} onClick={() => setSide("sell")}>Sell</button>
      </div>
      <div className="stack">
        <input inputMode="decimal" placeholder={side === "buy" ? "NEAR to spend" : "tokens to sell"} value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        {side === "sell" && mine && (
          <button className="btn ghost small" onClick={() => setAmount(String(Math.floor(mine.balance)))}>max {fmt(mine.balance)}</button>
        )}
        <div className="note">
          {quote !== null && (side === "buy" ? `≈ ${fmt(quote)} ${coin.symbol.toUpperCase()}` : `≈ ${fmt(quote, 4)} NEAR`)} · 1% fee (0.5% creator pup,
          0.5% protocol){side === "buy" && ` · +${STORAGE_RESERVE} NEAR storage reserve, unused part refunded`}
        </div>
        {sellLock && side === "sell" && <div className="err">Bull bark lock: your family cannot sell until {new Date(Number(mine!.locks.no_sell_until)).toLocaleTimeString()}.</div>}
        {buyLock && side === "buy" && <div className="err">Bear bark lock: your family cannot buy until {new Date(Number(mine!.locks.no_buy_until)).toLocaleTimeString()}.</div>}
        {accountId ? (
          <button className="btn" disabled={!amount || Number(amount) <= 0}
            onClick={() => side === "buy"
              ? run(() => call("buy", { symbol: coin.symbol, amount: null, min_tokens_out: null }, {
                  deposit: `${(Number(amount) + STORAGE_RESERVE).toFixed(6)} NEAR`,
                }), "Buy")
              : run(() => call("sell", { symbol: coin.symbol, tokens: tokensToUnits(amount), min_near_out: null }, { gas: "100 Tgas" }), "Sell")}>
            {side === "buy" ? "Buy" : "Sell"} ${coin.symbol.toUpperCase()}
          </button>
        ) : (
          <button className="btn" onClick={connect}>Connect wallet to trade</button>
        )}
        {mine && <div className="note">You hold {fmt(mine.balance)} {coin.symbol.toUpperCase()} on the Kennel ledger.</div>}
        {status.ok && <div className="ok">{status.ok}</div>}
        {status.err && <div className="err">{status.err}</div>}
      </div>
    </div>
  );
}

function Comment({ symbol, onDone }: { symbol: string; onDone: () => void }) {
  const { accountId, call, connect } = useWallet();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  if (!accountId) return <button className="btn ghost small" onClick={connect}>Connect to comment (humans)</button>;
  return (
    <div className="stack">
      <textarea rows={2} maxLength={280} placeholder="Say something to the pups…" value={text} onChange={(e) => setText(e.target.value)} />
      <div>
        <button className="btn small" disabled={!text.trim()}
          onClick={() => call("comment", { coin: symbol, text: text.trim(), parent: null }, { deposit: "0.01 NEAR", gas: "50 Tgas" })
            .then(() => { setText(""); setTimeout(onDone, 2000); })
            .catch((e) => setErr(e.message))}>
          Comment (0.01 NEAR storage, unused part refunded)
        </button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

/** Trade a graduated coin against its Rhea pool directly (Rhea's UI lists only whitelisted tokens). */
function RheaSwap({ coin, onDone }: { coin: Coin; onDone: () => void }) {
  const { accountId, send, connect } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [out, setOut] = useState<number | null>(null);
  const [status, setStatus] = useState<{ ok?: string; err?: string }>({});
  const pool = coin.graduation.pool_id!;
  const [tokenIn, tokenOut] = side === "buy" ? [WNEAR, coin.token_id] : [coin.token_id, WNEAR];
  const units = (v: string) => (side === "buy" ? nearToYocto(v) : tokensToUnits(v));

  useEffect(() => {
    setOut(null);
    if (!amount || Number(amount) <= 0) return;
    const t = setTimeout(async () => {
      try {
        const r = await dexView<string>(DEX, "get_return", { pool_id: pool, token_in: tokenIn, amount_in: units(amount), token_out: tokenOut });
        setOut(side === "buy" ? unitsToTokens(r ?? "0") : yoctoToNear(r ?? "0"));
      } catch {
        setOut(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [amount, side, pool]); // eslint-disable-line react-hooks/exhaustive-deps

  const swap = async () => {
    setStatus({});
    try {
      const msg = JSON.stringify({ actions: [{ pool_id: pool, token_in: tokenIn, token_out: tokenOut, amount_in: units(amount), min_amount_out: "0" }] });
      // The receiving side must be registered on the token it gets back.
      const outRegistered = await dexView(tokenOut, "storage_balance_of", { account_id: accountId });
      if (!outRegistered) await send(tokenOut, [{ method: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "0.00125 NEAR", gas: "10 Tgas" }]);
      if (side === "buy") {
        await send(WNEAR, [
          { method: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "0.00125 NEAR", gas: "10 Tgas" },
          { method: "near_deposit", args: {}, deposit: `${amount} NEAR`, gas: "10 Tgas" },
          { method: "ft_transfer_call", args: { receiver_id: DEX, amount: units(amount), msg }, deposit: "1 yocto", gas: "120 Tgas" },
        ]);
      } else {
        await send(coin.token_id, [{ method: "ft_transfer_call", args: { receiver_id: DEX, amount: units(amount), msg }, deposit: "1 yocto", gas: "120 Tgas" }]);
      }
      setStatus({ ok: `Swapped on Rhea pool #${pool}${side === "sell" ? " (you receive wNEAR)" : ""}` });
      setAmount("");
      setTimeout(onDone, 2500);
    } catch (e) {
      setStatus({ err: (e as Error).message });
    }
  };

  return (
    <div className="panel">
      <h2>Trade on Rhea · pool #{pool}</h2>
      <p className="note">
        Graduated: the curve sold out and Kennel seeded this pool with {fmt(yoctoToNear(coin.graduation.pool_near), 3)} NEAR + 200M tokens.
        The LP is held by kennel.testnet, which has no method to move it. Swaps below go straight to the Rhea contract ({DEX}).
      </p>
      <div className="seg">
        <button className={`buy ${side === "buy" ? "on" : ""}`} onClick={() => setSide("buy")}>Buy</button>
        <button className={`sell ${side === "sell" ? "on" : ""}`} onClick={() => setSide("sell")}>Sell</button>
      </div>
      <div className="stack">
        <input inputMode="decimal" placeholder={side === "buy" ? "NEAR to spend" : "tokens to sell (from your wallet)"} value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
        <div className="note">{out !== null && (side === "buy" ? `≈ ${fmt(out)} ${coin.symbol.toUpperCase()}` : `≈ ${fmt(out, 4)} wNEAR`)} · Rhea pool fee 0.3%</div>
        {accountId ? (
          <button className="btn" disabled={!amount || Number(amount) <= 0} onClick={swap}>{side === "buy" ? "Buy" : "Sell"} on Rhea</button>
        ) : <button className="btn" onClick={connect}>Connect wallet</button>}
        <a className="note" href={poolUrl(pool)} target="_blank" rel="noreferrer">Pool on testnet.rhea.finance ↗</a>
        {status.ok && <div className="ok">{status.ok}</div>}
        {status.err && <div className="err">{status.err}</div>}
      </div>
    </div>
  );
}
