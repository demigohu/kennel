import assert from "node:assert/strict";
import test from "node:test";
import { coinStats, mark, positions, priceAt, windowPnl } from "./analytics.mjs";

const N = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString(); // NEAR -> yocto
const T = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString(); // tokens -> units
const trade = (ts, account, side, near, tokens, fee = 0, price = 1) => ({
  ts, kind: "trade", data: { symbol: "dog", account, side, near: N(near), tokens: T(tokens), fee: N(fee), price: N(price) },
});

test("average cost: partial sell realizes against the average entry", () => {
  const ev = [
    trade("2026-01-01T00:00:00Z", "a", "buy", 1, 100),
    trade("2026-01-01T00:01:00Z", "a", "buy", 3, 100),
    trade("2026-01-01T00:02:00Z", "a", "sell", 5, 100, 0.05),
  ];
  const [p] = positions(ev);
  // avg cost 2 per 100 tokens; sold 100 for 4.95 net -> realized 2.95, cost left 2
  assert.equal(p.held, 100);
  assert.ok(Math.abs(p.realized - 2.95) < 1e-9);
  assert.ok(Math.abs(p.cost - 2) < 1e-9);
  const m = mark(p, 0.03, 1000);
  assert.ok(Math.abs(m.unrealized - 1) < 1e-9); // 100 * 0.03 - 2
  assert.ok(Math.abs(m.pnl - 3.95) < 1e-9);
  assert.ok(Math.abs(windowPnl([m], Date.parse("2026-01-01T00:01:30Z")) - 3.95) < 1e-9);
});

test("dev buy is locked until a trick unlocks it; a burn is a realized loss", () => {
  const ev = [
    { ts: "2026-01-01T00:00:00Z", kind: "launch", data: { symbol: "dog", creator: "pup" } },
    trade("2026-01-01T00:00:00Z", "pup", "dev_buy", 1, 100),
    { ts: "2026-01-01T00:10:00Z", kind: "trick_passed", data: { symbol: "dog", amount: T(50) } },
    { ts: "2026-01-01T00:20:00Z", kind: "trick_burned", data: { symbol: "dog", amount: T(50) } },
  ];
  const [p] = positions(ev);
  assert.equal(p.held, 50);
  assert.equal(p.locked, 0);
  assert.ok(Math.abs(p.realized + 0.5) < 1e-9);
});

test("coin stats and priceAt", () => {
  const ev = [
    trade("2026-01-01T00:00:00Z", "a", "buy", 1, 100, 0, 1),
    trade("2026-01-01T01:00:00Z", "b", "buy", 2, 100, 0, 2),
    trade("2026-01-01T01:30:00Z", "a", "sell", 1, 50, 0, 1.5),
  ].map((e) => ({ ...e.data, ts: e.ts }));
  assert.equal(priceAt(ev, Date.parse("2026-01-01T00:30:00Z")), 1);
  const s = coinStats(ev, Date.parse("2026-01-01T00:30:00Z"), 3);
  assert.equal(s.buys, 1);
  assert.equal(s.sells, 1);
  assert.equal(s.buyers, 1);
  assert.equal(Math.round(s.price_change_pct), 200);
});
