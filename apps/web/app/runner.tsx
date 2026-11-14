"use client";
import { useEffect, useRef } from "react";
import DOG from "./muybridge-dog.json";

// Muybridge's galloping dog (Animal Locomotion, 1887, public domain), pre-converted to ASCII density
// frames by scripts/muybridge.cjs (see DESIGN.md). Two uses: a pup that strolls on its own and runs for the
// bones you drop (hero), and a big dog galloping in place (footer). Glyphs scatter around the pointer.

const RAMP = " ·:/+×x#■■";
const FRAMES = DOG.frames as string[];
const COLS = DOG.cols;
const ROWS = DOG.rows;
const BONE = ["■■   ■■", " ■■■■■ ", "■■   ■■"];

type Mode = "chase" | "gallop";

export function Runner({ mode, ink, cell = 9, onFed }: { mode: Mode; ink: string; cell?: number; onFed?: (n: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fedRef = useRef(onFed);
  fedRef.current = onFed;

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, raf = 0;
    let pointer: { x: number; y: number } | null = null;
    // Chase state (hero)
    const dog = { x: 0, y: 0, vx: 0, vy: 0, dir: 1, frame: 0 };
    const bones: { x: number; y: number; land: number; vy: number; landed: boolean }[] = [];
    const crumbs: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    let wander = { x: 0, y: 0 }, wanderAt = 0.5, last = performance.now();
    let fed = 0;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = el.clientWidth;
      H = el.clientHeight;
      el.width = W * dpr;
      el.height = H * dpr;
      if (!dog.x) { dog.x = W * 0.5; dog.y = H * 0.75; }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const spriteW = COLS * cell, spriteH = ROWS * cell;
    // Depth cue for the strolling pup: lower on screen = closer = bigger.
    const depth = (y: number) => 0.78 + 0.32 * Math.max(0, Math.min(1, y / H));

    const drawDog = (frame: string, ox: number, oy: number, flip: boolean, t: number, cell: number) => {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const lvl = frame.charCodeAt(r * COLS + c) - 48;
          if (lvl <= 0) continue;
          let x = ox + (flip ? COLS - 1 - c : c) * cell;
          let y = oy + r * cell;
          let ch = RAMP[lvl]!;
          let alpha = 0.35 + lvl * 0.07;
          if (pointer && !reduce) {
            // Glyphs near the pointer scatter, like the reference's horse.
            const d = Math.hypot(x - pointer.x, y - pointer.y);
            if (d < 110) {
              const f = 1 - d / 110;
              const n = Math.sin(c * 91.7 + r * 47.3 + t * 9);
              x += n * 14 * f;
              y += Math.cos(c * 13.1 + r * 71.9 + t * 7) * 14 * f;
              ch = RAMP[1 + Math.floor(Math.abs(n) * 6)]!;
              alpha *= 1 - f * 0.55;
            }
          }
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.fillText(ch, x, y);
        }
      }
      ctx.globalAlpha = 1;
    };

    const drawBone = (x: number, y: number, cell: number) => {
      BONE.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] !== " ") ctx.fillText("■", x + (c - 3) * cell, y + (r - 1) * cell);
      });
    };

    const frameFor = (t: number, fps: number) => FRAMES[Math.floor(t * fps) % FRAMES.length]!;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.font = `${cell}px "Departure Mono", monospace`;
      ctx.textBaseline = "top";
      ctx.fillStyle = ink;

      if (mode === "gallop") {
        // Shrink the glyph grid on narrow screens so the whole dog fits.
        const c = Math.min(cell, W / COLS);
        ctx.font = `${c}px "Departure Mono", monospace`;
        drawDog(frameFor(t, 11), (W - COLS * c) / 2, H - ROWS * c, false, t, c);
      } else {
        // Like the reference creature: the pup strolls on its own (short walks, the odd pause) and only
        // breaks into a run when there is a bone to fetch. The pointer only scatters glyphs.
        const bone = bones.find((b) => b.landed);
        let target: { x: number; y: number };
        let pace: number;
        if (bone) {
          // Face the bone first, then park the nose on it.
          const side = Math.sign(bone.x - dog.x) || dog.dir;
          if (Math.abs(bone.x - dog.x) > spriteW * depth(dog.y) * 0.45) dog.dir = side;
          target = { x: bone.x - dog.dir * spriteW * depth(bone.y) * 0.4, y: bone.y };
          pace = 330;
        } else {
          if (t > wanderAt) {
            const pause = Math.random() < 0.3;
            wander = pause
              ? { x: dog.x, y: dog.y }
              : {
                  x: Math.max(W * 0.1, Math.min(W * 0.9, dog.x + (Math.random() - 0.5) * W * 0.6)),
                  y: Math.max(H * 0.35, Math.min(H * 0.95, dog.y + (Math.random() - 0.5) * H * 0.4)),
                };
            wanderAt = t + (pause ? 1.2 + Math.random() * 1.5 : 3 + Math.random() * 3);
          }
          target = wander;
          pace = 95;
        }
        const dx = target.x - dog.x, dy = target.y - dog.y;
        const dist = Math.hypot(dx, dy);
        const speed = dist > 12 ? Math.min(pace, dist * 2) : 0;
        const k = Math.min(1, dt * (bone ? 3 : 1.6));
        dog.vx += ((dist ? dx / dist : 0) * speed - dog.vx) * k;
        dog.vy += ((dist ? dy / dist : 0) * speed * 0.6 - dog.vy) * k;
        dog.x += dog.vx * dt;
        dog.y += dog.vy * dt;
        // Turn around only on a clear change of direction, so it never flickers.
        if (Math.abs(dog.vx) > 35 && Math.sign(dog.vx) !== dog.dir) dog.dir = Math.sign(dog.vx);
        const sc = depth(dog.y);
        const w = spriteW * sc, h = spriteH * sc;
        dog.x = Math.max(w / 2, Math.min(W - w / 2, dog.x));
        dog.y = Math.max(h + 8, Math.min(H - 6, dog.y));
        const moving = Math.hypot(dog.vx, dog.vy);
        // Stride cadence follows speed: an easy trot when strolling, a gallop when fetching.
        dog.frame += dt * (moving > 8 ? 3 + moving / 30 : 0);

        // Bones drop a little and land where you clicked.
        ctx.fillStyle = "#b8f5cf";
        for (const b of bones) {
          if (!b.landed) {
            b.vy += 1800 * dt;
            b.y += b.vy * dt;
            if (b.y >= b.land) { b.y = b.land; b.landed = true; }
          }
          ctx.font = `${cell * depth(b.y)}px "Departure Mono", monospace`;
          drawBone(b.x, b.y - cell * 2, cell * depth(b.y));
        }
        // Soft shadow under the paws.
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.18;
        ctx.font = `${cell * sc}px "Departure Mono", monospace`;
        for (let x = -w * 0.32; x <= w * 0.32; x += cell * sc * 1.5) ctx.fillText("·", dog.x + x, dog.y);
        ctx.globalAlpha = 1;
        drawDog(FRAMES[Math.floor(dog.frame) % FRAMES.length]!, dog.x - w / 2, dog.y - h, dog.dir < 0, t, cell * sc);

        const noseX = dog.x + dog.dir * w * 0.4;
        const eaten = bones.findIndex((b) => b.landed && Math.abs(b.x - noseX) < 50 * sc && Math.abs(b.y - dog.y) < 70 * sc);
        if (eaten >= 0) {
          const b = bones.splice(eaten, 1)[0]!;
          for (let i = 0; i < 14; i++) crumbs.push({ x: b.x, y: b.y - cell * 2, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 300, life: 0.8 });
          fed++;
          fedRef.current?.(fed);
        }
        ctx.fillStyle = "#b8f5cf";
        ctx.font = `${cell}px "Departure Mono", monospace`;
        for (const c of crumbs) {
          c.vy += 1400 * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.life -= dt;
          ctx.globalAlpha = Math.max(0, c.life);
          ctx.fillText("·", c.x, c.y);
        }
        ctx.globalAlpha = 1;
        for (let i = crumbs.length - 1; i >= 0; i--) if (crumbs[i]!.life <= 0) crumbs.splice(i, 1);
        ctx.fillStyle = ink;
      }
      if (!reduce) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onLeave = () => { pointer = null; };
    const onClick = (e: MouseEvent) => {
      if (mode !== "chase" || bones.length >= 4) return;
      const r = el.getBoundingClientRect();
      // Bones land where the pup can stand (its body needs room above its paws).
      const land = Math.max(H * 0.48, e.clientY - r.top);
      bones.push({ x: e.clientX - r.left, y: land - 70, land, vy: 0, landed: false });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("click", onClick);
    };
  }, [mode, ink, cell]);

  return (
    <canvas ref={canvas} className={`runner runner-${mode}`} role="img"
      aria-label={mode === "chase" ? "An ASCII pup strolling around. Click to drop a bone and it runs to eat it." : "An ASCII dog galloping (Muybridge, 1887)."} />
  );
}
