// Round 2: + replaying the exact verify request (consumeNonce) and the nonce format.
// Probe: does /api/auth/verify take the SIWE domain from a caller-controlled Host / X-Forwarded-Host?
// Uses a throwaway key generated at runtime. Prints statuses only, never cookie values.
import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire("/Users/vg890/ethglobal/apps/web/package.json");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const { createSiweMessage } = require("viem/siwe");

const PORT = 3100;
function req(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}
const cookieOf = (res, name) => (res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);

async function attempt(label, domain, extraHeaders, replay = false) {
  const account = privateKeyToAccount(generatePrivateKey());
  const n = await req("GET", "/api/auth/nonce", { ...extraHeaders });
  const nonceCookie = cookieOf(n, "mc_nonce");
  const { nonce } = JSON.parse(n.body);
  const message = createSiweMessage({
    address: account.address, chainId: 1874, domain, nonce, uri: `https://${domain}`, version: "1",
    expirationTime: new Date(Date.now() + 5 * 60_000), statement: "Sign in to evil.example",
  });
  const signature = await account.signMessage({ message });
  const body = JSON.stringify({ message, signature });
  const v = await req("POST", "/api/auth/verify", { ...extraHeaders, "content-type": "application/json", "content-length": Buffer.byteLength(body), cookie: nonceCookie }, body);
  const session = cookieOf(v, "mc_session");
  let replayStatus = "n/a";
  if (replay) {
    const again = await req("POST", "/api/auth/verify", { ...extraHeaders, "content-type": "application/json", "content-length": Buffer.byteLength(body), cookie: nonceCookie }, body);
    replayStatus = `${again.status} session=${Boolean(cookieOf(again, "mc_session"))}`;
  }
  let dashboard = "n/a";
  if (session) {
    const d = await req("GET", "/merchant", { cookie: session }); // the real host
    dashboard = d.body.includes("Signed in as") ? "SIGNED IN on 127.0.0.1:3100" : "not signed in";
  }
  console.log(JSON.stringify({ err: v.body.slice(0,80).replace(/0x[0-9a-fA-F]{40}/, "0x<throwaway>"), label, domainInMessage: domain, nonceStatus: n.status, nonceIs32Hex: /^[0-9a-f]{32}$/.test(nonce), replayStatus, verifyStatus: v.status, gotSession: Boolean(session), dashboard }));
}

await attempt("control: real host", `127.0.0.1:${PORT}`, {});
await attempt("Host: evil.example", "evil.example", { host: "evil.example" });
await attempt("X-Forwarded-Host: evil.example", "evil.example", { "x-forwarded-host": "evil.example" });
await attempt("control: localhost", `localhost:${PORT}`, {});
await attempt("Host: localhost:3100 explicit", `localhost:${PORT}`, { host: `localhost:${PORT}` });
await attempt("replay: same cookie + body twice", `localhost:${PORT}`, {}, true);
