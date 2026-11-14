"use client";
import { useEffect, useRef } from "react";

const GLYPHS = " .:+×#■";

/** Sitting dog silhouette, drawn with canvas primitives in a 200x140 box. */
function drawDog(ctx: CanvasRenderingContext2D, tailWag: number) {
  ctx.fillStyle = "#fff";
  const ellipse = (x: number, y: number, rx: number, ry: number, rot = 0) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
  };
  ellipse(92, 88, 46, 30, -0.15); // body
  ellipse(128, 70, 22, 26, 0.5); // chest
  ellipse(150, 44, 20, 18); // head
  ellipse(170, 50, 14, 8, 0.2); // snout
  ellipse(136, 46, 8, 17, 0.35); // floppy ear hanging down the side of the head
  ellipse(178, 52, 6, 5); // nose tip
  ctx.fillRect(120, 90, 10, 40); // front legs
  ctx.fillRect(134, 92, 10, 38);
  ellipse(66, 108, 26, 20); // haunch
  ctx.fillRect(50, 112, 34, 18); // back paw
  ctx.lineWidth = 7; // tail
  ctx.lineCap = "round";
  ctx.strokeStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(52, 82);
  ctx.quadraticCurveTo(30, 70 - tailWag * 10, 26 + tailWag * 6, 44 - tailWag * 8);
  ctx.stroke();
}

/**
 * The landing hero: an ASCII pup sampled from the silhouette onto a glyph grid.
 * Click to "feed" it: a glyph ripple runs from the click point and the tail wags.
 */
export function AsciiPup({ color = "#60CE8B", cols = 72, onFeed }: { color?: string; cols?: number; onFeed?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ ripples: [] as { x: number; y: number; t: number }[], wag: 0, start: 0 });

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rows = Math.round(cols * 0.52);
    const off = document.createElement("canvas");
    off.width = 200;
    off.height = 140;
    const octx = off.getContext("2d", { willReadFrequently: true })!;
    let raf = 0;
    const start = performance.now();
    state.current.start = start;

    const render = (now: number) => {
      const t = (now - start) / 1000;
      const s = state.current;
      s.wag = Math.max(0, s.wag - 0.02);
      octx.clearRect(0, 0, 200, 140);
      drawDog(octx, reduce ? 0 : Math.sin(t * 14) * s.wag);
      const data = octx.getImageData(0, 0, 200, 140).data;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const cell = w / cols;
      el.width = w * dpr;
      el.height = rows * cell * 1.15 * dpr;
      ctx.scale(dpr, dpr);
      ctx.font = `${cell * 1.05}px "Departure Mono", monospace`;
      ctx.textBaseline = "top";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Coverage of this cell in the silhouette.
          const x0 = Math.floor((c / cols) * 200), y0 = Math.floor((r / rows) * 140);
          let cover = 0;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) cover += data[((y0 + dy) * 200 + x0 + dx) * 4 + 3]! > 0 ? 1 : 0;
          if (!cover) continue;
          let level = cover === 4 ? 5 : cover + 1;
          // Shimmer: interior glyphs flicker slightly.
          if (!reduce && level === 5 && Math.sin(c * 12.9 + r * 78.2 + t * 2) > 0.92) level = 4;
          let alpha = 0.35 + level * 0.13;
          for (const p of s.ripples) {
            const d = Math.hypot(c - p.x, (r - p.y) * 1.8) - (t - p.t) * 40;
            if (Math.abs(d) < 2.5) {
              level = 6;
              alpha = 1;
            }
          }
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.fillStyle = color;
          ctx.fillText(GLYPHS[level]!, c * cell, r * cell * 1.15);
        }
      }
      s.ripples = s.ripples.filter((p) => t - p.t < 2.5);
      if (!reduce) raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [color, cols]);

  const feed = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = canvas.current!;
    const rect = el.getBoundingClientRect();
    const cell = rect.width / cols;
    state.current.ripples.push({
      x: (e.clientX - rect.left) / cell,
      y: (e.clientY - rect.top) / (cell * 1.15),
      t: (performance.now() - state.current.start) / 1000,
    });
    state.current.wag = 1;
    onFeed?.();
  };

  return <canvas ref={canvas} className="ascii-pup" onClick={feed} aria-label="ASCII pup. Click to feed it." role="img" />;
}

function hash(id: string) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Dot-matrix identicon (5x5 mirrored) from an id. Pups (sub-accounts of a handler)
 * get two ear dots on the top row so they read as dogs.
 */
export function DotAvatar({ id, size = 32, color = "#60CE8B" }: { id: string; size?: number; color?: string }) {
  let h = hash(id);
  const isPup = id.split(".").length > 2;
  const cells: boolean[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      cells[r * 5 + c] = cells[r * 5 + (4 - c)] = (h & 1) === 1;
      h = (h >>> 1) || hash(id + r + c);
    }
  }
  if (isPup) {
    cells[0] = cells[4] = true;
    cells[1] = cells[2] = cells[3] = false;
  }
  const dot = size / 5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="dot-avatar" aria-label={id} role="img">
      <rect width={size} height={size} fill="#161616" />
      {cells.map((on, i) => on && (
        <rect key={i} x={(i % 5) * dot + dot * 0.15} y={Math.floor(i / 5) * dot + dot * 0.15} width={dot * 0.7} height={dot * 0.7} fill={color} />
      ))}
    </svg>
  );
}
