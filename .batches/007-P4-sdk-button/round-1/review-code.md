VERDICT: CHANGES

# Code review: 007-P4-sdk-button, round 1 (fast mode §3a)

Scope: `git diff c81b330..3e48d40` (button.js and its byte-identical copy, index.ts follow-ups, README, tests) plus spec.md, build-claude-sdk.md and round-1/test.md. One targeted probe: real headless Chrome on a static page, saved at scratchpad `clobber/page.html`.

## OPEN (HIGH)

### H1. A scriptless HTML injection redirects the shop's real pay button to another site (DOM clobbering of `document.currentScript`)
- **Where:** packages/sdk/button.js:5-7 (and apps/web/public/v1/button.js, the copy). Owner: **claude-sdk**.
- **What:** `Document` named properties override built-ins, so `<img name="currentScript" src="https://evil.test/x.png">` anywhere above the script tag makes `document.currentScript` return that `<img>`. `script.src` is then the attacker's URL, and `origin` becomes `https://evil.test`. The delegated listener is installed with that origin, so every genuine `data-mc-session` / `data-mc-link` element on the page navigates there. This is the same gadget as webpack CVE-2024-43788, Vite CVE-2024-45812 and Rollup CVE-2024-47068.
- **Proof (real Chrome, real button.js):** the page held the `<img name=currentScript>`, a shop button `<button data-mc-session="abc123">`, the real script, and `.click()`. The page title recorded:
  `currentScript=IMG | guard=true | navigate=https://evil.test/checkout/abc123 cancelable=true`
- **Why HIGH:**
  - The spec promises "A page can't point the button at another site." This breaks that promise in a payment flow.
  - A payer lands on a clone checkout and signs a USDT authorization to the attacker.
  - It only needs HTML injection with no script (product reviews, a markdown renderer that keeps `name`).
  - Yes, an attacker with HTML injection could also post a fake link. This is worse: it hijacks the shop's own trusted buttons, silently, on every page that carries the injected HTML.
- **Fix (one guard):** `if (!script || script.tagName !== "SCRIPT" || !script.src) return;`
  - An `<img>`, or an HTMLCollection when two names collide, has no `tagName` of `SCRIPT`. `<script>` elements never take part in document named access.
  - The guard adds about 29 bytes, which puts the file at about 2055, over the 2048 cap that test/button.test.ts:130 enforces. Trim the header comment at lines 1-3 (the README already says the same thing).
  - Copy the file to apps/web/public/v1/ again.
- **Test:** in test/button.test.ts, give the fake `el()` a `tagName: tag.toUpperCase()`. Add a case where `document.currentScript = el("img", { src: "https://evil.test/x" })`. Then assert no listener, no inserted button and no navigation.
- **Same pass, LOW, 8 bytes:** `<img id="__mcPayButton">` clobbers the guard, so the listener is never installed and every button goes dead. Use `if (window.__mcPayButton !== true)` at button.js:19.

### H2. The README's "credit only when the amount matches" never credits a paid order of 1,000 USDT or more
- **Where:**
  - packages/sdk/README.md:32-33 and :45 (`event.data.amount === order.amount`);
  - the root cause: apps/web/app/api/v1/sessions/route.ts:48 and apps/web/app/api/v1/sessions/[id]/route.ts:22 return `formatUsdt(...)`, which is display formatting via `toLocaleString("en-US")`: "1,000.00". This is the same on `sdk`, `backend` and origin/main.
- **Owner:** the sessions routes' owner, **claude-frontend** (with claude-contracts, who owns events.ts). **claude-sdk** raises it on agentbus and fixes the README if the route can't change this round.
- **What:**
  - `sessions.create` returns `amount: "1,000.00"`, and README step 1 tells the shop to store it.
  - The webhook body is built in ~/ethglobal-backend/apps/web/lib/server/events.ts:13,21 with `plain()`, which is `formatUsdt(...).replaceAll(",", "")`, so it sends "1000.00".
  - The strict string compare in README step 2 fails for every amount from 1,000.00 to the 10,000 USDT cap. The customer has paid on-chain, but the shop never marks the order paid.
  - Any shop that does `Number(session.amount)` also gets `NaN` once the amount has a separator.
  - A third format is in play too: ~/ethglobal-backend/.batches/007-P4-gateway-api/API.md:3 says API amounts are "unpadded: '25', '24.9'", while the code pads to two decimals.
- **Fix:** fix the root cause once, where every caller goes through. The two session routes return the same machine format as the webhook. Move `plain` into apps/web/lib/usdt.ts and use it at route.ts:48 and [id]/route.ts:22. Correct API.md:3 to match. The SDK and the README then need no change. If the routes can't change in this round, claude-sdk changes README:45 to compare `event.data.amount.replaceAll(",", "") === order.amount.replaceAll(",", "")`, with a `ponytail:` note pointing at the route fix.

## FOLLOW-UP (MEDIUM / LOW; the lane's next batch)
- **MEDIUM, button.js:19-29, claude-sdk.** With two gateways on one page (for example staging plus prod), the first script's listener and origin handle every button, so the second gateway's buttons open the first gateway (a 404, no money moves). Ladder: one README line, "load button.js from one gateway per page". Skip the per-origin listeners.
- **MEDIUM, README.md:12-17, claude-sdk.** A script-tag-mode tag inside `<head>` puts the button inside `<head>`, where it's invisible. React 19 hoists `<script async>` into head, and Next's `<Script>` appends to the end of `<body>`. README: "put the tag in `<body>` where the button should appear; in React/Next load it with `<Script src>` and no `data-session`, then use `data-mc-session`".
- **LOW, button.js:21-27, claude-sdk.**
  - Calling `preventDefault()` in a shop's own handler (a terms checkbox, say) can't cancel the redirect. Add `if (!el || event.defaultPrevented) return;`.
  - Note in the README that an ancestor calling `stopPropagation()` (a React `onClick` too, since React 17 listens on the root) stops the document-level listener.
- **LOW, button.js:6, claude-sdk.** Under `type="module"`, or when the file is bundled into the shop's JS, `currentScript` is null or the shop's own bundle, and the button silently does nothing. An optional `console.error` would help. package.json `exports` is index.ts only, so it can't be imported by accident. Fine as is.
- **LOW, index.ts:135, claude-sdk.** "Use pk_ keys only in the pay button." is now false, because the button takes no key and `data-key` is ignored. Change it to "The pay button needs no key."
- **LOW, index.ts:162 vs README.md:65, claude-sdk.** The currency-mismatch error embeds the server's `session.id` without passing it through `#scrub`, yet the README says the key is "always" replaced. Wrap it in `this.#scrub(...)` (the arrow function can reach the private method) or soften "always".
- **LOW, index.ts:138-145, claude-sdk.** A lone `?` or `#` (`https://gw.test/prefix?`) passes, because the `search` and `hash` getters return "". The join then drops `/prefix`. Fix: build `#base` from `base.origin + base.pathname` (plus a trailing `/`).
- **LOW, README.md:18, claude-sdk.** The "Bad input" line leaves out the 1-64 length limit.
- **LOW, README.md:16 and :70, claude-sdk.**
  - `/l/<slug>` isn't on origin/main yet. API.md:21 confirms the path and says it comes with the backend batch 007.
  - The removed caveat on `payments.list` was the only hint that `GET /api/v1/payments` isn't on main either.
  - Re-check both before AT-14, or say "with the gateway's batch 007".
- **LOW, README.md:69, claude-sdk.** "USD is 1:1 and still comes back as a quote" isn't in the spec. API.md:14 has a USD rate of "1", but whether `POST /api/v1/sessions` returns `priced` for USD is claude-frontend's sessions v2. Verify it or drop the line.
- **LOW, test/button.test.ts:13-57, claude-sdk. Fake-DOM fidelity:**
  - `currentScript` is injected by hand, so the clobbered, null and module cases never run (see H1);
  - `insertAdjacentElement` has no parent, so a script in `<head>` or a detached script isn't modelled;
  - there is no `tagName`;
  - every click target is an element.
  The real-Chrome walk in round-1/test.md covers the main paths. Nothing found passes in the fake DOM and then fails in Chrome, apart from H1. The criterion "no globals except one guard flag" isn't asserted: compare `Object.keys(ctx)` before and after `load`.

## DONE (checked, no finding)
- **currentScript under async/defer:** the HTML spec sets `currentScript` for every classic script, async and defer included. It is read synchronously at the top of the IIFE (button.js:5), so this is fine. Next `<Script>` (afterInteractive, lazyOnload) injects a classic `<script>`, `data-*` passes through `setAttribute`, and `currentScript` is set.
- **`closest` on targets that aren't elements:** the guard `event.target && event.target.closest &&` (button.js:22) safely ignores Text-node and `document` targets.
- **`insertAdjacentElement("afterend")`:** supported in every current browser, and a no-op on a script with no parent.
- **Guard order** (button.js:19-21): the flag is set and the listener is added in the same synchronous block, so loading twice gives one listener (test :119-127).
- **ID regex** (button.js:8): anchored, ASCII `\w`, no `g` flag, so repeated `.test` calls carry no `lastIndex` state. `javascript:`, `../`, `?` and 65 characters are refused (test :107-117). The origin can't become `javascript:`, because `new URL("javascript:…").origin` is "null", which gives a same-site relative path.
- **Label:** set through `textContent`, never `innerHTML`. The inline style is set through the CSSOM `style.cssText`, which a strict `style-src` doesn't block.
- **index.ts:**
  - `#scrub` is in `#call` on both error paths (:199, :210); `replaceAll` replaces literally, and the key is non-empty printable ASCII;
  - the `baseUrl` userinfo, query and hash checks are right (:141);
  - `typeof orderId` now refuses `null` and `42` before any request (:155);
  - config errors are plain `Error`s, and the tests assert they are not `WebhookSignatureError` (sdk.test.ts configError);
  - the 401 hint matches the spec text exactly.
- **ABI:** ARCHITECTURE.md:130 (`data-session` / `data-link`, the SDK method names) matches. No ABI change.
- **Copy:** `cmp` shows the two files identical, and test :132 enforces it. A copy is the right call over a symlink, because Vercel's apps/web root can't follow a link out of the project. `public/` doesn't exist on main, so there's no merge conflict. The `/(.*)` headers (nosniff) don't affect a `.js` served with a JS MIME type.
- **Ponytail:** nothing to delete. `destination()` is shared by script-tag mode and clicks, and there's no MutationObserver and no dependency. Scope matches the spec, apart from the README line flagged above.

## NEEDS THE USER
none.
