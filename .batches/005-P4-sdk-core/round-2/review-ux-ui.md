VERDICT: PASS

Scope: developer experience of packages/sdk (no pages, no screenshots). Fast mode: no HIGH/CRITICAL found. Diff bf648a6..3c131b4 read.

Round-1 follow-ups:
1. Snippet names: fixed. Step 1 now destructures `{ id, url }`. `order`, `saveSessionId`, `alreadyHandled`, `orderBySessionId`, `markPaid` are shop helpers, and the code comments imply it (see FOLLOW-UP 1).
2. Raw body: fixed. Comment names `request.text()` (Fetch) and `express.raw()` (Express). The mismatch message now says to check the secret and pass the raw body.
3. orderId -> reference: fixed (README bullet and JSDoc).
4. Only WebhookSignatureError maps to 400: fixed; others rethrow.
5. EUR guard says what to do ("price in USDT"). It checks `priced.currency`, which is a stronger proof than before.
6. Webhook secret source named: fixed (dashboard webhook settings).

New messages are clear and actionable: key characters ("copy it again"), https baseUrl (shows an example and the localhost exception), orderId (states the 1-40 rule and why), "That isn't a checkout session id.", toleranceSec ("finite number of seconds, 0 or more"). None include the key. The fetch error text now redacts the key.

FR-PAY-11: setup 1 + create 2 + webhook handler ~12 lines = about 15. Fits in 20.

## FOLLOW-UP (LOW)
1. README does not state in one line that `order`, `saveSessionId`, `alreadyHandled`, `orderBySessionId`, `markPaid` are the shop's own. Fix: add a comment "// saveSessionId, alreadyHandled, orderBySessionId, markPaid: your own code". Owner: claude-sdk.
2. A bad `toleranceSec` throws WebhookSignatureError, so the snippet answers 400 for a developer config bug. It shows up in dev, but the label is misleading. Fix: throw a plain Error (a 500) for config errors. Same for "No webhook secret configured". Owner: claude-sdk.
3. A 401 shows only the server's text. Fix: add the hint "check GATEWAY_SECRET_KEY and that baseUrl is the right environment". Owner: claude-sdk.
