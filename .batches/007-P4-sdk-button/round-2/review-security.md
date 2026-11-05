VERDICT: PASS

# Security review: 007-P4-sdk-button, round 2 (fast mode §3a, last round)

Diff `3e48d40..1c5c294`: button.js (both copies), index.ts, README, the tests and the spec. `cmp` says the two button.js files are identical (2,248 bytes). `npm test` at 1c5c294: tests 47, pass 47, fail 0. `npx tsc --noEmit`: exit 0.

I tested in real Chrome 156 (headless, DevTools HTTP API) with three local origins: shop :4711, gateway :4712 serving the real button.js, attacker :4713. Each page puts the clobbering markup in a "reviews" section above the script tag. Then the shop's own code records what `document.currentScript`, `Document`, `HTMLScriptElement`, `Object`, `URL` and the guard flag look like, and clicks either the script-tag button or the shop's own `data-mc-session` button. The stub, the driver and the logs are in my scratchpad (`secprobe2/`), not in the repo. All servers and Chrome were stopped afterwards.

**Process note:** my round-1 stub (pid 3308, ports 4500-4502) was still running. That is what held 4501/4502 when the tester started. I stopped it this round.

## OPEN (blocks)
None.

## Round-1 findings: status

### HIGH-1 (`currentScript` clobbering): closed
- **Fix:** packages/sdk/button.js:6-7 reads the prototype getter and requires `instanceof HTMLScriptElement`.
- **Chrome results:** in every shape below, `document.currentScript` was confirmed clobbered from page script, and both the script-tag button and the shop's button landed on the gateway. The attacker origin got no `/checkout` request.

| Markup in the reviews section | What `document.currentScript` was | New file: both clicks | Old file (3e48d40): shop click |
|---|---|---|---|
| none (baseline) | `null` (after load) | gateway | gateway |
| `<img name=currentScript src=evil>` | HTMLImageElement | gateway | **EVIL /checkout/shop-img** |
| `<img id=currentScript name=x>` | HTMLImageElement | gateway | **EVIL /checkout/shop-imgid** |
| `<embed name=currentScript src=evil>` | HTMLEmbedElement | gateway | **EVIL /checkout/shop-embed** |
| `<form name=currentScript>` with `<input name=src>` and `<img name=getAttribute>` | HTMLFormElement | gateway | no navigation |
| `<object name=currentScript>` / `<object id=currentScript>` | HTMLObjectElement | gateway | no navigation |
| `<iframe name=currentScript src=evil>` | cross-origin WindowProxy (reading it throws SecurityError) | gateway | no navigation |
| img + embed with the same name | HTMLCollection | gateway | no navigation |
| Window shapes: `<img name=Document>`, `<a id=HTMLScriptElement>`, `<img name=Object>`, `<a id=URL>`, `<form name=console>`, `<a id=location>`, `<iframe name=window>`, two `<a id=__mcPayButton>`, plus the img | HTMLImageElement; `Document`, `HTMLScriptElement`, `Object`, `URL` all stayed `function` | gateway | no navigation (guard clobbered) |
| Getter-chain shapes: `<img name=getOwnPropertyDescriptor>`, `<a id=call>`, `<a id=get>`, `<img name=prototype>`, plus the img | HTMLImageElement | gateway | n/a |
| All of the above together | HTMLCollection | gateway | n/a |

- **Why the window shapes can't work:** named elements live on `WindowProperties`, below the global's own properties in the prototype chain. `Document`, `HTMLScriptElement`, `Object` and `URL` are own properties of the global, and `document` and `location` are unforgeable, so HTML can't shadow them. `Object.getOwnPropertyDescriptor`, `.get` and `.call` hang off built-ins, not off `window` or `document`. Only page JavaScript could replace them, and page JavaScript can navigate the customer anyway.
- **Unit tests:** button.test.ts:104-122 models the override as an own property on `document`, and a non-script `currentScript` installs no listener. Both match what the browser does.
- **Not tested:** I only ran Chrome. Firefox and Safari also define `currentScript` as an accessor on `Document.prototype`, so the same getter applies. If one of them lacked it, the script would throw and render nothing, which fails closed.

### LOW-1 (guard flag): closed
- **Fix:** button.js:20 now checks `window.__mcPayButton !== true`.
- **Chrome:** two `<a id=__mcPayButton>` make the flag an HTMLCollection. The new file still installs the listener, the flag becomes an own `true`, and both clicks reach the gateway. The old file installed nothing.
- **Residual:** `Object.prototype.__mcPayButton = true` set by another library's prototype-pollution bug still leaves the buttons dead. That fails closed and needs a JavaScript bug elsewhere. No action.

### LOW-2 (currency error not scrubbed): closed
- **Fix:** index.ts:174 passes the whole message through `#scrub`.
- **Test:** sdk.test.ts covers it: a session id containing the key comes back with `[secret key]` in its place.

### LOW-3 (bare `?` / `#` in baseUrl): closed
- **Fix:** index.ts:157 rebuilds the base from `origin + pathname`.
- **Checked in Node:** every request stayed on `h.test` for these baseUrl values:
  - `/gw?`, `/gw#` and `/gw?#` (all three keep the `/gw/` prefix);
  - `//evil.test/`, `/a@evil.test`, `/%2F%2Fevil.test`, `/..//evil.test` and `h.test\\evil.test`.
  - In each case `evil.test` ends up in the path, never in the host.

### MEDIUM-1 (user content can draw a working pay button): enough for the hackathon
- **What changed:**
  - README.md:21 tells shops to strip `data-mc-*` from user content.
  - The hosted checkout shows the merchant's name as its title (Checkout.tsx:183, "to {merchantName}" at :133).
- **Remaining exposure:** the injected button can only open the real gateway's `/checkout/<regex-checked id>`. The customer then sees the attacker's merchant name, and the shop never credits the order.
- **Same power from a link:** an injected `<a href>` to the gateway can do the same thing anyway.
- One wording refinement is listed under FOLLOW-UP.

## New code: redirects and amounts
- **`!event.defaultPrevented` (button.js:23):** only page JavaScript can set it, through `preventDefault()` or a `return false` handler, and HTML-only content can't. All it can do is cancel the redirect, so it can't choose a destination.
- **Destination:** unchanged. It is still `origin + "/checkout/" | "/l/" + /^[\w-]{1,64}$/`, built from closure-local values that page content can't reach.
- **User-content `<form data-mc-session=ATTACKER>`** with `<input name=getAttribute>` / `<input name=closest>`:
  - a click on it throws inside the listener ("Script error." in Chrome) and nothing navigates;
  - the shop's own buttons keep working, because each click is its own event.
- **Amount:** the button still never reads `data-amount`, `data-currency` or `data-key` and never builds a query string.

## sameAmount: can a crafted string credit an underpaid order?
Node probe (secprobe2/amount.ts):
- **Treated as the same money, correctly:**
  - `"001000"` and `" 1000"` equal `"1000"`, as do a trailing `\n`, NBSP or BOM (`trim()` removes them) and `"1000.000000"`.
- **Refused (false):**
  - fullwidth digits (`１０００`), Arabic-Indic (`١٠٠٠`) and Devanagari (`१०००`), because JS `\d` is ASCII-only;
  - `+1000`, `1_000`, `0x3e8`, `1e3`, `1000.`, `.5`, negatives and 7 decimals;
  - `null`/`null` and `undefined`/`undefined`, because the `x !== null` check makes two unparseable values unequal.
- **Pairs one unit apart are unequal:** `1000.00` vs `999.999999` and `1000.00` vs `1000.000001` both return false.
- **The weak spot is the comma strip (LOW-4 below):**
  - `"1,0,0,0"` = `"1000"`;
  - `"10,00"` = `"1000"` and `"1,5"` = `"15"` (a decimal comma read 100× or 10× too high);
  - `"1.000,00"` = `"1"` and `"1.5,5"` = `"1.55"`;
  - `",1000,"` = `"1000"`;
  - `["1000"]` = `"1000"`, through `String()`.
- **Why it isn't HIGH:**
  - In the README flow both sides are the gateway's `plainUsdt` output: the stored `amount` is the one `sessions.create` returned, and the webhook amount is HMAC-signed. The gateway never emits commas (sessions/route.ts:121, sessions/[id]/route.ts:34, payments/route.ts:8).
  - The order is first bound by its stored session id.
  - The gateway's `parseUsdt` refuses a comma amount at creation (sessions/route.ts:65), so a customer-typed `"10,00"` can't become a session.
  - The underpay path needs a shop that stores decimal-comma strings and also creates the session with an amount other than the order's.

## FOLLOW-UP (MEDIUM/LOW, next batch)

### LOW-4: `sameAmount` deletes every comma, so decimal-comma strings compare equal to amounts 10-100× larger
- **Where:** packages/sdk/index.ts:84, `String(s).replaceAll(",", "")`.
- **Exploit sketch:**
  - A shop stores its order total in display format, `"10,00"` (10 in decimal-comma format).
  - A bug elsewhere creates the session for `"1000"`, or for `"10"` with the order stored as `"1.000,00"`.
  - `sameAmount` returns true, so the README's safety check passes for the wrong amount. In the second case an order worth 1,000 is credited for 10 USDT.
  - This needs two shop mistakes, and both sides are plain decimals in the documented flow, so the severity is LOW.
- **Fix (pick one):**
  - **Smallest:** drop the comma strip and require `typeof s === "string"`. Every gateway amount is already `plainUsdt`, and the README stores the returned `amount`.
  - **If display strings must match:** accept commas only as integer-part group separators, e.g. `^\d{1,3}(,\d{3})+(\.\d{1,6})?$|^\d+(\.\d{1,6})?$`. Add `,\d{2}` groups if Indian lakh grouping is wanted. Anything else returns false.
  - Either way, add `"10,00" ≠ "1000"`, `"1.000,00" ≠ "1"`, `"1,5" ≠ "15"` and `"1,0,0,0" ≠ "1000"` to sdk.test.ts:78.
- **Owner:** claude-sdk.

### MEDIUM-1 residual: name a sanitizer setting, not just "strip data-mc-*"
- **Where:** packages/sdk/README.md:21.
- **Problem:** DOMPurify's `FORBID_ATTR` takes exact names, not a `data-mc-*` wildcard. A shop that follows the line literally may end up stripping nothing.
- **Fix:** add the concrete config, for example DOMPurify `{ FORBID_ATTR: ["data-mc-session", "data-mc-link"] }` or `{ ALLOW_DATA_ATTR: false }`.
- **Owner:** claude-sdk.

### Note (not security): the listener order for `preventDefault`
The tester found that a shop handler cancels the redirect only if it runs before ours. A `document` listener added after button.js runs too late. README.md:22 could say "on the element, or on `document` before the script loads". Owner: claude-sdk.

## Not in this diff
Contracts, the relayer, Arkiv, PII, trackers and the webhook HMAC logic are unchanged since round 1.

## Secrets grep
I ran `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the 18 files in `git diff --name-only 3e48d40..1c5c294`.
- **Hits:**
  - env var names only: `GATEWAY_SECRET_KEY` and `GATEWAY_WEBHOOK_SECRET` (README.md:32/43/70, index.ts:221, spec.md:49, build-claude-sdk.md:41, round-1/test.md:16, round-1/review-security.md:101-104);
  - the made-up test constant `SECRET = "whsec-test-0123456789abcdef"` (sdk.test.ts:8) and its uses (:211-255).
- **No 64-hex strings.** No real keys.
- The test `KEY` is made up too (`"test-shop-key-0123456789abcdef"`, sdk.test.ts:7).
