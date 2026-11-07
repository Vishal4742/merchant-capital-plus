// Draws icon.png (512×512 RGBA) for the bundle: the WhiteFlow "W" in lavender on a rounded brand-blue tile, the same
// artwork as apps/web/app/icon.svg (the mark is traced from the brand construction drawing). No external assets;
// deterministic, so re-running it writes the same bytes.
// Usage: node scripts/icon.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 512, RADIUS = 112, SS = 4; // 4×4 supersampling for smooth edges
const TILE = [0x41, 0x2f, 0xf0], MARK = [0xd0, 0xcd, 0xfb];
// The mark's three pieces (rounded tips flattened), in the 208.61 × 100 units of components/WhiteFlowMark.tsx.
const PIECES = [
  [[0.00, 0.00], [59.82, 0.00], [75.41, 53.56], [49.02, 94.29], [48.51, 95.02], [47.94, 95.72], [47.33, 96.37], [46.68, 96.97], [45.98, 97.53], [45.24, 98.04], [44.48, 98.49], [43.67, 98.89], [42.85, 99.23], [42.00, 99.51], [41.13, 99.73], [40.25, 99.88], [39.37, 99.97], [38.47, 100.00], [37.58, 99.97], [36.69, 99.87], [35.81, 99.71], [34.95, 99.49], [34.10, 99.20], [33.28, 98.86], [32.48, 98.45], [31.71, 98.00], [30.98, 97.48], [30.29, 96.92], [29.63, 96.31], [29.03, 95.66], [28.47, 94.96], [27.96, 94.22], [27.51, 93.45], [27.11, 92.65], [26.77, 91.83], [26.49, 90.98]],
  [[99.56, 5.76], [100.08, 5.02], [100.64, 4.32], [101.26, 3.66], [101.92, 3.05], [102.63, 2.49], [103.37, 1.98], [104.15, 1.52], [104.95, 1.12], [105.79, 0.78], [106.64, 0.49], [107.52, 0.27], [108.40, 0.12], [109.30, 0.02], [110.20, -0.01], [111.10, 0.03], [112.00, 0.13], [112.88, 0.29], [113.76, 0.52], [114.61, 0.80], [115.44, 1.15], [116.25, 1.56], [117.02, 2.02], [117.76, 2.54], [118.46, 3.10], [119.12, 3.72], [119.73, 4.38], [120.29, 5.08], [120.81, 5.83], [121.26, 6.60], [121.67, 7.41], [122.01, 8.24], [122.29, 9.10], [148.76, 100.00], [88.94, 100.00], [73.30, 46.29]],
  [[148.48, 0.00], [208.60, 0.00], [182.16, 90.81], [181.87, 91.67], [181.53, 92.51], [181.12, 93.33], [180.66, 94.11], [180.14, 94.86], [179.57, 95.57], [178.95, 96.24], [178.29, 96.86], [177.58, 97.43], [176.84, 97.95], [176.06, 98.42], [175.24, 98.82], [174.40, 99.17], [173.54, 99.46], [172.66, 99.69], [171.77, 99.86], [170.86, 99.96], [169.95, 99.99], [169.04, 99.96], [168.14, 99.87], [167.24, 99.71], [166.36, 99.49], [165.50, 99.20], [164.66, 98.86], [163.84, 98.45], [163.06, 97.99], [162.31, 97.48], [161.60, 96.91], [160.93, 96.29], [160.31, 95.63], [159.73, 94.92], [159.21, 94.18], [132.89, 53.56]]
];
const SCALE = (SIZE * 0.7) / 208.61, OX = (SIZE - 208.61 * SCALE) / 2, OY = (SIZE - 100 * SCALE) / 2;

const insideTile = (x, y) => {
  const cx = Math.min(Math.max(x, RADIUS), SIZE - RADIUS), cy = Math.min(Math.max(y, RADIUS), SIZE - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
};
const inPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const onMark = (x, y) => PIECES.some((p) => inPoly(p, (x - OX) / SCALE, (y - OY) / SCALE));

const rows = [];
for (let py = 0; py < SIZE; py++) {
  const row = Buffer.alloc(1 + SIZE * 4); // filter byte 0 (None)
  for (let px = 0; px < SIZE; px++) {
    let tile = 0, mark = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS, y = py + (sy + 0.5) / SS;
        if (!insideTile(x, y)) continue;
        tile++;
        if (onMark(x, y)) mark++;
      }
    }
    const mix = tile ? mark / tile : 0;
    const rgb = TILE.map((c, i) => Math.round(c + (MARK[i] - c) * mix));
    row.set([...rgb, Math.round((255 * tile) / (SS * SS))], 1 + px * 4);
  }
  rows.push(row);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(new URL("../icon.png", import.meta.url), png);
process.stdout.write(`wrote icon.png (${png.length} bytes)\n`);
