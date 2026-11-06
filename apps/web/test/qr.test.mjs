// claude-frontend checks for FR-GW-3 (QR codes): lib/qr.ts and GET /qr/{kind}/{id}. The SVG is read back into a
// module grid and decoded by the small reader below (written from ISO/IEC 18004, independent of uqr), so a test fails
// if the code would not scan to our URL. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { qrSvg, qrTarget } from "../lib/qr.ts";
import { GET } from "../app/qr/[kind]/[id]/route.ts";

// ── a test-only QR reader: versions 1–6, byte mode, no error correction needed (the grid is exact) ──
/** The SVG's dark modules as a grid (uqr draws one `M x,y h…` square per dark module), without the quiet zone. */
function gridOf(svg) {
  const [, w] = svg.match(/viewBox="0 0 (\d+) \d+"/);
  const squares = [...svg.matchAll(/M(\d+),(\d+)h(\d+)/g)].map(([, x, y, s]) => [Number(x), Number(y), Number(s)]);
  const px = squares[0][2], n = Number(w) / px;
  const full = Array.from({ length: n }, () => Array(n).fill(false));
  for (const [x, y] of squares) full[y / px][x / px] = true;
  // trim the light border to the symbol (the top-left finder's corner is the first dark module)
  const border = full.findIndex((row) => row.some(Boolean));
  return full.slice(border, n - border).map((row) => row.slice(border, n - border));
}

const ALIGN = [null, null, 18, 22, 26, 30, 34]; // the one alignment centre for versions 2–6 (also its row)
// ISO 18004 table 9: error-correction blocks and EC codewords per block, versions 1–6, by level
const BLOCKS = { L: [1, 1, 1, 1, 1, 2], M: [1, 1, 1, 2, 2, 4], Q: [1, 1, 2, 2, 4, 4], H: [1, 1, 2, 4, 4, 4] };
const EC_PER_BLOCK = { L: [7, 10, 15, 20, 26, 18], M: [10, 16, 26, 18, 24, 16], Q: [13, 22, 18, 26, 18, 24], H: [17, 28, 22, 16, 22, 28] };
const LEVELS = ["M", "L", "H", "Q"]; // format bits 00, 01, 10, 11
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function decode(grid) {
  const size = grid.length, version = (size - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 6, `version ${version} is in the reader's range`);
  const at = (x, y) => grid[y][x];
  // format information, first copy around the top-left finder, checked with its BCH code
  const spots = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const raw = spots.reduce((bits, [x, y], i) => bits | (Number(at(x, y)) << i), 0);
  const data = (raw ^ 0x5412) >> 10;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(((data << 10) | (rem & 0x3ff)) ^ 0x5412, raw, "the format information checks out");
  const level = LEVELS[data >> 3], mask = MASKS[data & 7];
  // function modules: finders with separators and format areas, timing lines, the alignment pattern, the dark module
  const fn = (x, y) => {
    if ((x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8)) return true;
    if (x === 6 || y === 6) return true;
    const a = ALIGN[version];
    return a !== null && Math.abs(x - a) <= 2 && Math.abs(y - a) <= 2;
  };
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) {
      const y = upward ? size - 1 - v : v;
      for (const x of [right, right - 1]) if (!fn(x, y)) bits.push(at(x, y) !== mask(x, y));
    }
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((b, bit) => (b << 1) | Number(bit), 0));
  // de-interleave the data codewords (short blocks first, each long block one longer)
  const blocks = BLOCKS[level][version - 1], ec = EC_PER_BLOCK[level][version - 1], total = codewords.length;
  const shortLen = Math.floor(total / blocks) - ec, longs = total % blocks;
  const lens = Array.from({ length: blocks }, (_, b) => shortLen + (b >= blocks - longs ? 1 : 0));
  const perBlock = lens.map(() => []);
  let k = 0;
  for (let i = 0; i <= shortLen; i++) lens.forEach((len, b) => i < len && perBlock[b].push(codewords[k++]));
  const stream = perBlock.flat().flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  const read = (from, n) => stream.slice(from, from + n).reduce((v, bit) => (v << 1) | bit, 0);
  assert.equal(read(0, 4), 0b0100, "byte mode");
  const count = read(4, 8);
  return new TextDecoder().decode(Uint8Array.from({ length: count }, (_, i) => read(12 + 8 * i, 8)));
}

test("each QR scans back to the exact page URL", () => {
  for (const url of [
    "http://127.0.0.1:3111/l/AbCdEfGhIj",
    "https://merchant-capital-plus.vercel.app/p/Zx9Yw8Vu7T",
    "https://merchant-capital-plus.vercel.app/pay/1234567890",
  ]) {
    assert.equal(decode(gridOf(qrSvg(url))), url);
  }
});

test("the SVG is only squares: no text, script, link or style that a page could carry", () => {
  const svg = qrSvg("https://shop.example/l/AbCdEfGhIj");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+">/);
  assert.doesNotMatch(svg, /<(script|text|a|style|foreignObject|image)\b|on\w+=|href/i);
  assert.doesNotMatch(svg, /shop\.example/, "the URL is in the modules, not in the markup");
});

test("QR codes are made only for our links, pages and invoices", () => {
  assert.equal(qrTarget("l", "AbCdEfGhIj"), "/l/AbCdEfGhIj");
  assert.equal(qrTarget("p", "Zx9Yw8Vu7T"), "/p/Zx9Yw8Vu7T");
  assert.equal(qrTarget("pay", "12"), "/pay/12");
  for (const [kind, id] of [["l", "a/b"], ["l", "../merchant"], ["l", ""], ["l", "x".repeat(65)], ["pay", "0"], ["pay", "12a"], ["checkout", "abc"], ["https:", "evil.example"], ["__proto__", "x"]]) {
    assert.equal(qrTarget(kind, id), null, `${kind}/${id}`);
  }
});

// as `next start` hands it over: request.url names the server's own host, the Host header the one the merchant used
const call = (path, kind, id, headers = { host: "127.0.0.1:3111" }) => GET(new Request(`http://localhost:3111${path}`, { headers }), { params: Promise.resolve({ kind, id }) });

test("GET /qr/{kind}/{id} answers the SVG for this server's own URL", async () => {
  const res = await call("/qr/l/AbCdEfGhIj", "l", "AbCdEfGhIj");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(res.headers.get("content-disposition"), null);
  assert.equal(decode(gridOf(await res.text())), "http://127.0.0.1:3111/l/AbCdEfGhIj");
  const download = await call("/qr/pay/12?download=1", "pay", "12");
  assert.equal(download.headers.get("content-disposition"), 'attachment; filename="qr-pay-12.svg"');
  assert.equal((await call("/qr/x/y", "x", "y")).status, 404);
  assert.equal((await call("/qr/l/..", "l", "..")).status, 404);
  const behindProxy = await call("/qr/p/Zx9Yw8Vu7T", "p", "Zx9Yw8Vu7T", { host: "shop.example", "x-forwarded-proto": "https" });
  assert.equal(decode(gridOf(await behindProxy.text())), "https://shop.example/p/Zx9Yw8Vu7T", "the host and scheme the merchant reached");
});
