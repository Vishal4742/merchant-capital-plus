VERDICT: PASS

Scope: developer experience of packages/sdk (no pages, no screenshots). Fast mode: no HIGH/CRITICAL found.
Checked: every name in the README snippet exists in index.ts with the used signature (Gateway, sessions.create -> {url}, sessions.retrieve, constructEvent, SIGNATURE_HEADER, event.data.reference). Only `id` and `markPaid` are undefined in the snippet.

Line count (FR-PAY-11): setup 1 + create 1 + redirect 1 + webhook handler ~9 = about 12 lines. Fits in 20.
Key leakage: none. The key is a private field and is used only in the Authorization header. No message, including the fetch failure, includes it.

## FOLLOW-UP (MEDIUM)
1. README step 2 uses `gateway.sessions.retrieve(id)` but `id` is never defined. The snippet fails with a ReferenceError if pasted. Fix: step 1 becomes `const { id, url } = await ...`, or step 2 uses `session.id`. Say that `markPaid` is yours. Owner: claude-sdk.
2. The raw-body warning is a single code comment. Frameworks that parse JSON first (Express `express.json()`, Fastify, Next pages router) break the signature, and the error says only "doesn't match". Fix: add a short README bullet: "Use `request.text()` (Next/Fetch), `express.raw({type:'application/json'})` (Express). Never `JSON.stringify(req.body)`." Optionally extend the mismatch message with "(was the body re-serialized?)". Owner: claude-sdk.
3. `orderId` becomes `reference` on the session, payment and event, and the README shows neither side of the mapping. Fix: add a README line "`orderId` you send comes back as `reference`", and use the same value in the snippet (it already does: `order-42` in, `event.data.reference` out). Naming is acceptable if documented. Owner: claude-sdk.

## FOLLOW-UP (LOW)
4. The README snippet's `catch` returns 400 for any error, including `markPaid` throwing or a JSON parse failure. A 400 invites a gateway retry, which is probably fine, but the label "bad signature" is wrong. Fix: catch only `WebhookSignatureError` (import it) and let other errors 500. Owner: claude-sdk.
5. The EUR-guard message ("doesn't price in EUR yet; checkout X was created in USDT. Don't send the customer to it.") says what not to do but not what to do. Fix: append "Retry with currency USDT, or use a gateway with FX quotes." It also throws `GatewayError(200, ...)`; a status of 200 on an error is odd, but it's documented in the spec. Owner: claude-sdk.
6. A 401 or 400 shows only the server's text. Fix: on 401 add a hint "check GATEWAY_SECRET_KEY (sk_) and that baseUrl is the right environment". Owner: claude-sdk.
7. `amount: number` is sent as `String(n)`, so `0.1+0.2` becomes "0.30000000000000004" and the server rejects it with a 400. Fix: type-doc "prefer a string" (done in the JSDoc) and README says `"25.00"`, which is already true. Optional: `toFixed(6)` trimming, or throw on non-finite or more than 6 decimals. Owner: claude-sdk.
8. README doesn't say where `GATEWAY_WEBHOOK_SECRET` comes from or that it differs from the API key. One line. Owner: claude-sdk.
9. The `"window" in globalThis` guard also trips in jsdom tests and some edge runtimes. The message is clear, so this is acceptable. Mention "test with testEnvironment node" if a shop hits it. Owner: claude-sdk.
