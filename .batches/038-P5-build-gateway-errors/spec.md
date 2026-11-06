# Spec: 038-P5-build-gateway-errors

## Requirements (cite docs/SRS.md IDs)
- NFR-11 (quality gate): `next build` passes with no error lines; today it logs "gateway api error: Error" once per
  static-path GET route (14 on main) because handle() swallows Next's prerender-interrupt error.
- FR-GW-5, FR-GW-6, FR-GW-9 (the gateway API the SDK, keys and reports call): every route keeps its behaviour at request
  time: HttpError → its status, DbUnavailable → 503, anything else → a 500 that names no internals, logged by name only.

## Acceptance criteria (each must be checkable)
- [ ] handle() rethrows Next's framework errors (unstable_rethrow, called first in the catch), so Next ends the
      prerender itself; every other error is answered as before.
- [ ] test/http-handle.test.mjs: a Next framework error (redirect's NEXT_REDIRECT digest) propagates out of handle()
      and is not logged; HttpError, DbUnavailable and a plain Error keep their status and body.
- [ ] `next build` output has 0 "gateway api error" lines; the route table still marks every /api/v1 route ƒ.
- [ ] tsc, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/lib/server/http.ts (handle only), apps/web/test/http-handle.test.mjs (new)

## Ponytail ladder (why this is the smallest change that works)
- Needed: yes (build noise hides real errors; a 500 body is built for every prerender).
- Platform feature: Next's own unstable_rethrow (documented for exactly this: try/catch around request-time APIs);
  one line in the one shared wrapper, so all 17 GET routes are fixed at once, no per-route `connection()` calls.

## Out of scope
- Every claimed path in the request above; pages' own readFailure (they log nothing at build).
