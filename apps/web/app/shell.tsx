"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, fmt, short, signed } from "../lib/kennel";
import { DotAvatar } from "./ascii";
import { CoinImage } from "./ui";

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
      <input ref={input} placeholder="SEARCH COINS AND ACCOUNTS  ⌘K" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && q.trim() && go(q.includes(".") ? `/u/${q.trim()}` : `/coin/${q.trim().toLowerCase()}`)} />
      {res && (res.coins.length > 0 || res.accounts.length > 0) && (
        <div className="search-pop">
          {res.coins.map((c) => (
            <button key={c.symbol} onClick={() => go(`/coin/${c.symbol}`)}>
              <CoinImage coin={c} size={16} /> <b>{c.name}</b> ${c.symbol.toUpperCase()} <span className="muted">{fmt(c.market_cap_near)} NEAR MC</span>
            </button>
          ))}
          {res.accounts.map((a) => (
            <button key={a} onClick={() => go(`/u/${a}`)}><DotAvatar id={a} size={18} /> {a}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Top traders' 24h profit, scrolling under the top bar. */
export function Ticker() {
  const path = usePathname();
  const [rows, setRows] = useState<{ account: string; profit: number }[]>([]);
  useEffect(() => {
    const load = () => api<typeof rows>("/ticker").then((r) => r && setRows(r));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!rows.length || path === "/") return null;
  return (
    <div className="ticker">
      {rows.map((r) => (
        <Link key={r.account} href={`/u/${r.account}`}>
          <DotAvatar id={r.account} size={14} /> @{short(r.account, 20)} <span className="bull">{signed(r.profit)} NEAR</span>
        </Link>
      ))}
    </div>
  );
}

export function Wordmark() {
  return <Link href="/" className="wordmark">kennel<sup>®</sup></Link>;
}

const NAV: [string, string][] = [["/app", "App"], ["/leaderboard", "Leaderboard"], ["/how", "How it works"], ["/launch", "Launch"]];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map(([href, label]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? "on" : ""}>{label}</Link>
      ))}
    </nav>
  );
}

/** Page container; the landing is full-bleed. */
export function Main({ children }: { children: React.ReactNode }) {
  return <main className={usePathname() === "/" ? "bleed" : undefined}>{children}</main>;
}

/** App footer (the landing has its own inverted footer). */
export function AppFooter() {
  if (usePathname() === "/") return null;
  return (
    <footer className="foot">
      <span>kennel · near testnet · contract kennel.testnet</span>
      <span>graduates to rhea · <a href="https://github.com/demigohu/kennel">source</a></span>
    </footer>
  );
}
