// Draws icon.png (512×512 RGBA) for the bundle: a rounded navy tile with two white "flow" waves. Original artwork made
// by this script (batch 052), no external assets; deterministic, so re-running it writes the same bytes.
// Usage: node scripts/icon.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 512, RADIUS = 104, SS = 4; // 4×4 supersampling for smooth edges
const TOP = [11, 37, 69], BOTTOM = [19, 94, 140]; // navy → teal-blue
const WAVES = [
  { cy: 214, amp: 30, thick: 38 },
  { cy: 306, amp: 30, thick: 38 },
];
const X0 = 120, X1 = 392, WAVELENGTH = (X1 - X0) / 1.5; // 1.5 waves: each end sits on a crest or a trough (flat), so the caps are clean

const insideTile = (x, y) => {
  const cx = Math.min(Math.max(x, RADIUS), SIZE - RADIUS), cy = Math.min(Math.max(y, RADIUS), SIZE - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
};
const phase = (x) => (2 * Math.PI * (x - X0)) / WAVELENGTH - Math.PI / 2;
const waveY = (w, x) => w.cy + w.amp * Math.sin(phase(x));
function onWave(x, y) {
  for (const w of WAVES) {
    const half = w.thick / 2;
    if (x >= X0 && x <= X1) {
      const slope = ((w.amp * 2 * Math.PI) / WAVELENGTH) * Math.cos(phase(x));
      if (Math.abs(y - waveY(w, x)) / Math.sqrt(1 + slope * slope) <= half) return true;
    }
    for (const ex of [X0, X1]) if ((x - ex) ** 2 + (y - waveY(w, ex)) ** 2 <= half * half) return true; // round caps
  }
  return false;
}

const rows = [];
for (let py = 0; py < SIZE; py++) {
  const row = Buffer.alloc(1 + SIZE * 4); // filter byte 0 (None)
  for (let px = 0; px < SIZE; px++) {
    let tile = 0, white = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS, y = py + (sy + 0.5) / SS;
        if (!insideTile(x, y)) continue;
        tile++;
        if (onWave(x, y)) white++;
      }
    }
    const t = py / (SIZE - 1), n = SS * SS;
    const bg = TOP.map((c, i) => c + (BOTTOM[i] - c) * t);
    const mix = tile ? white / tile : 0;
    const rgb = bg.map((c) => Math.round(c + (255 - c) * mix));
    row.set([...rgb, Math.round((255 * tile) / n)], 1 + px * 4);
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
