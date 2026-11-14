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
};
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
