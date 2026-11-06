VERDICT: PASS

# Code review: 007-P4-sdk-button, round 2 (fast mode §3a, last round)

Scope: `git diff 3e48d40..1c5c294` (button.js and its copy, index.ts, README, both test files, spec.md), plus round-1/review-code.md, the "Round 2" section of build-claude-sdk.md, and round-2/test.md. `wc -c button.js` gives 2248. `cmp` against apps/web/public/v1/button.js says identical.

One targeted probe, in real headless Chrome (Google Chrome.app, `--headless=new`). A stub gateway on :4711 served the real button.js, and an "evil" origin on :4712 logged every request. Probe files are in scratchpad `r2probe/server.mjs`.
- **The page held:**
  - `<img name=Document>`, `<div id=Object>`, `<img name=HTMLScriptElement>`, `<img name=URL>`, `<form name=console>`, `<div id=location|window|document>`;
  - two `<img name=currentScript src=evil>` (so `document.currentScript` is an HTMLCollection);
  - `<div id=__mcPayButton>`;
  - the real `<script src=gw/v1/button.js data-session=sess-P>`, then `.click()` on the inserted button.
- **Result:**
  - The page reported `cs=[object HTMLCollection]|Doc=function|Obj=function|HSE=function|docIsDoc=true|flag=true|button=true`.
  - The gateway log shows `gw /checkout/sess-P`, and the final DOM title is `landed gw /checkout/sess-P`.
  - The evil origin saw only the five image fetches and never a `/checkout`.

## H1: closed
- **packages/sdk/button.js:6-7.** `Object.getOwnPropertyDescriptor(Document.prototype, "currentScript").get.call(document)` bypasses `Document`'s `[LegacyOverrideBuiltIns]` named properties. `instanceof HTMLScriptElement` refuses an `<img>`, an HTMLCollection and an SVG `<script>`.
- **Can the globals be clobbered?** No.
  - `Document`, `HTMLScriptElement`, `Object` and `URL` are own properties of the global object. Window named access lives on the WindowProperties object further down the prototype chain, so it can't shadow them.
  - `document`, `window` and `location` are `[LegacyUnforgeable]` own properties.
  - The probe above confirms all of this in Chrome.
  - Every other failure mode is fail-closed. If any of these names ever resolved to an element, line 6 or 7 would throw, leaving no listener and no button, and so no redirect. Plain HTML can't produce a real `HTMLScriptElement` with an attacker's `src` as the executing script.
- **Can the getter throw?**
  - Only where `currentScript` isn't an accessor on `Document.prototype`:
    - IE, which has no `currentScript` at all;
    - Chrome < 43 and Safari < 10, where DOM attributes were still own properties of instances.
  - It's fail-closed there too: a TypeError, no button, no listener. Those browsers can't run the wallet checkout anyway.
  - Modern Gecko and WebKit declare it on `Document` (the HTML spec's partial interface Document), so it's on `Document.prototype`. Safari wasn't run (see FOLLOW-UP).
- **button.js:20.** `window.__mcPayButton !== true`: a clobbered flag (element or collection) is never `=== true`. The assignment then creates an own property that shadows the named one. The probe shows `flag=true`, one listener, and the button working.
- **button.js:23.** `!event.defaultPrevented` comes first, so a shop handler on the element or its ancestors, React's root listener, or a document listener registered earlier cancels the redirect. The tester's Page C covers this.
- **Tests discriminate:** each new case fails against the round-1 code.
  - The clobber test (test/button.test.ts:104) would navigate to evil.test.
  - The flag test (:122) would install 0 listeners.
  - The preventDefault test (:128) would navigate.

## H2: closed (SDK side)
- **packages/sdk/index.ts:82-89.** `sameAmount` parses both sides to base units with BigInt, with no float.
  - "1,000.00" = "1000.00" = "1000", and "0.10" = "0.1".
  - It rejects "", "abc", "1e3", "-1", more than 6 decimals, `undefined` and `null` (via `String()`, then no regex match). Two invalid inputs never compare equal (`x !== null`).
  - `\d` without the `u` flag is ASCII-only.
- README:49 and :60 use it. The test at sdk.test.ts:75 asserts the H2 case and the junk cases.
- The root cause (the routes' `formatUsdt`) belongs to claude-frontend's `plainUsdt` (agreed 03:44-03:45, per build-claude-sdk.md). `sameAmount` is correct before and after that change.

## Round-1 LOWs: checked
- **Currency-mismatch scrub (index.ts:174):** done. The test at sdk.test.ts:89 puts the key in `id` and asserts it's absent from the message.
- **Bare `?`/`#` baseUrl (index.ts:157):** done. Rebuilding from `origin + pathname` drops them and keeps the prefix. The test at sdk.test.ts:80 covers `?`, `#` and a trailing `/`. Userinfo, query and hash are still refused at :153.
- **pk_ text (index.ts:146):** done.
- **README placement (:19):** done. It says `<body>`, and the React path is at :17.
- **One gateway per page (:19):** done.
- **The 1-64 limit (:18):** done. The USD 1:1 line (:73) is now verified by the live EUR/USD run in build-claude-sdk.md.
- **No-globals criterion:** now asserted (button.test.ts:170).
- **Fake DOM:** see below.

## Fake DOM fidelity (test/button.test.ts:13-66)
- **Faithful where it matters:**
  - The real `currentScript` comes from a getter on a per-page `Document.prototype`.
  - Clobbering is modelled as an own data property on the `document` instance. That is what `[LegacyOverrideBuiltIns]` exposes in Chrome: `getOwnPropertyDescriptor(document, "currentScript")` returns the named element.
  - Script elements get `HTMLScriptElement.prototype`, so `instanceof` behaves as in a page.
  - `page()` creates a fresh `Document` class each time, so the prototype override at :116 can't leak between tests.
- **Gaps, none hiding a bug:**
  - The clobbered flag is an own property of `ctx`, while a browser puts it on WindowProperties. The outcome is the same for `!== true` and for the assignment.
  - Because `Document` and `HTMLScriptElement` are plain `ctx` keys, the fake can't show that the globals themselves resist clobbering. The Chrome probe above covers that.
  - `insertAdjacentElement` still has no parent, and `<head>` placement isn't modelled. README:19 covers that.

## OPEN (HIGH/CRITICAL)
None.

## FOLLOW-UP (MEDIUM / LOW, the lane's next batch; owner claude-sdk unless noted)
- **MEDIUM, index.ts:84, sameAmount is lenient in the crediting direction.**
  - **What:** `replaceAll(",", "")` strips every comma before parsing. "1,00" equals "100". Worse, a shop that stored its own European-formatted "1.000,00" gets "1.00000" = 1 USDT, so a 1 USDT payment credits a 1000 order.
  - **When it bites:** only when a shop ignores README:37 (store `session.amount`), because both gateway-produced strings are safe.
  - **Fix (one regex):** accept commas only as thousands groups, `/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,6}))?$/` on the trimmed string, then strip commas from `m[1]`. Add `["1,00","100"]` and `["1.000,00","1"]` to the not-equal list in sdk.test.ts:78.
- **LOW, ARCHITECTURE.md:130, owner claude-research.** `sameAmount` is a new public export that §2 doesn't list. It's additive, and no other lane calls it yet; `apps/shop` will in batch 3. Ask claude-research to add it to the SDK line, and to note it in spec.md's README follow-up, which still says "equals".
- **LOW, README.md:22.** "A click handler of yours that calls `preventDefault()` cancels the redirect" overstates it.
  - A `document` or `window` listener added *after* button.js runs after ours, so it can't cancel. The tester's Page C note says the same.
  - An ancestor's `stopPropagation()`, React's included, stops the redirect completely.
  - Suggested wording: "A handler on the element or one of its parents (React `onClick` included) that calls `event.preventDefault()` cancels the redirect; `stopPropagation()` also stops it."
- **LOW, README.md:55.** The polling comment says "amount matches what you stored". Say `sameAmount(session.amount, order.amount)` there too, so nobody writes `===` in the poll path.
- **LOW, carried from round 1 (README.md:16 and :74).** `/l/<slug>` and `GET /api/v1/payments` depend on the gateway's batch 007. Re-check both on main before AT-14.
- **LOW, Safari not exercised.** Before AT-14, open any page in Safari (installed on this Mac) and run `typeof Object.getOwnPropertyDescriptor(Document.prototype, "currentScript").get` in the console. Expect `"function"`. If it isn't, the button is dead in Safari, though still fail-closed.

## Scope and ABI
- Every change traces to the round-1 findings, which in turn trace to FR-GW-4 and FR-GW-5/7 in spec.md. spec.md records the 2.5 KB cap and the H1 criteria.
- There's no new behaviour beyond the fixes, apart from `sameAmount`. It's the H2 fix, and it's listed under FOLLOW-UP for the §2 update.
- Button attributes and SDK method names still match ARCHITECTURE.md:130.
- Ponytail: nothing to delete. The 222 added bytes in button.js are the guard, the comment that keeps it in place, and the `defaultPrevented` check.

## NEEDS THE USER
None.
