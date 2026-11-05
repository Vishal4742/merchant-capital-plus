// claude-sdk checks for the pay button (FR-GW-4, FR-GW-1 link). button.js runs in node:vm against a tiny fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { runInNewContext } from "node:vm";

const SRC = new URL("../button.js", import.meta.url);
const COPY = new URL("../../../apps/web/public/v1/button.js", import.meta.url);
const code = readFileSync(SRC, "utf8");
const GATEWAY = "https://gateway.test";
const ID = "70359474-3587-4bc8-8eca-80eb35d5cbdc";

type El = {
  tag: string; attrs: Map<string, string>; style: { cssText: string }; textContent: string; type: string; className: string;
  parent: El | null; inserted: El[];
  getAttribute(n: string): string | null; setAttribute(n: string, v: string): void;
  closest(sel: string): El | null; insertAdjacentElement(where: string, el: El): El; appendChild(el: El): El;
};
function el(tag: string, attrs: Record<string, string> = {}, parent: El | null = null): El {
  const node: El = {
    tag, attrs: new Map(Object.entries(attrs)), style: { cssText: "" }, textContent: "", type: "", className: "", parent, inserted: [],
    getAttribute: (n) => node.attrs.get(n) ?? null,
    setAttribute: (n, v) => void node.attrs.set(n, String(v)),
    closest: (sel) => (sel.split(",").some((s) => node.attrs.has(s.trim().slice(1, -1))) ? node : node.parent?.closest(sel) ?? null),
    insertAdjacentElement: (where, child) => (assert.equal(where, "afterend"), node.inserted.push(child), child),
    appendChild: (child) => (node.inserted.push(child), child),
  };
  return node;
}

/** A page: load button.js once per script element, all in one window. */
function page() {
  const listeners: ((e: unknown) => void)[] = [], navigations: string[] = [], errors: string[] = [], created: El[] = [];
  const head = el("head");
  const document: Record<string, unknown> = {
    currentScript: null, head,
    createElement: (tag: string) => { const e = el(tag); created.push(e); return e; },
    addEventListener: (type: string, fn: (e: unknown) => void) => { assert.equal(type, "click"); listeners.push(fn); },
  };
  const ctx: Record<string, unknown> = { document, location: { assign: (u: string) => navigations.push(u) }, console: { error: (...a: unknown[]) => errors.push(a.join(" ")) }, URL };
  ctx.window = ctx;
  return {
    listeners, navigations, errors, created,
    load(attrs: Record<string, string>, src = `${GATEWAY}/v1/button.js`) {
      const script = el("script", { src, ...attrs });
      document.currentScript = script;
      runInNewContext(code, ctx);
      return script;
    },
    click(target: El) {
      let prevented = false;
      for (const fn of listeners) fn({ target, preventDefault: () => { prevented = true; } });
      return prevented;
    },
  };
}

test("a script with data-session renders one button after itself that opens the hosted checkout (FR-GW-4)", () => {
  const p = page();
  const script = p.load({ "data-session": ID, "data-label": "Pay 25.00 USDT" });
  assert.equal(script.inserted.length, 1);
  const button = script.inserted[0];
  assert.equal(button.tag, "button");
  assert.equal(button.type, "button");
  assert.equal(button.className, "mc-pay-button");
  assert.equal(button.textContent, "Pay 25.00 USDT");
  assert.ok(button.style.cssText.length > 0);
  assert.equal(p.click(button), true);
  assert.deepEqual(p.navigations, [`${GATEWAY}/checkout/${ID}`]);
});

test("a script with data-link opens the payment link page, with the default label (FR-GW-1)", () => {
  const p = page();
  const button = p.load({ "data-link": "cafe-25" }).inserted[0];
  assert.equal(button.textContent, "Pay with USDT");
  p.click(button);
  assert.deepEqual(p.navigations, [`${GATEWAY}/l/cafe-25`]);
});

test("the label is text, never HTML", () => {
  const button = page().load({ "data-session": ID, "data-label": "<img src=x onerror=alert(1)>" }).inserted[0];
  assert.equal(button.textContent, "<img src=x onerror=alert(1)>");
  assert.ok(!code.includes("innerHTML"));
});

test("the destination is always the origin the script came from", () => {
  const p = page();
  const button = p.load({ "data-session": ID }, "https://other-gateway.test/v1/button.js?v=2").inserted[0];
  p.click(button);
  assert.deepEqual(p.navigations, [`https://other-gateway.test/checkout/${ID}`]);
});

test("elements the shop writes (or React renders later) work through the one delegated listener, child clicks included", () => {
  const p = page();
  p.load({}); // load-once mode: renders nothing
  const own = el("button", { "data-mc-session": ID });
  const icon = el("span", {}, own);
  p.click(icon);
  const link = el("a", { "data-mc-link": "cafe-25" });
  p.click(link);
  assert.deepEqual(p.navigations, [`${GATEWAY}/checkout/${ID}`, `${GATEWAY}/l/cafe-25`]);
  assert.equal(p.click(el("button")), false); // unrelated clicks are left alone
  assert.equal(p.navigations.length, 2);
});

test("a bad id or slug renders nothing, never navigates, and logs one error", () => {
  for (const bad of ["", "../admin", "a/b", "x?y=1", "javascript:alert(1)", "a".repeat(65)]) {
    const p = page();
    const script = p.load({ "data-session": bad });
    assert.equal(script.inserted.length, 0, bad);
    assert.equal(p.errors.length, 1, bad);
    assert.equal(p.click(el("button", { "data-mc-link": bad })), false, bad);
    assert.equal(p.navigations.length, 0, bad);
    assert.equal(p.errors.length, 2, bad);
  }
});

test("loading the script twice installs one click listener, and both buttons render", () => {
  const p = page();
  const first = p.load({ "data-session": ID });
  const second = p.load({ "data-link": "cafe-25" });
  assert.equal(p.listeners.length, 1);
  assert.equal(first.inserted.length + second.inserted.length, 2);
  p.click(second.inserted[0]);
  assert.deepEqual(p.navigations, [`${GATEWAY}/l/cafe-25`]);
});

test("button.js stays tiny, makes no requests, and the gateway's public copy is byte-identical", () => {
  assert.ok(statSync(SRC).size <= 2048, `${statSync(SRC).size} bytes`);
  for (const forbidden of ["fetch(", "XMLHttpRequest", "import ", "require(", "eval(", "innerHTML"]) assert.ok(!code.includes(forbidden), forbidden);
  assert.equal(readFileSync(COPY, "utf8"), code);
});
