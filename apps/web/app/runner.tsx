"use client";
import { useEffect, useRef } from "react";
import DOG from "./muybridge-dog.json";

// Muybridge's galloping dog (Animal Locomotion, 1887, public domain), pre-converted to ASCII density
// frames by scratch tooling (see DESIGN.md). Two uses: a pup that chases the pointer and the bones you
// drop (hero), and a big dog galloping in place whose glyphs scatter around the pointer (footer).

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
    const dog = { x: 0, dir: 1, speed: 0, frame: 0 };
    const bones: { x: number; y: number; vy: number; landed: boolean }[] = [];
    const crumbs: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    let wanderTo = 0, wanderAt = 0, last = performance.now();
    let fed = 0;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = el.clientWidth;
      H = el.clientHeight;
      el.width = W * dpr;
      el.height = H * dpr;
      if (!dog.x) dog.x = W * 0.5;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const spriteW = COLS * cell, spriteH = ROWS * cell;
    const ground = () => (mode === "chase" ? H * 0.78 : H);

    const drawDog = (frame: string, ox: number, oy: number, flip: boolean, t: number) => {
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

    const drawBone = (x: number, y: number) => {
      BONE.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] !== " ") ctx.fillText("■", x + (c - 3) * cell, y + (r - 2) * cell);
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
        drawDog(frameFor(t, 11), (W - spriteW) / 2, H - spriteH, false, t);
      } else {
        // Target: first bone on the ground, else the pointer, else a wander point.
        const g = ground();
        const bone = bones.find((b) => b.landed);
        let target = dog.x;
        if (bone) target = bone.x;
        else if (pointer) target = pointer.x;
        else {
          if (t > wanderAt) {
            wanderTo = spriteW / 2 + Math.random() * Math.max(1, W - spriteW);
            wanderAt = t + 3 + Math.random() * 3;
          }
          target = wanderTo;
        }
        const dx = target - dog.x;
        if (Math.abs(dx) > 30) dog.dir = Math.sign(dx);
        const want = Math.abs(dx) > 40 ? Math.min(520, Math.abs(dx) * 3) : 0;
        dog.speed += (want - dog.speed) * Math.min(1, dt * 4);
        dog.x += dog.dir * dog.speed * dt;
        dog.x = Math.max(spriteW / 2, Math.min(W - spriteW / 2, dog.x));
        // Gallop cadence follows speed; a resting pup holds a stride.
        dog.frame += dt * (dog.speed > 20 ? 6 + dog.speed / 40 : 0);
        const frame = FRAMES[Math.floor(dog.frame) % FRAMES.length]!;
        drawDog(frame, dog.x - spriteW / 2, g - spriteH, dog.dir < 0, t);

        // Bones fall to the ground; the pup eats the one under its nose.
        ctx.fillStyle = "#b8f5cf";
        for (const b of bones) {
          if (!b.landed) {
            b.vy += 1800 * dt;
            b.y += b.vy * dt;
            if (b.y >= g - cell) { b.y = g - cell; b.landed = true; }
          }
          drawBone(b.x, b.y);
        }
        const nose = dog.x + dog.dir * spriteW * 0.38;
        const eaten = bones.findIndex((b) => b.landed && Math.abs(b.x - nose) < 40);
        if (eaten >= 0) {
          const b = bones.splice(eaten, 1)[0]!;
          for (let i = 0; i < 14; i++) crumbs.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 380, life: 0.8 });
          fed++;
          fedRef.current?.(fed);
        }
        for (const c of crumbs) {
          c.vy += 1400 * dt;
          c.x += c.vx * dt;
          c.y = Math.min(g, c.y + c.vy * dt);
          c.life -= dt;
          ctx.globalAlpha = Math.max(0, c.life);
          ctx.fillText("·", c.x, c.y);
        }
        ctx.globalAlpha = 1;
        for (let i = crumbs.length - 1; i >= 0; i--) if (crumbs[i]!.life <= 0) crumbs.splice(i, 1);
        ctx.fillStyle = ink;
        // Ground line
        ctx.globalAlpha = 0.25;
        for (let x = 0; x < W; x += cell * 2) ctx.fillText("·", x, g + 2);
        ctx.globalAlpha = 1;
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
      bones.push({ x: e.clientX - r.left, y: Math.min(e.clientY - r.top, ground() - cell), vy: 0, landed: false });
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
      aria-label={mode === "chase" ? "An ASCII pup galloping after your pointer. Click to drop a bone." : "An ASCII dog galloping (Muybridge, 1887)."} />
  );
}
