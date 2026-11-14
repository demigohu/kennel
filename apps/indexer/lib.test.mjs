import assert from "node:assert/strict";
import test from "node:test";
import { candles, extractEvents, keeperJobs, score } from "./lib.mjs";

const yocto = (near) => (BigInt(Math.round(near * 1e6)) * 10n ** 18n).toString();

test("extractEvents keeps successful kennel events only", () => {
  const ev = (event) => `EVENT_JSON:${JSON.stringify({ standard: "kennel", version: "1.0.0", event, data: [{ symbol: "dog" }] })}`;
  const receipt = (id, executor, status, logs) => ({
    receipt: { receipt_id: id },
    execution_outcome: { id, block_height: 10, block_timestamp: "1700000000000000000", outcome: { executor_id: executor, status, logs } },
  });
  const tx = {
    transaction: { hash: "tx1" },
    receipts: [
      receipt("r1", "kennel.testnet", { SuccessValue: "" }, [ev("trade"), "plain log"]),
      receipt("r2", "kennel.testnet", { Failure: {} }, [ev("trade")]),
      receipt("r3", "other.testnet", { SuccessValue: "" }, [ev("trade")]),
    ],
  };
  const out = extractEvents(tx, "kennel.testnet");
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "trade");
  assert.equal(out[0].receipt_id, "r1");
  assert.equal(out[0].tx_hash, "tx1");
});

test("candles bucket trades and carry open from previous close", () => {
  const trades = [
    { ts: "2026-01-01T00:00:05Z", price: yocto(1), near: yocto(1) },
    { ts: "2026-01-01T00:00:30Z", price: yocto(3), near: yocto(1) },
    { ts: "2026-01-01T00:01:10Z", price: yocto(2), near: yocto(2) },
  ];
  const c = candles(trades, 60);
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].open, c[0].high, c[0].low, c[0].close], [1, 3, 1, 3]);
  assert.equal(c[1].open, 3);
  assert.equal(c[1].low, 2);
  assert.equal(c[1].volume, 2);
});

test("score judges finished barks against price at lock end", () => {
  const t = (iso, p) => ({ ts: iso, price: yocto(p), near: yocto(1) });
  const trades = { dog: [t("2026-01-01T00:00:00Z", 1), t("2026-01-01T02:00:00Z", 2)] };
  const at = (iso) => String(Date.parse(iso));
  const s = score({
    coinsCreated: 1, graduated: 1, tricksPassed: 2, tricksBurned: 1,
    barks: [
      { coin: "dog", stance: "Bull", ts: at("2026-01-01T00:30:00Z"), lock_until: at("2026-01-01T03:00:00Z") },
      { coin: "dog", stance: "Bear", ts: at("2026-01-01T00:30:00Z"), lock_until: at("2026-01-01T03:00:00Z") },
      { coin: "dog", stance: "Bull", ts: at("2026-01-01T00:30:00Z"), lock_until: at("2099-01-01T00:00:00Z") },
    ],
    tradesBySymbol: trades,
    now: Date.parse("2026-01-02T00:00:00Z"),
  });
  assert.equal(s.launch_score, 3 + 2 - 2);
  assert.equal(s.barks_judged, 2);
  assert.equal(s.barks_correct, 1);
});

test("keeperJobs settles expired tricks, retries stuck graduations and unlocks", () => {
  const trick = (status, deadline) => ({ status, deadline_ms: String(deadline) });
  const coins = [
    { symbol: "late", status: "Curve", tricks: [trick("Pending", 900)] },
    { symbol: "fresh", status: "Curve", tricks: [trick("Pending", 2000)] },
    { symbol: "done", status: "Curve", tricks: [trick("Passed", 900)] },
    { symbol: "grad", status: "Graduating", tricks: [] },
    { symbol: "leash", status: "Graduated", tricks: [] },
    { symbol: "free", status: "Graduated", tricks: [] },
  ];
  const graduatingSince = new Map();
  const leashed = new Set(["leash"]);
  assert.deepEqual(keeperJobs(coins, 1000, { graduatingSince, leashed }), [
    { method: "check_tricks", symbol: "late" },
    { method: "unlock_token", symbol: "leash" },
  ]);
  // After the grace period the stuck graduation is retried.
  assert.deepEqual(keeperJobs(coins, 61_000, { graduatingSince, leashed }).map((j) => j.method), ["check_tricks", "check_tricks", "graduate", "unlock_token"]);
});
