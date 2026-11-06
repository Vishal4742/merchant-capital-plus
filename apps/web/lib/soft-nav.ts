// Dashboard screens that send the byte-identical CSP (next.config.ts "/merchant/:path*"): a client navigation between two
// of them keeps exactly the policy a full load would send, so it is safe (security review 005 F-N4) and skips the reload,
// the re-hydration and the Anon-RPC reboot on every click (NFR-13). Pages, API keys and Docs send other policies and
// stay full loads both ways. test/dashboard-soft-nav.test.mjs fails if next.config.ts changes one of these.
export const SOFT_NAV_SCREENS = [
  "/merchant",
  "/merchant/payments",
  "/merchant/links",
  "/merchant/vouchers",
  "/merchant/reports",
  "/merchant/settlements",
  "/merchant/capital",
] as const;

const screens: ReadonlySet<string> = new Set(SOFT_NAV_SCREENS);
const path = (href: string) => href.split(/[?#]/)[0];

/** True when going from `from` to `to` may be a client navigation: both screens send the same policy. */
export const softNav = (from: string, to: string): boolean => screens.has(path(from)) && screens.has(path(to));
