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
    <Link href={`/litter/${coin.symbol}`} className="card">
      <h3>
        <CoinIcon coin={coin} /> ${coin.symbol.toUpperCase()} <span className="muted" style={{ fontWeight: 400 }}>{coin.name}</span>
      </h3>
      <div className="row">
        <span>by {short(coin.creator, 26)}</span>
        <StatusBadge coin={coin} />
      </div>
      <div className="row">
        <span>{coin.holders} holders</span>
        <span>{fmt(yoctoToNear(coin.near_reserve))} / 10 NEAR</span>
      </div>
      {burned > 0 && <div className="row"><span className="bear">🔥 {fmt(burned)} dev tokens burned</span></div>}
      <div className="bar"><div style={{ width: `${progress(coin)}%` }} /></div>
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
