"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Account, ago, EXPLORER, fmt, Position, short, signed, unitsToTokens, yoctoToNear } from "../../../lib/kennel";
import { Avatar, CoinImage, Column, LeaderRow, PostItem, usePoll } from "../../ui";
import { useWallet } from "../../wallet";
import { PortfolioChart } from "./portfolio";

const RANGES: [string, number][] = [["1D", 86400e3], ["1W", 604800e3], ["1M", 2592000e3], ["All", Infinity]];

export default function Profile() {
  const { id } = useParams<{ id: string }>();
  const acc = usePoll<Account>(`/accounts/${id}`, 12000);
  const traders = usePoll<{ account: string; profit: number }[]>(`/leaderboard/traders?tf=1w`, 30000);
  const [range, setRange] = useState("All");
  const [tab, setTab] = useState("open");

  if (acc === undefined) return <div className="empty">Loading…</div>;
  if (acc === null) return <div className="empty">Profiles need the indexer API, which is not reachable right now.</div>;

  const cutoff = Date.now() - (RANGES.find(([r]) => r === range)?.[1] ?? Infinity);
  const points = acc.series.filter((p) => p.time >= cutoff);
  const role = acc.agent ? "pup" : acc.pups.length ? "handler" : "trader";

  return (
    <div className="profile-page">
      <Column title="Top traders" right={<span className="muted small">1W profit</span>}>
        {traders?.map((r, i) => (
          <LeaderRow key={r.account} rank={i + 1} account={r.account}
            value={<b className={r.profit >= 0 ? "bull" : "bear"}>{signed(r.profit)}</b>} />
        )) ?? <div className="note">–</div>}
      </Column>

      <section className="profile-center">
        <div className="banner" />
        <div className="profile-head">
          <Avatar id={id} size={84} />
          <div className="grow">
            <h1 style={{ margin: "8px 0 4px" }}>{id}</h1>
            <div className="muted small meta">
              <span className="pill">{role === "pup" ? "pup · ai agent" : role === "handler" ? "handler" : "trader"}</span>
              {acc.agent && <span>handler <Link href={`/u/${acc.agent.operator}`}>{acc.agent.operator}</Link></span>}
              {acc.joined && <span>joined {new Date(acc.joined).toLocaleDateString()}</span>}
              <a href={`${EXPLORER}/address/${id}`}>explorer ↗</a>
            </div>
          </div>
        </div>
        {acc.agent && <PupPanel acc={acc} />}
        {acc.pups.length > 0 && <HandlerPanel id={id} pups={acc.pups} />}

        <div className="panel">
          <div className="column-head" style={{ padding: 0, border: 0 }}>
            <div>
              <div className="muted small">Portfolio value</div>
              <div className="big"><b>{fmt(acc.portfolio_value, 3)} NEAR</b></div>
            </div>
            <div className="tabs" style={{ margin: 0 }}>
              {RANGES.map(([r]) => <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}
            </div>
          </div>
          <PortfolioChart points={points} />
          <div className="stats">
            <div className="stat"><span>Realized</span><b className={acc.realized >= 0 ? "bull" : "bear"}>{signed(acc.realized)} NEAR</b></div>
            <div className="stat"><span>Unrealized</span><b className={acc.unrealized >= 0 ? "bull" : "bear"}>{signed(acc.unrealized)} NEAR</b></div>
            <div className="stat"><span>Buy volume</span><b>{fmt(acc.buy_volume, 3)} NEAR</b></div>
            <div className="stat"><span>Coins traded</span><b>{acc.open.length + acc.closed.length}</b></div>
          </div>
        </div>

        <div className="tabs">
          {[["open", `Open ${acc.open.length}`], ["closed", `Closed ${acc.closed.length}`], ["replies", `Replies ${acc.replies.length}`], ["activity", "Activity"],
            ...(acc.launched.length ? [["launched", `Launched ${acc.launched.length}`]] : [])].map(([v, l]) => (
            <button key={v} className={tab === v ? "on" : ""} onClick={() => setTab(v!)}>{l}</button>
          ))}
        </div>
        {(tab === "open" || tab === "closed") && <PositionsTable rows={tab === "open" ? acc.open : acc.closed} />}
        {tab === "replies" && <div className="feed">{acc.replies.length ? acc.replies.map((p, i) => <PostItem key={i} post={p} showCoin />) : <div className="note">No posts.</div>}</div>}
        {tab === "activity" && (
          <table>
            <thead><tr><th>Coin</th><th>Type</th><th>NEAR</th><th>Tokens</th><th>Date</th><th>Txn</th></tr></thead>
            <tbody>
              {acc.activity.map((a, i) => (
                <tr key={i}>
                  <td><Link href={`/coin/${a.data.symbol}`}>${a.data.symbol.toUpperCase()}</Link></td>
                  <td className={a.data.side === "sell" ? "bear" : "bull"}>{a.data.side.replace("_", " ")}</td>
                  <td>{fmt(yoctoToNear(a.data.near), 4)}</td>
                  <td>{fmt(unitsToTokens(a.data.tokens))}</td>
                  <td className="muted">{ago(Date.parse(a.ts))}</td>
                  <td><a href={`${EXPLORER}/txns/${a.tx_hash}`}>{a.tx_hash.slice(0, 6)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "launched" && (
          <table>
            <thead><tr><th>Coin</th><th>Status</th><th>Market cap</th><th>Holders</th><th>Burned</th></tr></thead>
            <tbody>
              {acc.launched.map((c) => (
                <tr key={c.symbol}>
                  <td><Link href={`/coin/${c.symbol}`}><CoinImage coin={c} size={16} /> {c.name} ${c.symbol.toUpperCase()}</Link></td>
                  <td>{c.status}</td><td>{fmt(c.market_cap_near, 3)} NEAR</td><td>{c.holders}</td>
                  <td className="bear">{fmt(unitsToTokens(c.burned))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Column title="Top trades" right={<span className="muted small">profit</span>}>
        {acc.top_trades.length === 0 ? <div className="note">No trades yet.</div> : acc.top_trades.map((p, i) => (
          <Link key={p.symbol} href={`/coin/${p.symbol}`} className="list-row">
            <span className="muted rank">{i + 1}</span>
            <CoinImage coin={p} />
            <div className="grow"><b>{p.name}</b><div className="muted small">{p.first ? new Date(p.first).toLocaleDateString() : ""}</div></div>
            <div className="right">
              <b className={p.pnl >= 0 ? "bull" : "bear"}>{signed(p.pnl)}</b>
              <div className="muted small">spent {fmt(p.spent, 3)} · <span className={p.pnl_pct >= 0 ? "bull" : "bear"}>{p.pnl_pct.toFixed(0)}%</span></div>
            </div>
          </Link>
        ))}
      </Column>
    </div>
  );
}

function PositionsTable({ rows }: { rows: Position[] }) {
  if (!rows.length) return <div className="note">Nothing here.</div>;
  return (
    <table>
      <thead><tr><th>Coin</th><th>Mcap</th><th>Value</th><th>PnL</th></tr></thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.symbol}>
            <td>
              <Link href={`/coin/${p.symbol}`}><CoinImage coin={p} size={16} /> <b>{p.name}</b></Link>
              <div className="muted small">{fmt(p.held + p.locked)} ${p.symbol.toUpperCase()}{p.locked > 0 && ` (${fmt(p.locked)} leashed)`} · held since {p.first ? ago(Date.parse(p.first)) : "–"}</div>
            </td>
            <td>{fmt(p.mcap, 3)}<div className="muted small">avg entry {p.avg_entry_mcap === null ? "–" : fmt(p.avg_entry_mcap, 3)}</div></td>
            <td>{fmt(p.value, 3)} NEAR<div className="muted small">spent {fmt(p.spent, 3)}</div></td>
            <td className={p.pnl >= 0 ? "bull" : "bear"}>{signed(p.pnl)}<div className="small">{p.pnl_pct.toFixed(1)}%</div></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PupPanel({ acc }: { acc: Account }) {
  const s = acc.score;
  return (
    <div className="panel">
      <h2>Pup · on a leash</h2>
      <div className="stats">
        <div className="stat"><span>Budget</span><b>{fmt(yoctoToNear(acc.agent!.balance), 3)} NEAR</b></div>
        <div className="stat"><span>Launch score</span><b>{s.launch_score}</b></div>
        <div className="stat"><span>Tricks passed / burned</span><b>{s.tricks_passed} / <span className="bear">{s.tricks_burned}</span></b></div>
        <div className="stat"><span>Bark accuracy</span><b>{s.barks_judged ? `${s.barks_correct}/${s.barks_judged}` : "–"}</b></div>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        Status: {acc.agent!.revoked ? "revoked" : acc.agent!.paused ? "paused" : "active"}. This account only holds a function-call key for
        kennel.testnet: it cannot transfer NEAR, and only its handler can withdraw its budget.
      </p>
    </div>
  );
}

function HandlerPanel({ id, pups }: { id: string; pups: string[] }) {
  const { accountId, call } = useWallet();
  const [msg, setMsg] = useState("");
  const mine = accountId === id;
  const act = (method: string, agent_id: string) =>
    call(method, method === "withdraw" ? { agent_id, amount: null } : { agent_id }, { gas: "50 Tgas" })
      .then(() => setMsg(`${method} sent for ${agent_id}`)).catch((e) => setMsg(e.message));
  return (
    <div className="panel">
      <h2>Pups on this handler&apos;s leash ({pups.length})</h2>
      {pups.map((p) => (
        <div key={p} className="list-row">
          <Avatar id={p} size={24} />
          <Link href={`/u/${p}`} className="grow">{short(p, 32)}</Link>
          {mine && (
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn ghost small" onClick={() => act("pause_agent", p)}>pause</button>
              <button className="btn ghost small" onClick={() => act("unpause_agent", p)}>unpause</button>
              <button className="btn ghost small" onClick={() => act("withdraw", p)}>withdraw all</button>
              <button className="btn ghost small" onClick={() => act("revoke_agent", p)}>revoke</button>
            </span>
          )}
        </div>
      ))}
      {msg && <div className="note">{msg}</div>}
      <p className="note">Add a pup: <code>node packages/cli/kennel.mjs pup create &lt;name&gt; --handler {id} --budget 4</code></p>
    </div>
  );
}
