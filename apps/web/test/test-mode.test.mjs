// claude-frontend checks for FR-GW-14: test mode everywhere, and no path to a mainnet chain in the app's source.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const sources = ["app", "components", "lib"].flatMap((dir) =>
  readdirSync(join(ROOT, dir), { recursive: true })
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => ({ file: `${dir}/${file}`, text: readFileSync(join(ROOT, dir, file), "utf8") })),
);

test("no source names Whitechain mainnet (chain id 1875 or viem's `whitechain`)", () => {
  assert.ok(sources.length > 20, "the scan sees the app");
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /\b1875\b/, file);
    for (const [, names] of text.matchAll(/import\s*{([^}]*)}\s*from\s*["']viem\/chains["']/g)) {
      assert.doesNotMatch(names, /\bwhitechain\b/, `${file} imports Whitechain mainnet`);
    }
  }
});

test("every chain id and chain the app signs or reads with is Whitechain Sepolia (1874)", () => {
  // the one exception: lib/anon.ts reads Nym's specifier contract on Ethereum mainnet to find its worker
  // (a disclosed read, FR-PRIV-4); no money moves there
  // WHITECHAIN_TESTNET.chainId: the network the onboarding asks a wallet to add, pinned to toHex(whitechainSepolia.id)
  // by test/onboarding.test.mjs
  const allowed = new Set(["whitechainSepolia", "whitechainSepolia.id", "SIGN_IN_CHAIN_ID", "1874", "WHITECHAIN_TESTNET.chainId"]);
  for (const { file, text } of sources) {
    for (const [, value] of text.matchAll(/[{,]\s*\bchain(?:Id)?:\s*([\w.]+)/g)) {
      if (file === "lib/anon.ts" && value === "mainnet") continue;
      assert.ok(allowed.has(value), `${file}: chain ${value}`);
    }
  }
  assert.match(readFileSync(join(ROOT, "lib/auth.ts"), "utf8"), /SIGN_IN_CHAIN_ID = 1874;/);
});

test("the badge reads \"Test mode · Whitechain testnet\" and has an accessible name", () => {
  const badge = readFileSync(join(ROOT, "components/TestModeBadge.tsx"), "utf8");
  assert.match(badge.replace(/<[^>]+>/g, ""), /Test mode · Whitechain testnet/);
  assert.match(badge, /role="note" aria-label="Test mode, Whitechain testnet/);
});

test("the root layout renders the badge above every page, and no page or the Shell repeats it", () => {
  const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
  assert.match(layout, /<body[^>]*>\s*<TestModeBadge \/>\s*\{children\}/);
  const repeats = sources.filter(({ file, text }) => file !== "app/layout.tsx" && file !== "components/TestModeBadge.tsx" && /<TestModeBadge\b/.test(text));
  assert.deepEqual(repeats.map(({ file }) => file), []);
});
