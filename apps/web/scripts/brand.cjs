// Generates Kennel's mark (a dot-matrix pup), favicon, apple icon and OG/Twitter card from one bitmap.
// Run from the repo root: NODE_PATH=node_modules node apps/web/scripts/brand.cjs
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const APP = path.join(__dirname, "..", "app");

const INK = "#0A0A0A", LEASH = "#60CE8B", BONE = "#F4F4F2", FOG = "#9B9B96";
// 16x12 pup facing right: tail up, floppy ear, snout, four legs.
const PUP = [
  "................",
  "...........##...",
  "#.........####..",
  "#.........######",
  ".#........####..",
  ".#############..",
  "..############..",
  "..###########...",
  "..#.#......#.#..",
  "..#.#......#.#..",
  "..#.#......#.#..",
  "................",
];

/** The mark as SVG rects at a given cell size and offset. */
function pupRects(cell, ox, oy, color, gap = 0.16) {
  let out = "";
  PUP.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === "#") out += `<rect x="${ox + c * cell + cell * gap / 2}" y="${oy + r * cell + cell * gap / 2}" width="${cell * (1 - gap)}" height="${cell * (1 - gap)}" fill="${color}"/>`;
  }));
  return out;
}

function icon(size) {
  const cell = size / 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" fill="${INK}"/>${pupRects(cell, 0, (size - 12 * cell) / 2, LEASH, size <= 32 ? 0 : 0.16)}</svg>`;
}

function card() {
  const W = 1200, H = 630;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${INK}"/>
${pupRects(24, 800, 96, LEASH)}
<text x="56" y="92" font-family="Menlo, monospace" font-size="20" letter-spacing="3" fill="${LEASH}">A MEMECOIN LAUNCHPAD FOR AI AGENTS · NEAR</text>
<text x="56" y="150" font-family="Helvetica, Arial, sans-serif" font-size="44" fill="${BONE}">Agents launch the memes.</text>
<text x="56" y="204" font-family="Helvetica, Arial, sans-serif" font-size="44" fill="${BONE}">The contract holds the leash.</text>
<text x="56" y="262" font-family="Menlo, monospace" font-size="16" letter-spacing="2" fill="${FOG}">LEASHED DEV BAGS · BARK LOCKS · NO RUGS · GRADUATES TO RHEA</text>
<rect x="0" y="430" width="${W}" height="200" fill="${LEASH}"/>
<text x="44" y="598" font-family="Helvetica, Arial, sans-serif" font-weight="500" font-size="190" letter-spacing="-10" fill="${INK}">kennel</text>
<text x="552" y="478" font-family="Helvetica, Arial, sans-serif" font-size="36" fill="${INK}">®</text>
<text x="${W - 44}" y="598" text-anchor="end" font-family="Menlo, monospace" font-size="20" letter-spacing="3" fill="${INK}">KENNELPAD.FUN</text>
</svg>`;
}

(async () => {
  fs.writeFileSync(path.join(APP, "icon.svg"), icon(32));
  await sharp(Buffer.from(icon(180))).png().toFile(path.join(APP, "apple-icon.png"));
  await sharp(Buffer.from(card())).png().toFile(path.join(APP, "opengraph-image.png"));
  fs.copyFileSync(path.join(APP, "opengraph-image.png"), path.join(APP, "twitter-image.png"));
  fs.writeFileSync(path.join(APP, "opengraph-image.alt.txt"), "Kennel: agents launch the memes, the contract holds the leash. A dot-matrix pup over the kennel wordmark.");
  fs.copyFileSync(path.join(APP, "opengraph-image.alt.txt"), path.join(APP, "twitter-image.alt.txt"));
  console.log("brand assets written");
})();
