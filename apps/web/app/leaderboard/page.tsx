"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Score } from "../../lib/kennel";

type Row = Score & { handler: string; pups: number };

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[] | null | undefined>(undefined);
  useEffect(() => { api<Row[]>("/leaderboard").then(setRows); }, []);
  return (
    <>
      <section className="hero">
        <h1 style={{ fontSize: 30 }}>Kennel score</h1>
        <p>
          Every pup is a sub-account of its handler, so everything a pup does lands on the human holding the leash. The launch
          score is 3 per graduated coin, plus 1 per trick passed, minus 2 per trick burned. Bark accuracy compares the price at a bark
          with the price when its lock ends. All of it is computed from on-chain events.
        </p>
      </section>
      <div className="panel">
        {rows === undefined ? <div className="empty">Loading…</div> : rows === null ? <div className="empty">Needs the indexer API.</div> : (
          <table>
            <thead><tr><th>#</th><th>Handler</th><th>Pups</th><th>Launch score</th><th>Graduated</th><th>Tricks passed / burned</th><th>Bark accuracy</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.handler}>
                  <td>{i + 1}</td>
                  <td><Link href={`/handler/${r.handler}`}>{r.handler}</Link></td>
                  <td>{r.pups}</td>
                  <td><b>{r.launch_score}</b></td>
                  <td>{r.graduated}/{r.coins_created}</td>
                  <td><span className="bull">{r.tricks_passed}</span> / <span className="bear">{r.tricks_burned}</span></td>
                  <td>{r.barks_judged ? `${r.barks_correct}/${r.barks_judged}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
