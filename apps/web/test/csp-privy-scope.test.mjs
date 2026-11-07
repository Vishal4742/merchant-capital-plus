// Batch 050 (SRS FR-BIZ-6 v3.1, NFR-8 scope): Privy may load only where it is disclosed — the business sign-in page and
// the opt-in payer sheet main already ships (/checkout, /pay; FR-PAY-17). Every other route that sets a CSP, including the
// whole dashboard, must not allow Privy's origins. Reads the real next.config.ts header rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { default: config } = await import("../next.config.ts");
const rules = await config.headers();
const csp = (rule) => rule.headers.find((h) => h.key === "Content-Security-Policy")?.value;

// P5 Privy onboarding (commit 507ee09) deliberately also allows Privy on the merchant and capital pages; receipts, links,
// the developers page (shows secrets once) and docs keep the strict policy.
test("Privy is allowed only on /sign-in, the pay sheet, /merchant, /merchant/pages and /capital; receipts, links, developers and docs stay strict", () => {
  const withCsp = rules.filter((r) => csp(r));
  const privy = withCsp.filter((r) => /auth\.privy\.io/.test(csp(r))).map((r) => r.source).sort();
  assert.deepEqual(privy, ["/capital/:path*", "/checkout/:path*", "/merchant/:path*", "/merchant/pages", "/pay/:path*", "/sign-in"]);
  for (const source of ["/merchant/developers", "/r/:path*", "/l/:path*", "/p/:path*", "/docs"]) {
    const rule = withCsp.find((r) => r.source === source);
    assert.ok(rule, `${source} keeps its own CSP`);
    assert.doesNotMatch(csp(rule), /privy/, `${source} must not allow Privy`);
  }
});

test("the sign-in page's CSP keeps scripts on our own origin and frames only Privy and WalletConnect verify", () => {
  const policy = csp(rules.find((r) => r.source === "/sign-in"));
  assert.match(policy, /script-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(policy, /script-src[^;]*https:/, "no third-party scripts");
  assert.match(policy, /frame-src https:\/\/auth\.privy\.io https:\/\/verify\.walletconnect\.com https:\/\/verify\.walletconnect\.org/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test("business sign-in config: email or wallet, chain 1874 only, embedded wallets off (never created for a business)", () => {
  const src = readFileSync(new URL("../components/workspace/PrivySignIn.tsx", import.meta.url), "utf8");
  assert.match(src, /loginMethods: \["email", "wallet"\]/);
  assert.match(src, /createOnLogin: "off"/);
  assert.doesNotMatch(src, /users-without-wallets|createWallet\(/);
  assert.match(src, /supportedChains: \[whitechainTestnet\]/);
});

test("Privy is imported only by the sign-in component and the payer sheet, never by dashboard code", () => {
  const dashboard = readFileSync(new URL("../components/workspace/WorkspaceSettings.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(dashboard, /@privy-io/);
  const settings = readFileSync(new URL("../app/merchant/settings/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(settings, /@privy-io|PrivySignIn/);
});
