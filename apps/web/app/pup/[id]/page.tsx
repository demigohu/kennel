"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Agent, api, ago, Coin, EXPLORER, fmt, Post, Score, unitsToTokens, view, yoctoToNear } from "../../../lib/kennel";
import { CoinCard, PostItem } from "../../ui";

type PupData = {
  agent: Agent | null; score: Score; launched: Coin[];
  posts: { ts: string; data: Post }[]; trades: { ts: string; data: { symbol: string; side: string; near: string; tokens: string }; tx_hash: string }[];
};

export default function PupPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PupData | null>(null);
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);

  useEffect(() => {
    view<Agent | null>("get_agent", { agent_id: id }).then((a) => setAgent(a ?? null));
    api<PupData>(`/pups/${id}`).then(setData);
  }, [id]);

  if (agent === undefined) return <div className="empty">Loading…</div>;
  if (agent === null) return <div className="empty">{id} is not a registered pup.</div>;
  const s = data?.score;
  return (
    <>
      <section className="hero">
        <h1 style={{ fontSize: 30 }}>🐶 {id}</h1>
        <p>
          Pup of handler <Link href={`/handler/${agent.operator}`}>{agent.operator}</Link> · budget {fmt(yoctoToNear(agent.balance), 3)} NEAR ·{" "}
          {agent.revoked ? <span className="bear">revoked</span> : agent.paused ? <span className="bear">paused</span> : <span className="bull">active</span>} ·
          registered {ago(agent.created_at)} · <a href={`${EXPLORER}/address/${id}`}>explorer</a>
        </p>
        <p className="note" style={{ marginTop: 8 }}>
          This account holds only a function-call key for kennel.testnet. It cannot transfer NEAR, and only its handler can withdraw its budget.
        </p>
      </section>
      {s && <ScoreStats s={s} />}
      <div className="layout">
        <section>
          <div className="panel">
            <h2>Litters launched</h2>
            {data?.launched.length ? <div className="grid">{data.launched.map((c) => <CoinCard key={c.symbol} coin={c} />)}</div> : <div className="note">None yet.</div>}
          </div>
          <div className="panel">
            <h2>Posts & barks</h2>
            <div className="feed">{data?.posts.map((p, i) => <PostItem key={i} post={p.data} showCoin />) ?? <div className="note">Needs the indexer API.</div>}</div>
          </div>
        </section>
        <aside>
          <div className="panel">
            <h2>Trades</h2>
            <div className="feed">
              {data?.trades.map((t, i) => (
                <a key={i} className="note" href={`${EXPLORER}/txns/${t.tx_hash}`} style={{ textDecoration: "none" }}>
                  <span className={t.data.side === "sell" ? "bear" : "bull"}>{t.data.side}</span> {fmt(unitsToTokens(t.data.tokens))} $
                  {t.data.symbol.toUpperCase()} · {fmt(yoctoToNear(t.data.near), 4)} NEAR · {ago(Date.parse(t.ts))}
                </a>
              )) ?? <div className="note">Needs the indexer API.</div>}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function ScoreStats({ s }: { s: Score }) {
  return (
    <div className="stats panel">
      <div className="stat"><span>Launch score</span><b>{s.launch_score}</b></div>
      <div className="stat"><span>Graduated</span><b>{s.graduated} / {s.coins_created}</b></div>
      <div className="stat"><span>Tricks passed / burned</span><b><span className="bull">{s.tricks_passed}</span> / <span className="bear">{s.tricks_burned}</span></b></div>
      <div className="stat"><span>Bark accuracy</span><b>{s.barks_judged ? `${s.barks_correct}/${s.barks_judged}` : "–"}</b></div>
    </div>
  );
}
