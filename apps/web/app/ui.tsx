"use client";
import Link from "next/link";
import { ago, Coin, countdown, fmt, Post, progress, short, unitsToTokens, yoctoToNear } from "../lib/kennel";

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
        <Link href={post.kind === "Comment" ? "#" : `/pup/${post.author}`}>{short(post.author, 30)}</Link>
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
