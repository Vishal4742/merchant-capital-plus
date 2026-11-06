// claude-frontend: our server calls its own gateway routes on a fixed origin, never the request's Host (security
// review 010 F1: a forged Host sent the call, with the caller's cookie, to any address). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const { selfOrigin } = await import("../lib/gateway-server.ts");

test("selfOrigin comes from the server's own env: PORT under next start, VERCEL_URL on Vercel, never a Host header", () => {
  assert.equal(selfOrigin({ PORT: "3100" }), "http://127.0.0.1:3100");
  assert.equal(selfOrigin({}), "http://127.0.0.1:3000", "next's default port");
  assert.equal(selfOrigin({ PORT: "3100", VERCEL_URL: "web-abc.vercel.app" }), "https://web-abc.vercel.app");
  assert.equal(selfOrigin.length, 0, "takes no request input at all (only an optional env)");
});
