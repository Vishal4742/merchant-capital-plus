import type { NextConfig } from "next";

// The pay pages load nothing from another origin: no trackers, no Nym, no CDN. A third-party script there could
// swap the opaque nonce the customer signs (claude-contracts S6 c), so only our own scripts may run or call out.
// 'unsafe-inline' scripts: Next's streaming bootstrap is inline (a nonce would force dynamic rendering and lose the
// static shell, NFR-12). Dev needs 'unsafe-eval' for React's refresh runtime.
const PAY_PAGE_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// "Pay with your wallet" through Privy (batch 046), only where the pay sheet shows: Privy's API and its wallet iframe,
// and the WalletConnect relay, verify iframe and wallet list for phone wallets (docs.privy.io, CSP guide). Scripts stay
// 'self'. No chain RPC host: the pay pages make no browser chain reads (FR-PRIV-1), so Privy can't make one either.
const withPrivy = (policy: string) =>
  policy.replace(
    "connect-src 'self'",
    "connect-src 'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org https://explorer-api.walletconnect.com",
  ) + "; frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Clickjacking guard before any page can move money (security review S4): no one may frame our pages.
  // The Anon-RPC worker's srcdoc iframe is unaffected (X-Frame-Options applies to fetched documents only).
  async headers() {
    const csp = [{ key: "Content-Security-Policy", value: PAY_PAGE_CSP }];
    // a payment page shows the merchant's logo from its own https URL (human 06:30): images only, scripts and calls stay 'self'
    const logoCsp = [{ key: "Content-Security-Policy", value: PAY_PAGE_CSP.replace("img-src 'self' data:", "img-src 'self' data: https:") }];
    // only the pages that render the pay sheet; /l and /p post to /checkout and never show it (security 046 L1)
    const paySheetCsp = [{ key: "Content-Security-Policy", value: withPrivy(PAY_PAGE_CSP) }];
    const merchantPolicy =
      PAY_PAGE_CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:").replace(
        "connect-src 'self'",
        "connect-src 'self' blob: https://ethereum-rpc.publicnode.com https://cdn.jsdelivr.net https://unpkg.com https://raw.githubusercontent.com https://validator.nymtech.net wss:",
      ) + "; worker-src blob:";
    const merchantCsp = [{ key: "Content-Security-Policy", value: merchantPolicy }];
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // ponytail: CSP only where nothing third-party loads; home and /proofs need Nym's CDNs and gateways
      { source: "/checkout/:path*", headers: paySheetCsp },
      { source: "/pay/:path*", headers: paySheetCsp },
      { source: "/r/:path*", headers: csp },
      { source: "/l/:path*", headers: csp },
      { source: "/counter/:path*", headers: csp },
      // the dashboard sends invoices, approvals and refunds; its scripts stay 'self' (security review 005 F8). Its chain
      // reads go through Anon-RPC (FR-PRIV-1), so it may call the Nym bootstrap, bundle CDNs, directory and gateways
      // (FR-PRIV-4) and run the hash-pinned worker (blob: + WebAssembly) in the harness's sandboxed iframe, which
      // inherits this policy. Wallet extensions aren't bound by a page's CSP.
      { source: "/merchant/:path*", headers: merchantCsp }, // `:path*` also matches /merchant itself
      // the investor pages fund offers from the investor's wallet and read claims through Anon-RPC too (batch 040)
      { source: "/capital/:path*", headers: merchantCsp },
      // after the rules above: for the same header the last match wins (Next docs, headers)
      { source: "/p/:path*", headers: logoCsp },
      { source: "/merchant/pages", headers: [{ key: "Content-Security-Policy", value: merchantPolicy.replace("img-src 'self' data:", "img-src 'self' data: https:") }] },
      // the page that shows a new API key or webhook secret once keeps the strict policy: no outside host to send it to if
      // a script were ever injected (security review 018 F1); it shows no private-reads meter
      { source: "/merchant/developers", headers: csp },
      // /docs loads nothing third-party either, and hosts "Simulate a payment" (security review 006 F3)
      { source: "/docs", headers: csp },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    // Privy imports Solana and Stripe packages for features we don't turn on; their versions clash (lib/privy-unused.cjs)
    resolveAlias: Object.fromEntries(
      ["@solana/kit", "@solana-program/system", "@solana-program/token", "@solana-program/memo", "@stripe/crypto", "@stripe/stripe-js"].map((name) => [name, "./lib/privy-unused.cjs"]),
    ),
  },
};

export default nextConfig;
