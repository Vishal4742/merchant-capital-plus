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

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Clickjacking guard before any page can move money (security review S4): no one may frame our pages.
  // The Anon-RPC worker's srcdoc iframe is unaffected (X-Frame-Options applies to fetched documents only).
  async headers() {
    const csp = [{ key: "Content-Security-Policy", value: PAY_PAGE_CSP }];
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
      { source: "/checkout/:path*", headers: csp },
      { source: "/pay/:path*", headers: csp },
      { source: "/r/:path*", headers: csp },
      // the dashboard sends invoices, approvals and refunds, and loads nothing from another origin (security review 005
      // F8); wallet extensions aren't bound by a page's CSP
      { source: "/merchant", headers: csp },
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
  },
};

export default nextConfig;
