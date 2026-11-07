import { test } from "node:test";
import assert from "node:assert/strict";
import { signInReturn } from "../lib/sign-in-return.ts";

test("OAuth sign-in resumes only the local consent route", () => {
  assert.equal(signInReturn("/merchant/ai/authorize?request=signed.token"), "/merchant/ai/authorize?request=signed.token");
  for (const value of [null, "https://evil.example/", "//evil.example/", "/\\evil.example/", "/merchant/settings", "/merchant/ai/authorize", "/merchant/ai/authorize?request=" + "a".repeat(16001)]) {
    assert.equal(signInReturn(value), "/merchant/settings");
  }
  assert.equal(signInReturn("/merchant/ai/authorize?request=token&redirect=https://evil.example#fragment"), "/merchant/ai/authorize?request=token");
});
