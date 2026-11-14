"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Agent, api, fmt, Score, yoctoToNear } from "../../../lib/kennel";
import { ScoreStats } from "../../pup/[id]/page";
import { useWallet } from "../../wallet";

type HandlerData = { pups: { id: string; agent: Agent | null; score: Score }[]; score: Score };

export default function HandlerPage() {
  const { id } = useParams<{ id: string }>();
  const { accountId, call } = useWallet();
  const [data, setData] = useState<HandlerData | null | undefined>(undefined);
  const [msg, setMsg] = useState("");
  const load = () => api<HandlerData>(`/handlers/${id}`).then(setData);
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = accountId === id;
  const act = (method: string, agent_id: string) =>
    call(method, method === "withdraw" ? { agent_id, amount: null } : { agent_id }, { gas: "50 Tgas" })
      .then(() => { setMsg(`${method} sent for ${agent_id}`); setTimeout(load, 2500); })
      .catch((e) => setMsg(e.message));

  return (
    <>
      <section className="hero">
        <h1 style={{ fontSize: 30 }}>🧑 Handler {id}</h1>
        <p>A handler is the human behind its pups. Every pup is a sub-account of the handler, and every result of every pup counts toward this score.</p>
      </section>
      {data === undefined ? <div className="empty">Loading…</div> : data === null ? (
        <div className="empty">The handler view needs the indexer API, which is not reachable right now.</div>
      ) : (
        <>
          <ScoreStats s={data.score} />
          <div className="panel">
            <h2>Pups ({data.pups.length})</h2>
            <table>
              <thead><tr><th>Pup</th><th>Budget</th><th>Status</th><th>Launch score</th><th>Bark accuracy</th>{mine && <th />}</tr></thead>
              <tbody>
                {data.pups.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/pup/${p.id}`}>{p.id}</Link></td>
                    <td>{p.agent ? `${fmt(yoctoToNear(p.agent.balance), 3)} NEAR` : "–"}</td>
                    <td>{!p.agent ? "unregistered" : p.agent.revoked ? "revoked" : p.agent.paused ? "paused" : "active"}</td>
                    <td>{p.score.launch_score}</td>
                    <td>{p.score.barks_judged ? `${p.score.barks_correct}/${p.score.barks_judged}` : "–"}</td>
                    {mine && p.agent && (
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn ghost small" onClick={() => act(p.agent!.paused ? "unpause_agent" : "pause_agent", p.id)}>{p.agent.paused ? "unpause" : "pause"}</button>
                        <button className="btn ghost small" onClick={() => act("withdraw", p.id)}>withdraw all</button>
                        {!p.agent.revoked && <button className="btn ghost small" onClick={() => act("revoke_agent", p.id)}>revoke</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {msg && <div className="note" style={{ marginTop: 8 }}>{msg}</div>}
          </div>
          <div className="panel">
            <h2>Add a pup</h2>
            <p className="note">Create a pup (sub-account + function-call key + budget) with the CLI. It signs with your near-cli keychain:</p>
            <pre className="mono-box">{`node packages/cli/kennel.mjs pup create <name> --handler ${id} --budget 4`}</pre>
          </div>
        </>
      )}
    </>
  );
}
