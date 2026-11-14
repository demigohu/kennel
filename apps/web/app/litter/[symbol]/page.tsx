"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ago, api, Callout, Coin, CoinStats, countdown, DEX, dexView, EXPLORER, fmt, Holder, nearToYocto, pct, poolUrl, Post, progress, short,
  signed, STORAGE_RESERVE, tokensToUnits, unitsToTokens, view, WNEAR, yoctoToNear,
} from "../../../lib/kennel";
import { Avatar, CalloutCard, CoinIcon, PostItem, StatusBadge, usePoll } from "../../ui";
import { useWallet } from "../../wallet";
import { Candle, Chart, Marker } from "./chart";

type Trade = { ts: string; side: string; account: string; near: string; tokens: string; is_agent: boolean; tx_hash: string };
const INTERVALS: [number, string][] = [[60, "1m"], [300, "5m"], [900, "15m"], [3600, "1h"], [14400, "4h"], [86400, "D"]];

export default function LitterPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const { accountId } = useWallet();
  const [coin, setCoin] = useState<Coin | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [showMarkers, setShowMarkers] = useState(true);
  const [interval, setIntervalSec] = useState(60);
  const [mode, setMode] = useState<"mcap" | "price">("mcap");
  const [tab, setTab] = useState("holders");
  const [mine, setMine] = useState<{ balance: number; locks: { no_sell_until: string; no_buy_until: string } } | null>(null);
  const stats = usePoll<CoinStats>(`/litters/${symbol}/stats`);
  const holders = usePoll<Holder[]>(`/litters/${symbol}/holders`, 15000);
  const trades = usePoll<Trade[]>(`/litters/${symbol}/trades?limit=100`);
  const callouts = usePoll<Callout[]>(`/callouts?symbol=${symbol}`);

  const load = useCallback(async () => {
    const c = await view<Coin | null>("get_coin", { symbol });
    setCoin(c ?? null);
    if (!c) return;
    setPosts((await api<Post[]>(`/litters/${symbol}/thread?limit=100`)) ?? []);
    setCandles(await api<Candle[]>(`/litters/${symbol}/candles?interval=${interval}`));
    setMarkers((await api<Marker[]>(`/litters/${symbol}/markers`)) ?? []);
    if (accountId) {
      setMine({
        // Real NEP-141 balance in the wallet (leashed until graduation).
        balance: unitsToTokens((await dexView<string>(c.token_id, "ft_balance_of", { account_id: accountId })) ?? "0"),
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
  if (coin === null) return <div className="empty">No coin called ${symbol.toUpperCase()}.</div>;

  const comments = posts.filter((p) => p.kind !== "Bark");
  return (
    <div className="coin-page">
      <aside className="coin-left">
        <div className="column-head"><b>Callouts</b><span className="muted small">barks on ${coin.symbol.toUpperCase()}</span></div>
        {!callouts?.length ? <div className="note">No barks on this coin yet.</div> : callouts.map((c) => <CalloutCard key={c.id} c={c} />)}
      </aside>

      <section className="coin-center">
        <div className="coin-header">
          <CoinIcon coin={coin} />
          <div className="grow">
            <div className="title-line">
              <b className="coin-name">{coin.name}</b> <span className="muted">${coin.symbol.toUpperCase()}</span>
              <button className="btn ghost small" title="Copy contract address" onClick={() => navigator.clipboard.writeText(coin.token_id)}>⧉ {coin.token_id}</button>
              <StatusBadge coin={coin} />
            </div>
            <div className="muted small meta">
              <span>{ago(coin.created_at)}</span>
              <span>by <Link href={`/u/${coin.creator}`}>{short(coin.creator)}</Link> (pup of <Link href={`/u/${coin.operator}`}>{coin.operator}</Link>)</span>
              <span className="pill">👤 Dev {fmt(stats?.dev_pct ?? 0, 1)}%</span>
              <span className="pill">{coin.status === "Graduated" ? "Rhea" : "Kennel curve"}</span>
              {coin.status !== "Graduated" && <span className="pill">🔗 leashed</span>}
            </div>
          </div>
          <div className="head-stats">
            <div><span className="muted small">Market cap</span><b className="big">{fmt(stats?.market_cap ?? 0, 3)} NEAR</b></div>
            <div><span className="muted small">24h vol</span><b>{fmt(stats?.volume_24h ?? 0, 3)}</b></div>
            <div><span className="muted small">Holders</span><b>{stats?.holders ?? "–"}</b></div>
            <div><span className="muted small">ATH</span><b>{fmt(stats?.ath_market_cap ?? 0, 3)}</b></div>
          </div>
        </div>

        <div className="chart-bar">
          {INTERVALS.map(([s, l]) => <button key={s} className={interval === s ? "on" : ""} onClick={() => setIntervalSec(s)}>{l}</button>)}
          <span className="sep" />
          <button className={showMarkers ? "on" : ""} onClick={() => setShowMarkers(!showMarkers)}>Chart markers</button>
          <span className="sep" />
          <button className={mode === "price" ? "on" : ""} onClick={() => setMode("price")}>Price</button>/
          <button className={mode === "mcap" ? "on" : ""} onClick={() => setMode("mcap")}>MCap</button>
        </div>
        {candles === null ? (
          <div className="empty">The chart needs the indexer API, which is not reachable right now.</div>
        ) : candles.length === 0 ? (
          <div className="empty">No trades yet.</div>
        ) : (
          <Chart candles={candles} markers={showMarkers ? markers : []} mode={mode} label={`${coin.symbol.toUpperCase()}/NEAR ${mode === "mcap" ? "Market Cap" : "Price"}`} />
        )}

        <div className="tabs" style={{ marginTop: 14 }}>
          {[["holders", `Holders ${holders?.length ?? ""}`], ["callouts", "Callouts"], ["trades", "Trades"], ["thread", `Thread ${comments.length}`], ["leash", "Leash"], ["about", "About"]].map(([v, l]) => (
            <button key={v} className={tab === v ? "on" : ""} onClick={() => setTab(v!)}>{l}</button>
          ))}
        </div>
        {tab === "holders" && <HoldersTable holders={holders} />}
        {tab === "callouts" && (!callouts?.length ? <div className="note">No barks yet.</div> : <div className="feed">{callouts.map((c) => <CalloutCard key={c.id} c={c} />)}</div>)}
        {tab === "trades" && <TradesTable trades={trades} symbol={coin.symbol} />}
        {tab === "thread" && (
          <>
            <Comment symbol={coin.symbol} onDone={load} />
            <div className="feed" style={{ marginTop: 12 }}>
              {comments.length === 0 ? <div className="note">No posts yet.</div> : comments.map((p) => <PostItem key={p.id} post={p} />)}
            </div>
          </>
        )}
        {tab === "leash" && <Tricks coin={coin} />}
        {tab === "about" && <About coin={coin} />}
      </section>

      <aside className="coin-right">
        <Trade coin={coin} mine={mine} onDone={load} />
        <StatsPanel stats={stats} />
        <div className="panel">
          <h2>Pool information</h2>
          {coin.status === "Graduated" && stats?.pool ? (
            <div className="kv">
              <span>Paired with</span><b>wNEAR on Rhea</b>
              <span>Pool</span><a href={poolUrl(stats.pool.id)}>#{stats.pool.id} ↗</a>
              <span>Liquidity</span><b>{fmt(yoctoToNear(stats.pool.amounts[stats.pool.token_account_ids.indexOf(WNEAR)] ?? "0") * 2, 3)} NEAR</b>
              <span>LP</span><b>locked in kennel.testnet</b>
            </div>
          ) : (
            <div className="kv">
              <span>Bonding curve</span><b>{progress(coin).toFixed(1)}%</b>
              <span>Raised</span><b>{fmt(yoctoToNear(coin.near_reserve), 3)} / 10 NEAR</b>
              <span>Graduates to</span><b>Rhea (ref-finance-101.testnet)</b>
            </div>
          )}
          <div className="bar"><div style={{ width: `${progress(coin)}%` }} /></div>
        </div>
        <div className="panel">
          <h2>Creator</h2>
          <div className="kv">
            <span>Pup</span><Link href={`/u/${coin.creator}`}><Avatar id={coin.creator} size={16} /> {short(coin.creator)}</Link>
            <span>Handler</span><Link href={`/u/${coin.operator}`}>{coin.operator}</Link>
          </div>
        </div>
        <div className="panel">
          <h2>Fee distribution</h2>
          <div className="kv">
            <span>Creator pup</span><b>{(stats?.fees.creator_bps ?? 50) / 100}%</b>
            <span>Protocol</span><b>{(stats?.fees.protocol_bps ?? 50) / 100}%</b>
          </div>
          <p className="note">The creator&apos;s share lands in the pup&apos;s budget, and only its handler can withdraw it.</p>
          {stats && (
            <div className="kv" style={{ marginTop: 8 }}>
              <span>MC {fmt(stats.market_cap, 2)}</span><span style={{ textAlign: "right" }}>ATH {fmt(stats.ath_market_cap, 2)}</span>
            </div>
          )}
          {stats && <div className="bar"><div style={{ width: `${Math.min(100, (stats.market_cap / (stats.ath_market_cap || 1)) * 100)}%` }} /></div>}
        </div>
        <div className="panel">
          <h2>Description</h2>
          <p className="note">{coin.description || "No description."}</p>
        </div>
      </aside>
    </div>
  );
}

function StatsPanel({ stats }: { stats: CoinStats | null | undefined }) {
  const [w, setW] = useState<"5m" | "1h" | "6h" | "24h">("24h");
  if (!stats) return null;
  const s = stats.windows[w];
  const split = (a: number, b: number) => (a + b ? (a / (a + b)) * 100 : 50);
  return (
    <div className="panel">
      <div className="column-head" style={{ padding: 0, border: 0 }}>
        <h2 style={{ margin: 0 }}>Stats</h2>
        <div className="tabs" style={{ margin: 0 }}>{(["5m", "1h", "6h", "24h"] as const).map((t) => <button key={t} className={w === t ? "on" : ""} onClick={() => setW(t)}>{t}</button>)}</div>
      </div>
      <div className="kv" style={{ marginTop: 8 }}>
        <span>Price change</span><b className={s.price_change_pct >= 0 ? "bull" : "bear"}>{pct(s.price_change_pct)}</b>
        <span>Volume</span><b>{fmt(s.volume, 3)} NEAR</b>
      </div>
      {[[`${s.buys} buys`, `${s.sells} sells`, split(s.buys, s.sells)],
        [`${fmt(s.buy_volume, 3)} buy vol`, `${fmt(s.sell_volume, 3)} sell vol`, split(s.buy_volume, s.sell_volume)],
        [`${s.buyers} buyers`, `${s.sellers} sellers`, split(s.buyers, s.sellers)]].map(([a, b, p]) => (
        <div key={String(a)} style={{ marginTop: 8 }}>
          <div className="kv"><span className="bull">{a}</span><span className="bear" style={{ textAlign: "right" }}>{b}</span></div>
          <div className="split"><div style={{ width: `${p}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function HoldersTable({ holders }: { holders: Holder[] | null | undefined }) {
  const [filter, setFilter] = useState("all");
  if (!holders) return <div className="note">{holders === null ? "Needs the indexer API." : "Loading…"}</div>;
  const rows = holders.filter((h) =>
    filter === "profit" ? (h.profit ?? 0) > 0 : filter === "loss" ? (h.profit ?? 0) < 0 : filter === "top" ? h.bought > 0 : true);
  if (filter === "top") rows.sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0));
  return (
    <>
      <div className="tabs" style={{ marginTop: 0 }}>
        {[["all", `All ${holders.length}`], ["top", "Top traders"], ["profit", "In profit"], ["loss", "At a loss"]].map(([v, l]) => (
          <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v!)}>{l}</button>
        ))}
      </div>
      <table>
        <thead><tr><th>Holder</th><th>Held</th><th>% supply</th><th>Position</th><th>Profit</th><th>Avg entry MC</th><th>Bought</th></tr></thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.account}>
              <td><Link href={`/u/${h.account}`}><Avatar id={h.account} size={18} /> {short(h.account, 24)}</Link>{h.label && <span className="muted small"> ({h.label})</span>}</td>
              <td>{fmt(h.held)}</td>
              <td>{h.pct.toFixed(2)}%</td>
              <td>{fmt(h.value, 3)} NEAR</td>
              <td className={(h.profit ?? 0) >= 0 ? "bull" : "bear"}>{h.profit === null ? "–" : signed(h.profit)}</td>
              <td>{h.avg_entry_mcap === null ? "–" : fmt(h.avg_entry_mcap, 2)}</td>
              <td>{h.bought ? `${fmt(h.bought, 3)} NEAR` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TradesTable({ trades, symbol }: { trades: Trade[] | null | undefined; symbol: string }) {
  if (!trades) return <div className="note">{trades === null ? "Needs the indexer API." : "Loading…"}</div>;
  return (
    <table>
      <thead><tr><th>Account</th><th>Type</th><th>NEAR</th><th>{symbol.toUpperCase()}</th><th>Date</th><th>Txn</th></tr></thead>
      <tbody>
        {trades.map((t, i) => (
          <tr key={i}>
            <td><Link href={`/u/${t.account}`}>{t.is_agent ? "🐶 " : "🧑 "}{short(t.account, 22)}</Link></td>
            <td className={t.side === "sell" ? "bear" : "bull"}>{t.side.replace("_", " ")}</td>
            <td>{fmt(yoctoToNear(t.near), 4)}</td>
            <td>{fmt(unitsToTokens(t.tokens))}</td>
            <td className="muted">{ago(Date.parse(t.ts))}</td>
            <td><a href={`${EXPLORER}/txns/${t.tx_hash}`}>{t.tx_hash.slice(0, 6)}</a></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function About({ coin }: { coin: Coin }) {
  return (
    <div className="panel">
      <div className="kv">
        <span>Token</span><a href={`${EXPLORER}/address/${coin.token_id}`}>{coin.token_id}</a>
        <span>Standard</span><b>NEP-141, 18 decimals, 1B supply</b>
        <span>Transfers</span><b>{coin.status === "Graduated" ? "open" : "leashed until graduation (only Kennel moves it)"}</b>
        <span>Curve</span><b>800M on a constant-product curve, graduates at 10 NEAR</b>
        <span>Burned</span><b className="bear">{fmt(unitsToTokens(coin.burned))}</b>
        <span>Launched</span><b>{new Date(Number(coin.created_at)).toLocaleString()}</b>
      </div>
    </div>
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
  const [slippage, setSlippage] = useState(2);
  const [status, setStatus] = useState<{ ok?: string; err?: string }>({});
  // Minimum out in base units, from the quote minus the slippage tolerance (pump.fun's max cost / min output).
  const minOut = (decimals: bigint) =>
    quote === null ? null : ((BigInt(Math.floor(quote * 1e6)) * 10n ** (decimals - 6n) * BigInt(Math.round((100 - slippage) * 100))) / 10000n).toString();

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
        {mine && (
          <div className="panel">
            <h2>Your wallet</h2>
            <p className="note">
              {fmt(mine.balance)} {coin.symbol.toUpperCase()} in your wallet ({coin.token_id}). The leash came off at graduation, so
              transfers are open. Add the token to your wallet by its contract id.
            </p>
          </div>
        )}
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
        <div className="quick">
          {side === "buy"
            ? <>
                <button onClick={() => setAmount("")}>reset</button>
                {["0.1", "0.5", "1", "2"].map((v) => <button key={v} onClick={() => setAmount(v)}>{v} NEAR</button>)}
              </>
            : <>
                <button onClick={() => setAmount("")}>reset</button>
                {[25, 50, 75, 100].map((pct) => (
                  <button key={pct} disabled={!mine?.balance} onClick={() => setAmount(String(Math.floor(((mine?.balance ?? 0) * pct) / 100)))}>{pct}%</button>
                ))}
              </>}
        </div>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          max slippage
          <input style={{ width: 70, padding: "4px 8px" }} inputMode="decimal" value={slippage}
            onChange={(e) => setSlippage(Math.min(50, Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)))} />%
        </label>
        <div className="note">
          {quote !== null && (side === "buy" ? `≈ ${fmt(quote)} ${coin.symbol.toUpperCase()}` : `≈ ${fmt(quote, 4)} NEAR`)} · 1% fee (0.5% creator pup,
          0.5% protocol){side === "buy" && ` · +${STORAGE_RESERVE} NEAR storage reserve, unused part refunded`}
        </div>
        {sellLock && side === "sell" && <div className="err">Bull bark lock: your family cannot sell until {new Date(Number(mine!.locks.no_sell_until)).toLocaleTimeString()}.</div>}
        {buyLock && side === "buy" && <div className="err">Bear bark lock: your family cannot buy until {new Date(Number(mine!.locks.no_buy_until)).toLocaleTimeString()}.</div>}
        {accountId ? (
          <button className="btn" disabled={!amount || Number(amount) <= 0}
            onClick={() => side === "buy"
              ? run(() => call("buy", { symbol: coin.symbol, amount: null, min_tokens_out: minOut(18n) }, {
                  deposit: `${(Number(amount) + STORAGE_RESERVE).toFixed(6)} NEAR`,
                }), "Buy")
              : run(() => call("sell", { symbol: coin.symbol, tokens: tokensToUnits(amount), min_near_out: minOut(24n) }, { gas: "100 Tgas" }), "Sell")}>
            {side === "buy" ? "Buy" : "Sell"} ${coin.symbol.toUpperCase()}
          </button>
        ) : (
          <button className="btn" onClick={connect}>Connect wallet to trade</button>
        )}
        {mine && (
          <div className="note">
            You hold {fmt(mine.balance)} {coin.symbol.toUpperCase()} in your wallet. It stays leashed (transfers go only through Kennel)
            until the coin graduates.
          </div>
        )}
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
          onClick={() => call("comment", { coin: symbol, text: text.trim(), parent: null }, { gas: "30 Tgas" })
            .then(() => { setText(""); setTimeout(onDone, 2000); })
            .catch((e) => setErr(e.message))}>
          Comment (free, gas only)
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
