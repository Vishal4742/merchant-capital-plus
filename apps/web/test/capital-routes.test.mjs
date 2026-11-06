// /api/v1/capital/* routes (batch 023): input checks, sign-in and the read limit, all decided before any chain or
// Arkiv call (so these run offline).
import { test } from "node:test";
import assert from "node:assert/strict";

const { resetRateLimits } = await import("../lib/server/http.ts");
const quote = await import("../app/api/v1/capital/quote/route.ts");
const check = await import("../app/api/v1/capital/transfer-check/route.ts");
const merchant = await import("../app/api/v1/capital/merchant/route.ts");
const publish = await import("../app/api/v1/capital/offers/[id]/publish/route.ts");

const get = (path, ip = "203.0.113.7") => new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": ip } });
const A = "0x2222222222222222222222222222222222222222";

test("quote and transfer-check refuse bad input with 400 and a message", async () => {
  resetRateLimits();
  for (const path of ["/api/v1/capital/quote", "/api/v1/capital/quote?claim=1", "/api/v1/capital/quote?claim=x&units=1", "/api/v1/capital/quote?claim=1&units=0"]) {
    const res = await quote.GET(get(path));
    assert.equal(res.status, 400, path);
    assert.ok((await res.json()).error, path);
  }
  for (const qs of [`from=0x12&to=${A}&claim=1&amount=1`, `from=${A}&to=nope&claim=1&amount=1`, `from=${A}&to=${A}&claim=0&amount=1`, `from=${A}&to=${A}&claim=1&amount=-1`]) {
    assert.equal((await check.GET(get(`/api/v1/capital/transfer-check?${qs}`))).status, 400, qs);
  }
});

test("the merchant view and publish need the dashboard sign-in (401)", async () => {
  assert.equal((await merchant.GET(get("/api/v1/capital/merchant"))).status, 401);
  const res = await publish.POST(new Request("http://localhost/api/v1/capital/offers/1/publish", { method: "POST" }), { params: Promise.resolve({ id: "1" }) });
  assert.equal(res.status, 401);
});

test("public capital reads are limited to 60 a minute per IP (429 after that)", async () => {
  resetRateLimits();
  const statuses = [];
  for (let i = 0; i < 61; i++) statuses.push((await quote.GET(get("/api/v1/capital/quote", "198.51.100.9"))).status);
  assert.equal(statuses.filter((s) => s === 400).length, 60);
  assert.equal(statuses.at(-1), 429);
  assert.equal((await quote.GET(get("/api/v1/capital/quote", "198.51.100.10"))).status, 400, "another IP has its own window");
});
