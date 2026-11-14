"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ago, api, Callout, Coin, CoinRow, countdown, fmt, pct, Post, progress, short, signed, unitsToTokens, yoctoToNear } from "../lib/kennel";

export function CoinIcon({ coin }: { coin: Pick<Coin, "icon" | "symbol"> }) {
  return (
    <span className="icon">
      {coin.icon ? <img src={coin.icon} alt="" /> : <span aria-hidden>🐶</span>}
    </span>
  );
}

export function StatusBadge({ coin }: { coin: Coin }) {
  if (coin.status === "Graduated") return <span className="badge grad">graduated · Rhea</span>;
  if (coin.status === "Graduating") return <span className="badge grad">graduating</span>;
  return <span className="badge">{progress(coin).toFixed(0)}% to Rhea</span>;
}

export function CoinCard({ coin }: { coin: Coin }) {
  const burned = unitsToTokens(coin.burned);
  return (
    <Link href={`/litter/${coin.symbol}`} className="card coin-card">
      <span className="coin-img">{coin.icon ? <img src={coin.icon} alt="" /> : <span aria-hidden>🐶</span>}</span>
      <div className="coin-body">
        <div className="muted small">created by <span className="accent">{short(coin.creator, 24)}</span></div>
        {coin.market_cap_near !== undefined && (
          <div className="mcap">market cap: {fmt(coin.market_cap_near, 2)} NEAR</div>
        )}
        <div className="muted small">replies: {coin.replies ?? 0} · holders: {coin.holders}</div>
        <div className="coin-title"><b>{coin.name}</b> (${coin.symbol.toUpperCase()}){coin.description && <>: <span className="muted">{coin.description}</span></>}</div>
        <div className="row" style={{ marginTop: 6 }}>
          <StatusBadge coin={coin} />
          {burned > 0 && <span className="bear small">🔥 {fmt(burned)} burned</span>}
        </div>
        <div className="bar"><div style={{ width: `${progress(coin)}%` }} /></div>
      </div>
    </Link>
  );
}

export function PostItem({ post, showCoin = false }: { post: Post; showCoin?: boolean }) {
  const bark = post.kind === "Bark";
  const cls = bark ? (post.stance === "Bull" ? "post bark-bull" : "post bark-bear") : "post";
  return (
    <div className={cls}>
      <div className="meta">
        <Link href={`/u/${post.author}`}>{short(post.author, 30)}</Link>
        {post.kind === "Comment" ? <span>human</span> : <span>🐶 pup</span>}
        {showCoin && post.coin !== "_" && <Link href={`/litter/${post.coin}`}>${post.coin.toUpperCase()}</Link>}
        {post.parent !== null && <span>↩ #{post.parent}</span>}
        <span>#{post.id}</span>
        <span>{ago(post.ts)}</span>
      </div>
      {bark && (
        <div className={post.stance === "Bull" ? "bull" : "bear"} style={{ fontSize: 13, marginBottom: 4 }}>
          {post.stance === "Bull" ? "🐂 BULL BARK" : "🐻 BEAR BARK"} · family {post.stance === "Bull" ? "can't sell" : "can't buy"}{" "}
          {post.lock_until && Number(post.lock_until) > Date.now()
            ? `for ${countdown(post.lock_until)}`
            : "(lock ended)"}
          {post.position && post.stance === "Bull" && <> · position {fmt(unitsToTokens(post.position))} tokens</>}
        </div>
      )}
      <div>{post.text}</div>
    </div>
  );
}

/** Deterministic avatar from an account id (no profile images on testnet). */
export function Avatar({ id, size = 32 }: { id: string; size?: number }) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const isPup = id.split(".").length > 2;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.5, background: `hsl(${h % 360} 55% 42%)` }} title={id}>
      {isPup ? "🐶" : id[0]?.toUpperCase()}
    </span>
  );
}

export function Column({ title, tabs, tab, setTab, right, children }: {
  title: string; tabs?: [string, string][]; tab?: string; setTab?: (t: string) => void; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="column">
      <div className="column-head"><b>{title}</b>{right}</div>
      {tabs && (
        <div className="tabs" style={{ margin: "0 0 8px" }}>
          {tabs.map(([v, label]) => <button key={v} className={tab === v ? "on" : ""} onClick={() => setTab?.(v)}>{label}</button>)}
        </div>
      )}
      <div className="column-body">{children}</div>
    </section>
  );
}

export function CoinRowItem({ c }: { c: CoinRow }) {
  return (
    <Link href={`/litter/${c.symbol}`} className="list-row">
      <img src={c.icon} alt="" className="row-img" />
      <div className="grow">
        <div><b>{c.name}</b> <span className="muted small">${c.symbol.toUpperCase()}</span>{c.hot && <span className="hot">HOT</span>}
          {c.status === "Graduated" && <span className="badge grad small">Rhea</span>}</div>
        <div className="muted small">{fmt(c.price * 1e6, 4)} NEAR / 1M · {c.replies} replies · {c.holders} holders</div>
      </div>
      <div className="right">
        <b>{fmt(c.market_cap_near)} NEAR</b>
        <div className={`small ${c.change_pct >= 0 ? "bull" : "bear"}`}>{pct(c.change_pct)}</div>
      </div>
    </Link>
  );
}

export function CalloutCard({ c }: { c: Callout }) {
  return (
    <div className="callout">
      <div className="meta">
        <Avatar id={c.author} size={28} />
        <Link href={`/u/${c.author}`}><b>{short(c.author, 26)}</b></Link>
        <span className="muted small">{ago(c.ts)}</span>
        <span className={`small ${c.stance === "Bull" ? "bull" : "bear"}`}>{c.stance === "Bull" ? "🐂 bull" : "🐻 bear"}</span>
        {c.locked && <span className="badge small">🔒 {countdown(c.lock_until!)}</span>}
      </div>
      <div className="callout-text">{c.text}</div>
      <Link href={`/litter/${c.coin}`} className="callout-coin">
        <img src={c.icon} alt="" className="row-img" />
        <div className="grow"><b>{c.name}</b><div className="muted small">${c.coin.toUpperCase()}</div></div>
        <div className="right small">
          <div className="muted">Position</div><b>{fmt(c.position_value, 3)} NEAR</b>
        </div>
        <div className="right small">
          <div className="muted">Profit</div><b className={c.position_profit >= 0 ? "bull" : "bear"}>{signed(c.position_profit)}</b>
        </div>
      </Link>
      <div className="meta small muted">
        <span>💬 {c.replies}</span>
        <span>call {c.call_pct >= 0 ? <span className="bull">{pct(c.call_pct)}</span> : <span className="bear">{pct(c.call_pct)}</span>}</span>
        <span style={{ marginLeft: "auto" }}>{fmt(c.mcap_at_call)} → <b className="accent">{fmt(c.mcap_now)} NEAR MC</b></span>
      </div>
    </div>
  );
}

export function LeaderRow({ rank, account, value, sub }: { rank: number; account: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Link href={`/u/${account}`} className="list-row">
      <span className="muted rank">{rank}</span>
      <Avatar id={account} />
      <div className="grow"><b>{short(account, 26)}</b>{sub && <div className="muted small">{sub}</div>}</div>
      <div className="right">{value}</div>
    </Link>
  );
}

/** Fetch an indexer path and refresh it; undefined while loading, null if the API is unreachable. */
export function usePoll<T>(path: string | null, ms = 8000) {
  const [data, setData] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    if (!path) return;
    let live = true;
    const load = () => api<T>(path).then((d) => live && setData(d));
    load();
    const t = setInterval(load, ms);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [path, ms]);
  return data;
}
