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

// Batch 046 (FR-PAY-16, FR-PRIV-1): "Pay with your wallet" through Privy. Only the pages that show the pay sheet may
// reach Privy's API and wallet iframe and the WalletConnect relay (Privy's CSP guide); every other strict page stays
// 'self' only. The pay pages still can't reach a chain RPC (no browser chain reads).
const PAY_SHEET = ["/checkout/:path*", "/pay/:path*", "/l/:path*", "/p/:path*"];
const STRICT = ["/r/:path*", "/counter/:path*", "/docs", "/merchant/developers"];
const directive = (csp, name) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

test("csp: the pay sheet's pages allow Privy's API, its wallet iframe and the WalletConnect relay, nothing else new", () => {
  for (const source of PAY_SHEET) {
    const csp = cspOf(rules[at(source)]);
    assert.ok(csp, `no CSP for ${source}`);
    assert.equal(
      directive(csp, "connect-src"),
      "connect-src 'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org https://explorer-api.walletconnect.com",
      source,
    );
    assert.equal(directive(csp, "frame-src"), "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org", source);
    assert.match(csp, /script-src 'self' 'unsafe-inline'(;| 'unsafe-eval';)/, `${source}: scripts stay 'self'`);
    assert.match(csp, /frame-ancestors 'none'/, source);
    assert.doesNotMatch(csp, /whitechain|ankr|rpc\.privy\.systems|walletlink|wss:(?!\/\/relay\.walletconnect)/, `${source}: no chain RPC host`);
  }
  assert.match(cspOf(rules[at("/p/:path*")]), /img-src 'self' data: https:/, "/p keeps the merchant's logo");
});

test("csp: the other strict pages stay 'self' only (no Privy, no WalletConnect)", () => {
  for (const source of STRICT) {
    const csp = cspOf(rules[at(source)]);
    assert.ok(csp, `no CSP for ${source}`);
    assert.equal(directive(csp, "connect-src"), "connect-src 'self'", source);
    assert.doesNotMatch(csp, /privy|walletconnect/, source);
  }
  for (const source of ["/merchant/:path*", "/capital/:path*"]) assert.doesNotMatch(cspOf(rules[at(source)]), /privy|walletconnect/, source);
});
