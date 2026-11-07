// Batch 031 round 4 (owner Stage-2 item 6): the pinned webhook POST against a CONTROLLED LOCAL HTTPS fixture.
// This is local integration evidence (127.0.0.1, a throwaway CA generated per run with openssl), NOT an outbound or
// deployed smoke test. Production code path: pinnedPost() with the system trust store; here the fixture's CA is passed
// for this request only (never global, never rejectUnauthorized:false). Skips loudly if openssl is unavailable.
// Run from apps/web: node --experimental-test-module-mocks --test test/pinned-https.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";

const { pinnedPost } = await import("../lib/server/webhooks.ts");

let dir;
let pki = null; // { ca, good: {key, cert} for hooks.test, wrong: {key, cert} for other.test, selfSigned: {key, cert} for hooks.test }
const ssl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });

before(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-pinned-"));
  try {
    ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "1", "-subj", "/CN=Whiteflow Test CA");
    const leaf = (name, cn, signer) => {
      writeFileSync(join(dir, `${name}.ext`), `subjectAltName=DNS:${cn}\nbasicConstraints=CA:FALSE\n`);
      ssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${cn}`);
      if (signer === "ca") ssl("x509", "-req", "-in", `${name}.csr`, "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", `${name}.pem`, "-days", "1", "-extfile", `${name}.ext`);
      else ssl("x509", "-req", "-in", `${name}.csr`, "-signkey", `${name}.key`, "-out", `${name}.pem`, "-days", "1", "-extfile", `${name}.ext`);
      return { key: readFileSync(join(dir, `${name}.key`)), cert: readFileSync(join(dir, `${name}.pem`)) };
    };
    pki = { ca: readFileSync(join(dir, "ca.pem"), "utf8"), good: leaf("good", "hooks.test", "ca"), wrong: leaf("wrong", "other.test", "ca"), selfSigned: leaf("self", "hooks.test", "self") };
  } catch {
    pki = null;
  }
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** An HTTPS fixture on 127.0.0.1 recording what reached it; `handler` answers (or doesn't). */
async function fixture(certs, handler) {
  const seen = { sockets: 0, open: 0, requests: [] };
  const server = https.createServer({ key: certs.key, cert: certs.cert }, (req, res) => {
    seen.requests.push({ host: req.headers.host, servername: req.socket.servername, path: req.url, remote: req.socket.remoteAddress });
    req.resume();
    req.on("end", () => handler(req, res));
  });
  server.on("connection", (socket) => {
    seen.sockets++;
    seen.open++;
    socket.on("close", () => seen.open--);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { seen, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const skipIfNoPki = (t) => {
  if (!pki) {
    t.skip("SKIPPED: openssl not available to build the local HTTPS fixture");
    return true;
  }
  return false;
};
const post = (port, host, timeoutMs = 2_000, tls = { ca: pki?.ca }) => pinnedPost(`https://${host}:${port}/hooks?x=1`, "127.0.0.1", { "content-type": "application/json" }, '{"id":"evt_1"}', timeoutMs, tls);

test("connects to the vetted address; TLS validates the intended hostname; SNI and Host are the hostname", async (t) => {
  if (skipIfNoPki(t)) return;
  const f = await fixture(pki.good, (_req, res) => res.writeHead(204).end());
  try {
    // hooks.test does not resolve anywhere: success proves the socket went to the pinned 127.0.0.1, not to DNS
    assert.equal(await post(f.port, "hooks.test"), 204);
    assert.equal(f.seen.requests.length, 1);
    const [r] = f.seen.requests;
    assert.equal(r.servername, "hooks.test", "SNI is the URL's hostname");
    assert.equal(r.host, `hooks.test:${f.port}`, "Host header is the URL's host");
    assert.equal(r.path, "/hooks?x=1");
    assert.equal(r.remote, "127.0.0.1");
  } finally {
    await f.close();
  }
});

test("a certificate for another hostname is rejected (hostname mismatch), and so is an untrusted one", async (t) => {
  if (skipIfNoPki(t)) return;
  for (const certs of [pki.wrong, pki.selfSigned]) {
    const f = await fixture(certs, (_req, res) => res.writeHead(200).end());
    try {
      await assert.rejects(post(f.port, "hooks.test"));
      assert.equal(f.seen.requests.length, 0, "no request is sent over an unverified connection");
    } finally {
      await f.close();
    }
  }
  // and without the fixture CA (the production trust store), even the correct fixture certificate is refused
  const f = await fixture(pki.good, (_req, res) => res.writeHead(200).end());
  try {
    await assert.rejects(post(f.port, "hooks.test", 2_000, {}));
  } finally {
    await f.close();
  }
});

test("a redirect is answered as a status, never followed", async (t) => {
  if (skipIfNoPki(t)) return;
  const f = await fixture(pki.good, (_req, res) => res.writeHead(302, { location: "https://127.0.0.1:1/internal" }).end());
  try {
    assert.equal(await post(f.port, "hooks.test"), 302);
    assert.equal(f.seen.requests.length, 1, "only the original request reached anything");
  } finally {
    await f.close();
  }
});

test("a destination that never answers times out and its socket is released; a healthy one completes meanwhile", async (t) => {
  if (skipIfNoPki(t)) return;
  const hang = await fixture(pki.good, () => {}); // accepts, never responds
  const ok = await fixture(pki.good, (_req, res) => res.writeHead(200).end());
  try {
    const started = Date.now();
    const hanging = post(hang.port, "hooks.test", 1_500);
    assert.equal(await post(ok.port, "hooks.test"), 200, "the healthy destination isn't held up");
    assert.ok(Date.now() - started < 1_500, "it finished before the hanging one timed out");
    await assert.rejects(hanging, /timeout/);
    // the client destroyed its socket: the fixture sees the connection close
    for (let i = 0; i < 50 && hang.seen.open > 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(hang.seen.open, 0, "no socket left open after the timeout");
  } finally {
    await hang.close();
    await ok.close();
  }
});
