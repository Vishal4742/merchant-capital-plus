// claude-frontend batch 040: the investor pages (/capital, /capital/holdings) send the dashboard's policy: scripts
// 'self', calls only to 'self' and the Anon-RPC hosts (FR-PRIV-1, FR-PRIV-4), no framing (NFR-8). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { default: config } = await import("../next.config.ts");
const rules = await config.headers();
const cspOf = (rule) => rule?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
const at = (source) => rules.findIndex((r) => r.source === source);

test("csp: /capital/:path* (which also matches /capital) sends exactly the merchant dashboard's policy", () => {
  const capital = cspOf(rules[at("/capital/:path*")]);
  assert.ok(capital, "no CSP rule for /capital/:path*");
  assert.equal(capital, cspOf(rules[at("/merchant/:path*")]));
  assert.match(capital, /frame-ancestors 'none'/);
  assert.match(capital, /connect-src 'self' blob: [^;]*https:\/\/validator\.nymtech\.net/);
});

test("csp: no later rule overrides /capital (for one header the last matching rule wins)", () => {
  const later = rules.slice(at("/capital/:path*") + 1).filter((r) => cspOf(r) && (r.source.startsWith("/capital") || r.source === "/(.*)"));
  assert.deepEqual(later.map((r) => r.source), []);
});
