#!/usr/bin/env node
// Kennel parameter simulation. Reproduces the contract's curve and trick rules and runs:
//   1. curve shape (price / market cap vs NEAR raised, pool price at graduation)
//   2. a 60-day population sim (pups launching daily) under three community scenarios:
//      supply over time, burned by failed tricks, graduations
//   3. sensitivity of trick pass rate to the holder threshold and graduation target
//   4. shill-and-dump profit vs bark lock length (why the minimum is 60 minutes)
// Deterministic (seeded). Writes sim/results.md and sim/*.svg.
// Run: node sim/simulate.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

// ---- contract parameters (contracts/kennel/src/lib.rs `new`) ----
const P = {
  total: 1_000_000_000,
  curve: 800_000_000,
  y0: 1_073_000_000,
  target: 10, // NEAR
  fee: 0.01,
  minHolder: 1_000_000, // tokens
  graduationCosts: 0.25,
};
const vNear = (target, p = P) => (target * (p.y0 - p.curve)) / p.curve;

// ---- deterministic RNG ----
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const poisson = (l) => {
  let k = 0, p = 1;
  const L = Math.exp(-l);
  while ((p *= rand()) > L) k++;
  return k;
};
const lognormal = (median, sigma) => {
  const u = Math.max(rand(), 1e-9), v = rand();
  return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
};

// ---- curve (same constant-product formulas as contracts/kennel/src/curve.rs) ----
class Curve {
  constructor(p = P) {
    this.p = p;
    this.v = vNear(p.target, p);
    this.reserve = 0;
    this.sold = 0;
  }
  x() { return this.v + this.reserve; }
  y() { return this.p.y0 - this.sold; }
  price() { return this.x() / this.y(); }
  buy(nearIn) {
    const net = nearIn * (1 - this.p.fee);
    let out = (this.y() * net) / (this.x() + net);
    const left = this.p.curve - this.sold;
    let used = net;
    if (out >= left) {
      out = left;
      used = (this.x() * left) / (this.y() - left);
    }
    this.reserve += used;
    this.sold += out;
    return out;
  }
  sell(tokens) {
    const gross = Math.min((this.x() * tokens) / (this.y() + tokens), this.reserve);
    this.reserve -= gross;
    this.sold -= tokens;
    return gross * (1 - this.p.fee);
  }
  soldOut() { return this.sold >= this.p.curve - 1e-6; }
}

// ---- tiny SVG line chart ----
function chart(file, title, xLabel, series, { yLabel = "" } = {}) {
  const W = 720, H = 360, L = 70, R = 20, T = 40, B = 50;
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(0, ...ys), Math.max(...ys) * 1.05 || 1];
  const sx = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (y) => H - B - ((y - y0) / (y1 - y0 || 1)) * (H - T - B);
  const colors = ["#2a6fdb", "#d9480f", "#2b8a3e", "#862e9c"];
  const fmt = (v) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = y0 + f * (y1 - y0);
    return `<line x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}" stroke="#ddd"/><text x="${L - 6}" y="${sy(y) + 4}" text-anchor="end" font-size="11">${fmt(y)}</text>`;
  }).join("");
  const lines = series.map((s, i) => {
    const d = s.points.map((p, j) => `${j ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
    return `<path d="${d}" fill="none" stroke="${colors[i % 4]}" stroke-width="2"/>` +
      `<text x="${L + 10 + i * 170}" y="${T - 12}" font-size="12" fill="${colors[i % 4]}">■ ${s.name}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif">` +
    `<rect width="100%" height="100%" fill="#fff"/><text x="${L}" y="18" font-size="14" font-weight="bold">${title}</text>` +
    `${grid}${lines}<text x="${(W + L) / 2}" y="${H - 12}" text-anchor="middle" font-size="12">${xLabel}</text>` +
    `<text x="14" y="${(H + T) / 2}" font-size="12" transform="rotate(-90 14 ${(H + T) / 2})" text-anchor="middle">${yLabel}</text>` +
    `<text x="${L}" y="${H - B + 16}" font-size="11">${fmt(x0)}</text><text x="${W - R}" y="${H - B + 16}" font-size="11" text-anchor="end">${fmt(x1)}</text></svg>`;
  writeFileSync(join(OUT, file), svg);
}

const md = [];
const say = (s = "") => md.push(s);

// ======== 1. curve shape ========
{
  const c = new Curve();
  const pts = [], mcap = [];
  for (let raised = 0; !c.soldOut(); ) {
    const t = c.buy(0.1);
    raised = c.reserve;
    pts.push([raised, c.price() * 1e9]);
    mcap.push([raised, c.price() * P.total]);
    if (!t) break;
  }
  const poolPrice = (c.reserve - P.graduationCosts) / (P.total - P.curve);
  chart("curve.svg", "Market cap (NEAR) vs NEAR raised on the curve", "NEAR raised", [{ name: "market cap", points: mcap }], { yLabel: "NEAR" });
  say("## 1. Curve");
  say();
  say(`Virtual reserves: ${vNear(P.target).toFixed(4)} NEAR / ${P.y0 / 1e6}M tokens. ${P.curve / 1e6}M tokens are sold on the curve; the last one sells when ${c.reserve.toFixed(3)} NEAR is raised.`);
  say();
  say("| NEAR raised | price (NEAR per 1M tokens) | market cap (NEAR) |");
  say("|---|---|---|");
  for (const r of [0, 1, 2.5, 5, 7.5, 10]) {
    const p = mcap.find((m) => m[0] >= r) ?? mcap.at(-1);
    say(`| ${r} | ${(p[1] / P.total * 1e6).toFixed(5)} | ${p[1].toFixed(2)} |`);
  }
  say();
  say(`At graduation the pool opens at ${(poolPrice * 1e6).toFixed(5)} NEAR per 1M tokens against a last curve price of ${(c.price() * 1e6).toFixed(5)}, a ${(((c.price() - poolPrice) / c.price()) * 100).toFixed(1)}% step down. That keeps the jump from curve to DEX small.`);
  say();
  say("![curve](curve.svg)");
  say();
}

// ======== 2. 60-day population ========
const TRICKS = [
  { holders: 3, minutes: 15 },
  { holders: 10, minutes: 120 },
  { holders: 25, minutes: 1440 },
];

/** Simulates one coin minute by minute for up to 7 days. */
function simCoin({ quality, minHolder = P.minHolder, target = P.target, devBuy }) {
  const c = new Curve({ ...P, target });
  const dev = c.buy(devBuy);
  const tranche = dev / TRICKS.length;
  const holders = new Map();
  const status = TRICKS.map(() => "pending");
  let burned = 0, unlocked = 0, graduatedAt = null;
  const valid = () => [...holders.values()].filter((b) => b >= minHolder).length;
  // Interest decays: most buyers arrive in the first hours.
  for (let m = 1; m <= 7 * 1440 && graduatedAt === null; m++) {
    const rate = quality * 0.6 * Math.exp(-m / (quality * 600 + 60));
    for (let i = poisson(rate); i > 0; i--) {
      const id = Math.floor(rand() * 1e9);
      holders.set(id, (holders.get(id) ?? 0) + c.buy(Math.min(lognormal(0.12, 1), 3)));
      if (c.soldOut()) break;
    }
    // Some holders take profit.
    if (holders.size && rand() < 0.08) {
      const keys = [...holders.keys()];
      const k = keys[Math.floor(rand() * keys.length)];
      c.sell(holders.get(k));
      holders.delete(k);
    }
    const n = valid();
    TRICKS.forEach((t, i) => {
      if (status[i] !== "pending") return;
      if (n >= t.holders) { status[i] = "passed"; unlocked += tranche; }
      else if (m > t.minutes) { status[i] = "burned"; burned += tranche; }
    });
    if (c.soldOut()) {
      graduatedAt = m;
      TRICKS.forEach((t, i) => {
        if (status[i] !== "pending") return;
        if (valid() >= t.holders) { status[i] = "passed"; unlocked += tranche; }
        else { status[i] = "burned"; burned += tranche; }
      });
    }
  }
  // Tricks still pending after 7 days are past every deadline.
  TRICKS.forEach((t, i) => { if (status[i] === "pending") { status[i] = "burned"; burned += tranche; } });
  return { dev, burned, unlocked, graduatedAt, status };
}

const SCENARIOS = {
  "dead (most coins ignored)": () => lognormal(0.15, 0.8),
  "mixed": () => lognormal(0.5, 1),
  "hype (agents and humans pile in)": () => lognormal(1.5, 0.8),
};

say("## 2. 60-day population sim");
say();
say("Each day 20 pups launch a coin with a dev buy of 0.2–1.5 NEAR and the default tricks 3 holders/15 min, 10 holders/2 h and 25 holders/24 h. Each coin draws a \"quality\" from the scenario, which drives buyer arrivals (decaying over time), buy sizes (log-normal, median 0.12 NEAR) and occasional profit-taking. Supply is counted over all launched coins.");
say();
say("| scenario | coins | graduated | tricks passed | tricks burned | dev tokens burned | supply burned |");
say("|---|---|---|---|---|---|---|");
const supplySeries = [];
for (const [name, quality] of Object.entries(SCENARIOS)) {
  seed = 7;
  let supply = 0, burnedTotal = 0, grads = 0, passed = 0, burnedT = 0, devTotal = 0;
  const pts = [];
  for (let day = 1; day <= 60; day++) {
    for (let i = 0; i < 20; i++) {
      const r = simCoin({ quality: quality(), devBuy: 0.2 + rand() * 1.3 });
      supply += P.total;
      burnedTotal += r.burned;
      devTotal += r.dev;
      if (r.graduatedAt !== null) grads++;
      passed += r.status.filter((s) => s === "passed").length;
      burnedT += r.status.filter((s) => s === "burned").length;
    }
    pts.push([day, ((supply - burnedTotal) / supply) * 100]);
  }
  supplySeries.push({ name: name.split(" ")[0], points: pts });
  const coins = 60 * 20;
  say(`| ${name} | ${coins} | ${grads} (${((grads / coins) * 100).toFixed(1)}%) | ${passed} | ${burnedT} | ${((burnedTotal / devTotal) * 100).toFixed(1)}% | ${((burnedTotal / supply) * 100).toFixed(2)}% |`);
}
chart("supply.svg", "Circulating share of minted supply over 60 days (%)", "day", supplySeries, { yLabel: "% of minted supply not burned" });
say();
say("![supply](supply.svg)");
say();
say("Reading: in a dead market most dev bags miss their tricks and burn, so a pup gets nothing out of a coin nobody wants. In a hype market most tricks pass and the burn is small. The burn tracks real community traction, which is the point of the mechanic.");
say();

// ======== 3. sensitivity ========
say("## 3. Parameter sensitivity (mixed scenario, 400 coins each)");
say();
say("| holder threshold (tokens) | ~NEAR to qualify at launch | trick pass rate | graduation target | graduation rate |");
say("|---|---|---|---|---|");
for (const minHolder of [100_000, 1_000_000, 10_000_000]) {
  for (const target of [5, 10, 20]) {
    seed = 99;
    let pass = 0, total = 0, grads = 0;
    for (let i = 0; i < 400; i++) {
      const r = simCoin({ quality: SCENARIOS.mixed(), minHolder, target, devBuy: 0.5 });
      pass += r.status.filter((s) => s === "passed").length;
      total += r.status.length;
      if (r.graduatedAt !== null) grads++;
    }
    const qualify = (new Curve({ ...P, target }).price() * minHolder).toFixed(4);
    say(`| ${minHolder.toLocaleString("en")} | ${qualify} | ${((pass / total) * 100).toFixed(1)}% | ${target} NEAR | ${((grads / 400) * 100).toFixed(1)}% |`);
  }
}
say();
say("Chosen: **1,000,000 tokens** (about 0.003 NEAR at launch price) and **10 NEAR**. A 100k threshold makes dust wallets count as holders. A 10M threshold makes tricks hard to pass for small communities on testnet. A 20 NEAR target leaves most coins on the curve forever, and 5 NEAR graduates coins that have barely been tested.");
say();
say("**Sybil limit (stated honestly):** the threshold makes fake holders cost something but does not stop them. A handler who funds 25 fresh top-level accounts with about 0.003 NEAR of tokens each, plus gas and 2% round-trip fees, can pass a trick. Accounts under the handler's own tree (`*.handler.testnet`) and its registered pups never count. Real sybil resistance (proof of personhood, account age) is future work.");
say();

// ======== 4. shill & dump vs bark lock ========
say("## 4. Shill-and-dump profit vs bark lock length");
say();
say("A pup buys 1 NEAR of a coin and barks bull. Followers buy 3 NEAR in total, arriving with a 10-minute half-life. From minute 20, earlier buyers sell back 4% of the open interest per minute. The barker may sell at any minute once its lock has ended and picks the best one. The table shows that best-case profit.");
say();
say("| lock (min) | best dump profit (NEAR) |");
say("|---|---|");
// Profit if the barker dumps at minute t (followers' flow is independent of the barker).
const dumpAt = (t) => {
  const c = new Curve();
  c.buy(2); // some prior activity
  const bag = c.buy(1);
  let followers = 0;
  for (let m = 1; m <= t; m++) {
    followers += c.buy(3 * (Math.LN2 / 10) * Math.exp((-Math.LN2 * m) / 10));
    if (m >= 20 && followers > 0) {
      const s = followers * 0.04;
      c.sell(s);
      followers -= s;
    }
  }
  return c.sell(bag) - 1;
};
const byMinute = Array.from({ length: 241 }, (_, t) => dumpAt(t));
const dumpPts = [];
for (const lock of [0, 5, 15, 30, 45, 60, 90, 120]) {
  const best = Math.max(...byMinute.slice(lock));
  dumpPts.push([lock, best]);
  say(`| ${lock} | ${best.toFixed(3)} |`);
}
const peak = byMinute.indexOf(Math.max(...byMinute));
chart("dump.svg", "Shill-and-dump profit (NEAR) vs bark lock (minutes)", "lock minutes", [{ name: "barker profit", points: dumpPts }], { yLabel: "NEAR" });
say();
say("![dump](dump.svg)");
say();
say(`In this model the best moment to dump is minute ${peak}, when the follower rush peaks. A lock shorter than that does not bind at all, because the barker simply waits for the peak. A lock only cuts dump profit once it reaches past the peak, and around an hour it turns dumping into a loss. **This is why Kennel's minimum bark lock is 60 minutes** (an earlier deploy used 15 minutes; this simulation showed it did not bind, so the contract was redeployed). The lock covers the barker's whole family, so a sibling pup cannot dump instead, and followers see the lock length and the barker's position on the post.`);
writeFileSync(join(OUT, "results.md"), `# Kennel simulation results\n\nGenerated by \`node sim/simulate.mjs\` (deterministic, seeded). Parameters mirror \`contracts/kennel/src/lib.rs\`.\n\n${md.join("\n")}\n`);
console.log(`wrote ${join(OUT, "results.md")}`);
