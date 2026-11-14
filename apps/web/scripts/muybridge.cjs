// Turns the public-domain Muybridge "Dog Dread galloping" GIF into ASCII density frames.
// Source: https://commons.wikimedia.org/wiki/File:Dog_Dread_galloping_(rbm-QP301M8-1887-707a~animation_2to8).gif
// Usage (from the repo root, after downloading the GIF):
//   NODE_PATH=node_modules node apps/web/scripts/muybridge.cjs dread.gif apps/web/app/muybridge-dog.json 120
const sharp = require("sharp");
const [gif, out, colsArg] = process.argv.slice(2);
const COLS = Number(colsArg || 120);

(async () => {
  const meta = await sharp(gif).metadata();
  const frames = [];
  for (let p = 0; p < meta.pages; p++) {
    const img = sharp(gif, { page: p }).grayscale().extract({ left: 30, top: 0, width: 1375, height: 700 });
    const { data: raw, info } = await img.clone().raw().toBuffer({ resolveWithObject: true });
    const { data: blur } = await img.clone().blur(7).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    // Bright, blurred pixels are dog; thin grid lines vanish under the blur.
    const on = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) on[i] = blur[i] > 150 ? 1 : 0;
    // Keep the largest connected component (the dog).
    const label = new Int32Array(W * H).fill(-1);
    let best = -1, bestSize = 0, id = 0;
    const stack = [];
    for (let i = 0; i < W * H; i++) {
      if (!on[i] || label[i] !== -1) continue;
      let size = 0;
      stack.push(i);
      label[i] = id;
      while (stack.length) {
        const k = stack.pop();
        size++;
        const x = k % W, y = (k / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (on[n] && label[n] === -1) { label[n] = id; stack.push(n); }
        }
      }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    let minX = W, maxX = 0, minY = H, maxY = 0, cx = 0;
    for (let i = 0; i < W * H; i++) if (label[i] === best) {
      const x = i % W, y = (i / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; cx += x;
    }
    frames.push({ raw, label, best, W, H, minX, maxX, minY, maxY, cx: cx / bestSize });
  }
  // Common box: widest/tallest dog, aligned on each frame's centroid x and its feet (maxY).
  const boxW = Math.max(...frames.map((f) => f.maxX - f.minX)) + 40;
  const boxH = Math.max(...frames.map((f) => f.maxY - f.minY)) + 20;
  const cell = boxW / COLS;
  const ROWS = Math.ceil(boxH / cell);
  const result = frames.map((f) => {
    const x0 = f.cx - boxW / 2, y0 = f.maxY - boxH + 10;
    let s = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        let cover = 0, lum = 0, n = 0;
        for (let yy = 0; yy < cell; yy += 2) for (let xx = 0; xx < cell; xx += 2) {
          const x = Math.round(x0 + c * cell + xx), y = Math.round(y0 + r * cell + yy);
          n++;
          if (x < 0 || y < 0 || x >= f.W || y >= f.H) continue;
          const i = y * f.W + x;
          if (f.label[i] === f.best) { cover++; lum += f.raw[i]; }
        }
        if (cover / n < 0.25) { s += "0"; continue; }
        // Level 1-9: coverage at the edges, photo shading inside.
        const shade = lum / cover / 255;
        const level = Math.max(1, Math.min(9, Math.round((cover / n) * 4 + shade * 5)));
        s += String(level);
      }
    }
    return s;
  });
  require("fs").writeFileSync(out, JSON.stringify({
    source: "Eadweard Muybridge, Animal Locomotion (1887), plate 707: Dog Dread galloping. Public domain (Wikimedia Commons).",
    cols: COLS, rows: ROWS, frames: result,
  }));
  console.log("frames", result.length, "grid", COLS, "x", ROWS, "bytes", JSON.stringify(result).length);
  // Preview frame 0 in the terminal.
  const ramp = " .:/+x#X#@";
  for (let r = 0; r < ROWS; r += 2) console.log(result[0].slice(r * COLS, r * COLS + COLS).replace(/\d/g, (d) => ramp[+d]));
})();
