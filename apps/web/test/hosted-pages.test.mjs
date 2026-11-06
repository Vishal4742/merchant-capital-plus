// claude-frontend checks for the hosted /l and /p pages (FR-GW-1, FR-GW-2): their plain form posts go to our routes,
// which ask the gateway for a checkout and answer 303, to the checkout or back to the page with a fixed message.
// The gateway (claude-contracts' public routes) is faked through fetch. Run from apps/web: npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { POST as payLink } from "../app/l/[slug]/checkout/route.ts";
import { POST as payPage } from "../app/p/[slug]/checkout/route.ts";
import { closedLinkCopy } from "../lib/gateway-forms.ts";
import { previewOn } from "../lib/gateway-preview.ts";

const SESSION = "0b6c2a8e-6f1d-4c39-9d2b-8f1e3a5c7d90";
const SLUG = "AbCdEfGhIj";
let calls = [];
let reply = () => Response.json({ checkout_url: `https://elsewhere.example/checkout/${SESSION}`, session_id: SESSION });
// security review 010 F1: our own gateway calls go to this server (next start sets PORT), never to the request's
// Host, which every request below forges as evil.example
process.env.PORT = "3111";
delete process.env.VERCEL_URL;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined, headers: new Headers(init.headers) });
  return reply();
};
beforeEach(() => {
  calls = [];
  reply = () => Response.json({ checkout_url: `https://elsewhere.example/checkout/${SESSION}`, session_id: SESSION });
  delete process.env.GATEWAY_PREVIEW;
});

const form = (route, path, slug, entries) =>
  route(
    new Request(`http://127.0.0.1:3111${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "evil.example:47123", "x-forwarded-for": "198.51.100.4", cookie: "mc_session=merchant-cookie" },
      body: new URLSearchParams(entries).toString(),
    }),
    { params: Promise.resolve({ slug }) },
  );
const location = (res) => {
  assert.equal(res.status, 303);
  return res.headers.get("location");
};

test("a link's form opens a checkout: 303 to our own checkout page", async () => {
  const res = await form(payLink, `/l/${SLUG}/checkout`, SLUG, []);
  assert.equal(location(res), `/checkout/${SESSION}`, "our path, never the URL in the gateway's answer");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `http://127.0.0.1:3111/api/v1/public/links/${SLUG}/checkout`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, {}, "a fixed link sends no amount: the stored price wins");
  assert.equal(calls[0].headers.get("accept"), "application/json");
  assert.equal(calls[0].headers.get("x-forwarded-for"), "198.51.100.4", "the payer's address, for the gateway's rate limit");
});

test("an open link sends the amount the customer typed", async () => {
  await form(payLink, `/l/${SLUG}/checkout`, SLUG, [["amount", " 12.50 "]]);
  assert.deepEqual(calls[0].body, { amount: "12.50" });
});

test("a link that can't be paid sends the customer back with a fixed message code", async () => {
  const cases = [
    [() => Response.json({ error: "This payment link is paid." }, { status: 410 }), [], "error=closed"],
    [() => Response.json({ error: "amount must be a decimal string" }, { status: 400 }), [["amount", "9999999"]], "amount=9999999&error=amount"],
    [() => Response.json({ error: "Too many requests." }, { status: 429 }), [], "error=busy"],
    [() => new Response("<html>502</html>", { status: 502 }), [], "error=down"],
    [() => { throw new TypeError("fetch failed"); }, [], "error=down"],
  ];
  for (const [answer, entries, query] of cases) {
    reply = answer;
    assert.equal(location(await form(payLink, `/l/${SLUG}/checkout`, SLUG, entries)), `/l/${SLUG}?${query}`);
  }
  reply = () => Response.json({ error: "x" }, { status: 400 });
  assert.equal(location(await form(payLink, `/l/${SLUG}/checkout`, SLUG, [])), `/l/${SLUG}?error=closed`, "a fixed link's 400: the customer can't fix it");
});

test("a bad amount or slug is refused before the gateway is asked", async () => {
  assert.equal(location(await form(payLink, `/l/${SLUG}/checkout`, SLUG, [["amount", "12,50"]])), `/l/${SLUG}?amount=12%2C50&error=amount`);
  assert.equal((await form(payLink, "/l/../checkout", "..", [])).status, 404);
  assert.equal((await form(payPage, "/p/a%2Fb/checkout", "a/b", [])).status, 404);
  assert.equal(calls.length, 0);
});

test("a page's form sends the chosen items and quantities", async () => {
  const res = await form(payPage, `/p/${SLUG}/checkout`, SLUG, [["qty:Cold brew", "2"], ["qty:Croissant", "0"], ["qty:Banana bread", "1"]]);
  assert.equal(location(res), `/checkout/${SESSION}`);
  assert.equal(calls[0].url, `http://127.0.0.1:3111/api/v1/public/pages/${SLUG}/checkout`);
  assert.deepEqual(calls[0].body, { items: [{ name: "Cold brew", qty: 2 }, { name: "Banana bread", qty: 1 }] });
});

test("a page with nothing chosen goes back with the quantities kept", async () => {
  const res = await form(payPage, `/p/${SLUG}/checkout`, SLUG, [["qty:Cold brew", "0"]]);
  assert.equal(location(res), `/p/${SLUG}?qty%3ACold+brew=0&error=items`);
  assert.equal(calls.length, 0);
  reply = () => Response.json({ error: "qty must be a whole number from 1 to 100." }, { status: 400 });
  assert.equal(location(await form(payPage, `/p/${SLUG}/checkout`, SLUG, [["qty:Cold brew", "3"]])), `/p/${SLUG}?qty%3ACold+brew=3&error=items`);
  reply = () => Response.json({ error: "amount must be at least 5 EUR." }, { status: 400 });
  assert.equal(location(await form(payPage, `/p/${SLUG}/checkout`, SLUG, [["amount", "2"]])), `/p/${SLUG}?amount=2&error=amount`);
});

test("the preview switch is off unless asked for, and never on Vercel", () => {
  assert.equal(previewOn({}), false);
  assert.equal(previewOn({ GATEWAY_PREVIEW: "0" }), false);
  assert.equal(previewOn({ GATEWAY_PREVIEW: "1" }), true);
  assert.equal(previewOn({ GATEWAY_PREVIEW: "1", VERCEL: "1" }), false, "no Vercel deployment can serve the fixtures");
  assert.equal(previewOn({ GATEWAY_PREVIEW: "1", NODE_ENV: "production", VERCEL_ENV: "production" }), false);
});

test("every closed link state has its own plain copy", () => {
  for (const status of ["paid", "expired", "cancelled"]) {
    const copy = closedLinkCopy(status, "Bandra Beans");
    assert.ok(copy.title && copy.body.includes("Bandra Beans"), status);
    assert.doesNotMatch(`${copy.title} ${copy.body}`, /\b(sign|signature|gas|chain|blockchain|wallet|wbt|nonce)\b/i);
  }
  assert.notEqual(closedLinkCopy("paid", "x").title, closedLinkCopy("expired", "x").title);
});
