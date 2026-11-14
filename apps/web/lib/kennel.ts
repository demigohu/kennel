import { Near } from "near-kit";

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT ?? "kennel.testnet";
export const API = process.env.NEXT_PUBLIC_API ?? "https://api.kennelpad.fun";
export const EXPLORER = "https://testnet.nearblocks.io";
export const TOTAL_SUPPLY = 1_000_000_000;
export const GRADUATION_NEAR = 10;
/** Kept back from a buy for the ledger entry; the unused part is refunded by the contract. */
export const STORAGE_RESERVE = 0.01;

export type Trick = { target_holders: number; deadline_ms: string; amount: string; status: "Pending" | "Passed" | "Burned" };
export type Coin = {
  symbol: string; token_id: string; name: string; description: string; icon: string;
  creator: string; operator: string; created_at: string;
  status: "Pending" | "Curve" | "Graduating" | "Graduated";
  near_reserve: string; tokens_sold: string; dev_tokens: string; tricks: Trick[];
  holders: number; burned: string; post_count: number;
  graduation: { pool_id: number | null; pool_near: string };
  trades?: number; volume_24h_near?: number;
  market_cap_near?: number; replies?: number; last_trade?: string | null; last_reply?: string | null;
};
export type Links = { website: string | null; x: string | null; telegram: string | null };
export type Post = {
  id: number; coin: string; author: string; kind: "Post" | "Reply" | "Bark" | "Comment";
  parent: number | null; text: string; stance: "Bull" | "Bear" | null;
  lock_until: string | null; position: string | null; ts: string;
};
export type Agent = { operator: string; balance: string; accepted: boolean; paused: boolean; revoked: boolean; created_at: string };
export type Score = {
  coins_created: number; graduated: number; tricks_passed: number; tricks_burned: number;
  launch_score: number; barks: number; barks_judged: number; barks_correct: number;
};

export const reader = new Near({ network: NETWORK });
export const view = <T,>(method: string, args: object = {}) => reader.view<T>(CONTRACT, method, args);

/** Indexer API; returns null when it is unreachable so pages can fall back to the contract. */
export async function api<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const yoctoToNear = (y: string | number | bigint) => Number(BigInt(y ?? 0)) / 1e24;
export const unitsToTokens = (u: string | number | bigint) => Number(BigInt(u ?? 0)) / 1e18;

export function nearToYocto(n: string): string {
  const [w, f = ""] = n.trim().split(".");
  return (BigInt(w || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
}

export function tokensToUnits(n: string): string {
  const [w, f = ""] = n.trim().split(".");
  return (BigInt(w || "0") * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18))).toString();
}

let usdRate: Promise<number | null> | null = null;
/** NEAR/USD on mainnet. Testnet NEAR has no price, so USD figures use the mainnet rate to show scale. */
export function nearUsd(): Promise<number | null> {
  usdRate ??= fetch("https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd")
    .then((r) => r.json()).then((d) => Number(d.near.usd) || null)
    .catch(() => fetch("https://api.binance.com/api/v3/ticker/price?symbol=NEARUSDT").then((r) => r.json()).then((d) => Number(d.price) || null))
    .catch(() => null);
  return usdRate;
}

export const usd = (v: number) => (Math.abs(v) >= 1 ? `$${fmt(v, Math.abs(v) >= 1e3 ? 1 : 2)}` : `$${v === 0 ? "0" : v.toPrecision(2)}`);

export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}K`;
  if (abs > 0 && abs < 0.001) return n.toExponential(2);
  return n.toFixed(digits);
}

export const progress = (c: Coin) => Math.min(100, (yoctoToNear(c.near_reserve) / GRADUATION_NEAR) * 100);

export function short(account: string, max = 22) {
  return account.length > max ? `${account.slice(0, max - 8)}…${account.slice(-7)}` : account;
}

export function ago(ms: number | string) {
  const s = Math.round((Date.now() - Number(ms)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function countdown(ms: number | string) {
  const s = Math.round((Number(ms) - Date.now()) / 1000);
  if (s <= 0) return "ended";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

/** Contract `get_coins`, newest first, when the indexer is down. */
export async function coinsFromContract(): Promise<Coin[]> {
  const all = (await view<Coin[]>("get_coins", { from_index: 0, limit: 200 })) ?? [];
  return all.filter((c) => c.status !== "Pending").sort((a, b) => Number(b.created_at) - Number(a.created_at));
}

export const poolUrl = (poolId: number) => `https://testnet.rhea.finance/pool/${poolId}`;
export const DEX = "ref-finance-101.testnet";
export const WNEAR = "wrap.testnet";
export const dexView = <T,>(contract: string, method: string, args: object = {}) => reader.view<T>(contract, method, args);

// ---------- pump.fun-style analytics (indexer) ----------
export type CoinRow = Coin & { price: number; market_cap_near: number; change_pct: number; volume_tf: number; trades_tf: number; replies: number; hot: boolean };
export type Callout = Post & {
  name: string; icon: string; mcap_at_call: number; mcap_now: number; call_pct: number;
  position_tokens: number; position_value: number; position_profit: number; replies: number; locked: boolean; tx_hash: string;
};
export type Window = { price_change_pct: number; volume: number; buys: number; sells: number; buy_volume: number; sell_volume: number; buyers: number; sellers: number };
export type CoinStats = {
  price: number; market_cap: number; ath_market_cap: number; volume_24h: number; holders: number; dev_pct: number; dev_locked_pct?: number;
  windows: Record<"5m" | "1h" | "6h" | "24h", Window>;
  pool: { id: number; dex: string; token_account_ids: string[]; amounts: string[] } | null;
  fees: { total_bps: number; creator_bps: number; protocol_bps: number; creator: string };
};
export type Holder = { account: string; held: number; pct: number; value: number; profit: number | null; avg_entry_mcap: number | null; bought: number; label: string | null };
export type Position = {
  symbol: string; name: string; icon: string; mcap: number; held: number; locked: number; value: number; cost: number; spent: number;
  realized: number; unrealized: number; pnl: number; pnl_pct: number; avg_entry_mcap: number | null; first: string | null; last: string | null;
};
export type Account = {
  id: string; agent: Agent | null; pups: string[]; joined: string | null; portfolio_value: number; realized: number; unrealized: number;
  buy_volume: number; series: { time: number; value: number }[]; open: Position[]; closed: Position[]; top_trades: Position[];
  replies: Post[]; activity: { ts: string; data: { symbol: string; side: string; near: string; tokens: string }; tx_hash: string }[];
  score: Score; launched: (Coin & { market_cap_near: number })[];
};

export const signed = (n: number, d = 3) => `${n >= 0 ? "+" : ""}${fmt(n, d)}`;
export const pct = (n: number) => `${n >= 0 ? "↑" : "↓"} ${fmt(Math.abs(n), 1)}%`;
