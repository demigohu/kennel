"use client";

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
