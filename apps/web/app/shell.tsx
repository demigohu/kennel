"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, fmt, short, signed } from "../lib/kennel";
import { Avatar } from "./ui";

/** Search coins and accounts (⌘K), like pump.fun's top bar. */
export function Search() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ coins: { symbol: string; name: string; icon: string; market_cap_near: number }[]; accounts: string[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!q.trim()) return setRes(null);
    const t = setTimeout(() => api<typeof res>(`/search?q=${encodeURIComponent(q)}`).then(setRes), 200);
    return () => clearTimeout(t);
  }, [q]);
  const go = (href: string) => {
    setQ("");
    router.push(href);
  };
  return (
    <div className="search">
      <input ref={input} placeholder="Search for coins and users…  ⌘K" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && q.trim() && go(q.includes(".") ? `/u/${q.trim()}` : `/litter/${q.trim().toLowerCase()}`)} />
      {res && (res.coins.length > 0 || res.accounts.length > 0) && (
        <div className="search-pop">
          {res.coins.map((c) => (
            <button key={c.symbol} onClick={() => go(`/litter/${c.symbol}`)}>
              <img src={c.icon} alt="" className="mini" /> <b>{c.name}</b> ${c.symbol.toUpperCase()} <span className="muted">{fmt(c.market_cap_near)} NEAR MC</span>
            </button>
          ))}
          {res.accounts.map((a) => (
            <button key={a} onClick={() => go(`/u/${a}`)}><Avatar id={a} size={18} /> {a}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Top traders' 24h profit, scrolling under the top bar. */
export function Ticker() {
  const [rows, setRows] = useState<{ account: string; profit: number }[]>([]);
  useEffect(() => {
    const load = () => api<typeof rows>("/ticker").then((r) => r && setRows(r));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!rows.length) return null;
  return (
    <div className="ticker">
      {rows.map((r) => (
        <Link key={r.account} href={`/u/${r.account}`}>
          <Avatar id={r.account} size={18} /> @{short(r.account, 20)} <span className="bull">{signed(r.profit)} NEAR</span>
        </Link>
      ))}
    </div>
  );
}
