"use client";
import { useEffect, useRef } from "react";

// A 3D point-cloud pup rendered as ASCII glyphs. It wanders the ground plane, follows the pointer,
// and walks over to eat the biscuits you drop with a click. Everything is procedural: a spine with a
// radius profile, floppy ears, a wagging tail and four legs on a walk cycle, lit and z-buffered per cell.

const RAMP = ["·", ":", "/", "+", "×", "#", "■"];
const INK = "#60ce8b";
const DIM = "#3a8a5a";
const FAINT = "#1d4a30";
const LIGHT = norm(-0.35, 0.85, 0.4);
const PITCH = 0.42; // camera tilt (radians): we look slightly down at the ground
const CELL = 10;

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Body half-thickness along the spine: s=0 tail tip, s=1 nose. */
function radius(s: number) {
  if (s < 0.2) return 0.035 + 0.02 * (s / 0.2); // tail
  if (s < 0.72) return 0.09 + 0.2 * Math.sin(((s - 0.2) / 0.52) * Math.PI) ** 0.5; // torso
  if (s < 0.79) return 0.13; // neck
  if (s < 0.92) return 0.13 + 0.07 * Math.sin(((s - 0.79) / 0.13) * Math.PI); // head
  return 0.1 * (1 - (s - 0.92) / 0.08) + 0.04; // snout
}

/** Spine height above the body origin. */
function spineY(s: number, t: number, wag: number) {
  if (s < 0.2) return 0.05 + (0.2 - s) * 1.6 + Math.sin(t * 3) * 0.02 * wag; // tail curls up
  if (s < 0.72) return 0.05;
  if (s < 0.8) return 0.05 + (s - 0.72) * 3.2; // neck rises
  return 0.3 - (s - 0.8) * 0.4;
}

type Crumb = { x: number; z: number; born: number };

export function Pup3D({ onEat }: { onEat?: (count: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const eatRef = useRef(onEat);
  eatRef.current = onEat;

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const L = 2.1; // body length (world units)
    const dog = { x: 0, z: 0.2, heading: Math.PI, speed: 0, turn: 0, phase: 0, wag: 0.4, hop: 0, look: 0 };
    let target = { x: -1.2, z: 0.3 };
    let pointer: { x: number; z: number; at: number } | null = null;
    const crumbs: Crumb[] = [];
    let wanderAt = 0;
    let eaten = 0;
    let raf = 0;
    let last = performance.now();
    let W = 0, H = 0, S = 1, dpr = 1;
    // Point buffers: x, y, z, nx, ny, nz
    const pts = new Float32Array(9000 * 6);
    let n = 0;
    const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      if (n >= 9000) return;
      const i = n * 6;
      pts[i] = x; pts[i + 1] = y; pts[i + 2] = z; pts[i + 3] = nx; pts[i + 4] = ny; pts[i + 5] = nz;
      n++;
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = el.clientWidth;
      H = el.clientHeight;
      el.width = W * dpr;
      el.height = H * dpr;
      S = Math.min(W / 5.4, H / 2.5); // pixels per world unit
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    /** Screen -> ground plane (y = GROUND). */
    const GROUND = -0.5;
    const toGround = (px: number, py: number) => {
      const sx = (px - W / 2) / S;
      const sy = (H * 0.58 - py) / S;
      // sy = GROUND*cos(PITCH) + z*sin(PITCH)  (see project())
      const z = (sy - GROUND * Math.cos(PITCH)) / Math.sin(PITCH);
      return { x: sx, z: Math.max(-1.4, Math.min(1.4, -z)) };
    };
    const project = (x: number, y: number, z: number) => ({
      sx: W / 2 + x * S,
      sy: H * 0.58 - (y * Math.cos(PITCH) - z * Math.sin(PITCH)) * S,
      depth: z * Math.cos(PITCH) + y * Math.sin(PITCH),
    });

    const build = (t: number) => {
      n = 0;
      const ch = Math.cos(dog.heading), sh = Math.sin(dog.heading);
      // local (forward f, up u, side q) -> world
      const toWorld = (f: number, u: number, q: number): [number, number, number] => [
        dog.x + f * ch - q * sh,
        u + dog.hop,
        dog.z + f * sh + q * ch,
      ];
      const wagAmp = 0.06 + dog.wag * 0.22;
      const walk = Math.min(1, dog.speed / 1.2);
      // Spine rings
      for (let k = 0; k <= 200; k++) {
        const s = k / 200;
        const f = (s - 0.5) * L;
        const r = radius(s);
        const y = spineY(s, t, dog.wag);
        let side = 0;
        if (s < 0.2) side = Math.sin(t * (6 + dog.wag * 10)) * wagAmp * (0.2 - s) * 5; // tail wag
        if (s > 0.78) side += dog.look * (s - 0.78) * 1.2; // head turns toward target
        const bob = s > 0.72 ? Math.sin(dog.phase * 2) * 0.012 * walk : 0;
        const rings = s < 0.2 ? 8 : 22;
        for (let j = 0; j < rings; j++) {
          const a = (j / rings) * Math.PI * 2;
          const cy = Math.cos(a), sq = Math.sin(a);
          const [wx, wy, wz] = toWorld(f, y + bob + r * 0.85 * cy, side + r * sq);
          const [nx, , nz] = [-sq * sh, 0, sq * ch];
          push(wx, wy, wz, nx, cy, nz);
        }
      }
      // Floppy ears hanging from the sides of the head
      for (const q of [-1, 1]) {
        const swing = Math.sin(dog.phase * 2 + q) * 0.03 * walk + dog.look * 0.05 * q;
        for (let a = 0; a <= 8; a++) {
          for (let b = 0; b <= 4; b++) {
            const f = (0.83 - 0.5) * L - b * 0.02;
            const down = a * 0.022;
            const [wx, wy, wz] = toWorld(f + swing, 0.36 - down, q * (0.16 + down * 0.25) + dog.look * 0.15);
            push(wx, wy, wz, q * -sh * 0.6, 0.3, q * ch * 0.6);
          }
        }
      }
      // Legs: hips at s=0.27 (rear) and shoulders at s=0.64 (front)
      const legs = [
        { s: 0.27, q: 0.11, off: 0 },
        { s: 0.27, q: -0.11, off: Math.PI },
        { s: 0.64, q: 0.11, off: Math.PI },
        { s: 0.64, q: -0.11, off: 0 },
      ];
      for (const leg of legs) {
        const hipF = (leg.s - 0.5) * L;
        const ph = dog.phase + leg.off;
        const footF = hipF + Math.sin(ph) * 0.16 * walk;
        const lift = Math.max(0, Math.cos(ph)) * 0.09 * walk;
        for (let k = 0; k <= 14; k++) {
          const u = k / 14;
          const f = hipF + (footF - hipF) * u;
          const y = 0.02 + (GROUND + lift - 0.02) * u - dog.hop * u;
          const rr = 0.065 * (1 - u * 0.35);
          for (let j = 0; j < 7; j++) {
            const a = (j / 7) * Math.PI * 2;
            const [wx, wy, wz] = toWorld(f + Math.cos(a) * rr, y, leg.q + Math.sin(a) * rr);
            push(wx, wy, wz, Math.cos(a) * ch, 0.2, Math.sin(a) * ch);
          }
        }
        // paw
        for (let j = 0; j < 5; j++) {
          const [wx, wy, wz] = toWorld(footF + j * 0.02, GROUND + lift - dog.hop, leg.q);
          push(wx, wy, wz, 0, 1, 0);
        }
      }
    };

    const depth = new Float32Array(0);
    let zbuf = depth;
    let glyph = new Uint8Array(0);
    let shade = new Float32Array(0);

    const render = (t: number) => {
      const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
      if (zbuf.length !== cols * rows) {
        zbuf = new Float32Array(cols * rows);
        glyph = new Uint8Array(cols * rows);
        shade = new Float32Array(cols * rows);
      }
      zbuf.fill(-Infinity);
      glyph.fill(0);
      build(t);
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        const p = project(pts[o]!, pts[o + 1]!, pts[o + 2]!);
        const c = Math.floor(p.sx / CELL), r = Math.floor(p.sy / CELL);
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const k = r * cols + c;
        if (p.depth <= zbuf[k]!) continue;
        zbuf[k] = p.depth;
        const lum = Math.max(0, pts[o + 3]! * LIGHT[0] + pts[o + 4]! * LIGHT[1] + pts[o + 5]! * LIGHT[2]);
        shade[k] = 0.25 + lum * 0.75;
        glyph[k] = 1;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.font = `${CELL - 1}px "Departure Mono", monospace`;
      ctx.textBaseline = "top";
      // shadow on the ground under the pup
      const sh = project(dog.x, GROUND, dog.z);
      ctx.fillStyle = FAINT;
      for (let dx = -10; dx <= 10; dx++) {
        if (Math.abs(dx) > 8 - Math.abs(dog.hop) * 20) continue;
        ctx.fillText("·", sh.sx + dx * CELL, sh.sy);
      }
      for (let k = 0; k < glyph.length; k++) {
        if (!glyph[k]) continue;
        const b = Math.pow(shade[k]!, 1.6);
        ctx.fillStyle = b > 0.6 ? INK : b > 0.38 ? DIM : FAINT;
        ctx.fillText(RAMP[Math.min(RAMP.length - 1, Math.floor(b * RAMP.length))]!, (k % cols) * CELL, Math.floor(k / cols) * CELL);
      }
      // biscuits
      for (const cr of crumbs) {
        const p = project(cr.x, GROUND, cr.z);
        ctx.fillStyle = "#b8f5cf";
        ctx.fillText("◎", p.sx, p.sy - CELL / 2);
      }
    };

    const step = (dt: number, t: number) => {
      // Target priority: nearest biscuit, then a recent pointer, then wandering.
      const crumb = crumbs[0];
      if (crumb) target = crumb;
      else if (pointer && t - pointer.at < 2.5) target = pointer;
      else if (t > wanderAt) {
        target = { x: (Math.random() - 0.5) * 2 * Math.max(0.5, W / 2 / S - L * 0.6), z: (Math.random() - 0.5) * 1.6 };
        wanderAt = t + 4 + Math.random() * 3;
      }
      const dx = target.x - dog.x, dz = target.z - dog.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dz, dx);
      let diff = want - dog.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const stop = crumb ? 0.55 : 0.9;
      const desired = dist > stop ? Math.min(1.4, (dist - stop) * 1.6) * (0.35 + 0.65 * Math.max(0, Math.cos(diff))) : 0;
      dog.speed += (desired - dog.speed) * Math.min(1, dt * 3);
      dog.turn += (Math.max(-2.4, Math.min(2.4, diff * 2.8)) - dog.turn) * Math.min(1, dt * 5);
      if (dog.speed > 0.05 || Math.abs(diff) > 0.3) dog.heading += dog.turn * dt * (0.4 + dog.speed);
      dog.look += (Math.max(-0.6, Math.min(0.6, diff)) - dog.look) * Math.min(1, dt * 4);
      dog.x += Math.cos(dog.heading) * dog.speed * dt;
      dog.z += Math.sin(dog.heading) * dog.speed * dt;
      const maxX = Math.max(0.5, W / 2 / S - L * 0.6);
      dog.x = Math.max(-maxX, Math.min(maxX, dog.x));
      dog.z = Math.max(-1.3, Math.min(1.3, dog.z));
      dog.phase += dt * (2 + dog.speed * 9);
      dog.wag += (0.3 - dog.wag) * Math.min(1, dt * 0.8);
      dog.hop = Math.max(0, dog.hop - dt * 0.6) * 0.96;
      // Eat a biscuit when the nose reaches it.
      if (crumb) {
        const nx = dog.x + Math.cos(dog.heading) * L * 0.5, nz = dog.z + Math.sin(dog.heading) * L * 0.5;
        if (Math.hypot(crumb.x - nx, crumb.z - nz) < 0.45 || Math.hypot(crumb.x - dog.x, crumb.z - dog.z) < 0.6) {
          crumbs.shift();
          eaten++;
          dog.wag = 1.4;
          dog.hop = 0.12;
          eatRef.current?.(eaten);
        }
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      step(dt, t);
      render(t);
      raf = requestAnimationFrame(loop);
    };
    if (reduce) render(0);
    else raf = requestAnimationFrame(loop);

    const rect = () => el.getBoundingClientRect();
    const onMove = (e: PointerEvent) => {
      const r = rect();
      pointer = { ...toGround(e.clientX - r.left, e.clientY - r.top), at: performance.now() / 1000 };
    };
    const onClick = (e: MouseEvent) => {
      const r = rect();
      if (crumbs.length < 5) crumbs.push({ ...toGround(e.clientX - r.left, e.clientY - r.top), born: performance.now() / 1000 });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("click", onClick);
    };
  }, []);

  return <canvas ref={canvas} className="pup3d" aria-label="A 3D ASCII pup. Click to drop a biscuit; it walks over and eats it." role="img" />;
}
