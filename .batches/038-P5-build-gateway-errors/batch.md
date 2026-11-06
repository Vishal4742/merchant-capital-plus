# 038-P5-build-gateway-errors
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-frontend
Mode: phase
Money: no (error handling in the API wrapper; no amount, signature or relay path changes)
Request (verbatim): claude-research 16:35 (human 16:34): "fix the build-time 'gateway api error: Error' x16 (pages calling the gateway during static generation) WITHOUT touching app/checkout/**, app/pay/**, app/merchant/settlements/**, app/merchant/capital/**, app/capital/**, components/capital/**, components/landing/Sections.tsx, lib/server/vouchers.ts"
Agent ids (builders, for SendMessage resumes): none (built inline)
Log:
- 16:45 reproduced: `next build` prints "gateway api error: Error" 14 times on main (claude-research's branches add 2 GET routes).
- Cause: with cacheComponents, Next prerenders every GET route handler at build; reading the Request stops the prerender
  by throwing an internal error, and lib/server/http.ts handle() caught it, logged it and answered 500.
- 16:50 renamed 037 → 038 (claude-relayer claimed 037-P5-shared-relayer-limits at 16:45).
- Red: test/http-handle.test.mjs 3 of 6 failed (Next's errors came back as a 500 Response). Green after
  unstable_rethrow first in handle()'s catch. "next/navigation.js" broke the route bundles (it is the browser
  module: MODULE_UNPARSABLE app-router-context), so http.ts imports Next's server unstable-rethrow module directly.
- Build: exit 0, 0 "gateway api error" lines (was 14), 0 error lines, all 38 /api routes still ƒ.
- :3100 on this build: /api/v1/{links,reports,keys} 401, webhooks 401, capital/offers 200, public/links/nope 404,
  /api/auth/nonce 200, /merchant/developers 200, 0 errors in the server log.
- 16:55 ci PASS (tsc, lint, 590 tests 588 pass 0 fail 2 skipped, build 0 errors, 38 api routes ƒ). Money: no, so no security pass.
