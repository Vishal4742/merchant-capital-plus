# Frontend SDK API cheat-sheet (read from package source, 2026-11-05)

For the claude-frontend lane. Every claim below was read from the published tarball. `file:line` paths are relative to each package root. Anything marked **UNVERIFIED** could not be confirmed from source and needs a Phase 1 runtime check. These are research notes, not product code.

## Versions and integrity (from `npm view`, tarball SHA-1 re-checked with `shasum`)

| Package | Version | dist.shasum (matched download) | dist.integrity |
|---|---|---|---|
| @arkiv-network/sdk | 1.0.1 | 6381ca28a62b91be1554ecfbc923c7079410842d | sha512-DCOFdGunn4I5nYrvIV/YIkMCkLZM7EQNSyNPtqpmQkP2JzTEfRLBJleBSB2rokWMa833/9P8DMiwsEXACr3CUQ== |
| @anon-rpc/browser-harness | 0.4.0 | f0a58fee46f16d32c723ad63519ce3ae335442d1 | sha512-9h+ks9lGmGTXE3fuFopowag+pLVJxhgmYG3SEBI1qk8ik7RGkxPT7Ub7RmbkDJ92/4VCa8gjT45BWoEnGynJYQ== |
| @anon-rpc/harness-core (dep, pinned exactly) | 0.4.0 | 24559c7fe55e5213e13db93588eaeffb4390cd22 | sha512-ZFVeE0tkUgXPw1qu99s8JPKD4jFatHZ+nELisZ4WF+YMpCrBFIvpJe0qdCoLcmbhH1brbsC35qe8F1G3HxIbgA== |
| @privy-io/react-auth | 3.51.0 | 8767d04cdd7c9ec18206c9ba92fd59cc8b144648 | sha512-KZASN9ZZMd/1KriSOZZvMQ2hAzJV4yG5fHZf6lxSZUAY3HZ4xeDNjubLKXYe6/H8AfucF5rCbcrjKnfd0/cgdg== |
| @privy-io/js-sdk-core (dep) | 0.79.1 | 82f97bf73015d004cb03ff142d6d7751f2c3f055 | sha512-wElB71FKVg8JkU6/eQngKrDSVHD0dOm9ZZzuNA7avBwqNdpUQiCSOqu0y4IEz6ThSrbjyKfaPTM/JdzVP6UCiQ== |
| @privy-io/chains (dep) | 0.6.1 | 02bc416bb79d2e7adb0dddbba572d34ab4f51938 | sha512-cz941EUCMV0xhD2sojotbNgmLENzUqHq3rUAS+ZzKtZ/NTsDF0y7UoF/OVF9alBV6+wPvjtk8fYsPdLbuikQSw== |
| viem (for transport wiring) | 2.57.13 | f3ff0a801d3e6cf74ddd22a2d0562f57f01a519d | sha512-hSIsR4Y47BKrp89idH11WC3pqYOJFq9nVYBYxuJ9zXCA8Qg3pQhnlhnHn4qnjo7Z5wXs920XhtWbnrAtFidk+Q== |
| @nymproject/anon-rpc-worker (the Nym bundle the specifier pins) | 0.1.0 | b85fb38e0c79c56e28f2846cf187a6b46d51ff74 | sha512-y9l7VGT3cvxuHPsS0HqkyNOc3s9u8exT7ePbeJfKl3nqCe6U3y6aUaL+4ucnd/L2HMHwgC/cWxgylX/ZK1fbeg== |

None of these package.json files has a `preinstall`, `install`, `postinstall` or `prepare` script (grep, no hits).

---

## 1. @arkiv-network/sdk 1.0.1

Peer deps: `viem ^2.0.0`, `typescript >=5.0.0`, and no runtime deps (package.json). Subpath exports: `.`, `./schema`, `./entity`, `./chains`, `./query`, `./types`, `./utils`.

### Breaking changes compared with what we remember from 0.x
- **The chain is a function now:** `rabdi({ accessKey })` (`src/chains/rabdi.ts:37`). It throws `MissingAccessKeyError` if `accessKey` isn't a string. `""` means the public endpoint, "heavily rate limited" (`:39-45`). The key goes into the URL path, `https://rpc.rabdi.db-chain.testnet.arkiv.network/<key>` (`:46,59`). The SDK says the key is not a secret but should be restricted to your origins (`:11-13`); keys come from hub.arkiv.network/access-keys. **Observed 2026-11-05: the keyless endpoint did not answer `eth_chainId` within 15 s or 25 s (two curl tries). Get a key in Phase 1.**
- Entities are **schema-typed columns**, not payloads. You write through `defineSchema(name, columns)` (`src/schema/schema.ts:96`).
- There is no `updateEntity`. It is **`patchEntity(schema, key, { set, unset })`** (`src/clients/decorators/arkivWallet.ts:144`). A patch never changes the key, owner, flags or expiry (`src/actions/wallet/patchEntity.ts:41-46`). Use `extendEntity` for expiry and `changeOwnership` for the owner.
- Queries go through the `select().from().where().ownedBy().fetch()` builder or a raw string `query()`. `buildQuery` is gone.
- The wallet client has **no read actions** (`getEntity`, `select`, `query`). Read through a public client (`src/clients/createWalletClient.ts:30-34`).
- The Arkiv public client's *type* only picks 10 viem public actions: getBalance, getBlock, getBlockNumber, getChainId, getLogs, getTransaction, getTransactionCount, getTransactionReceipt, waitForTransactionReceipt, watchEvent (`src/clients/decorators/arkivPublic.ts:40-51`). There's no `readContract` or `multicall`, which doesn't matter because 1874 reads use a separate plain viem client.

### Clients and a custom transport
```ts
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk" // src/index.ts:8,10
import { rabdi } from "@arkiv-network/sdk/chains"                            // src/chains/index.ts:2
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const chain = rabdi({ accessKey: ARKIV_ACCESS_KEY }) // public-by-design key (origin-restricted)

// Server only (API route). Key from the git-ignored .env, never shipped to the browser.
const writer = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(WRITER_KEY) })

// Browser reads over Anon-RPC: any viem Transport works, because the factory spreads
// PublicClientConfig into viem createClient (src/clients/createPublicClient.ts:45-58).
const reader = createPublicClient({
  chain,
  transport: http(undefined, { fetchFn: worker.fetch, timeout: 60_000 }), // url undefined -> chain URL with key
})
```
Signatures: `createPublicClient(parameters: PublicClientConfig<...>)` (`src/clients/createPublicClient.ts:45-52`) and `createWalletClient(parameters: WalletClientConfig<...>)` (`src/clients/createWalletClient.ts:51-58`). Writes need `client.account`, otherwise they throw "Account required" (`src/utils/arkivTransactions.ts:99`). Reads call the custom RPC methods `arkiv_query` (`src/query/engine.ts:71`) and `arkiv_getEntity` (`src/actions/public/getEntity.ts:40`). These go over the same transport, so Anon-RPC carries them like any JSON-RPC call.

### Schema (the offer entity) and value types
Types: `bool, i32, u64, u256, dec, str, addr, key, bytes` (README:132; exports in `src/schema/index.ts:55-73`). Call one with no argument to declare a column, and with a value to make a typed value. `.indexed()` works on every type except `bytes`; `.optional()` and `.default()` work on all (README:133-134).

```ts
import { addr, bytes, defineSchema, str, u256, u64 } from "@arkiv-network/sdk/schema"
export const Offer = defineSchema("mcplus.offer.v1", {   // the name becomes an indexed `arkiv.schema` tag
  kind: str().indexed(), chainId: u64().indexed(), market: addr().indexed(), claimId: u256().indexed(),
  merchant: addr().indexed(), faceUsdt: u256().indexed(), priceUsdt: u256().indexed(),
  remainingUsdt: u256().indexed(), aprBps: u64().indexed(), holdbackBps: u64().indexed(),
  maturity: u64().indexed(), deadline: u64().indexed(), status: str().indexed(), sector: str().indexed(),
  terms: bytes(),                                        // bytes can never be indexed
})
```
That is 15 columns plus the tag, so 16 of the 32 allowed.

**Limits (all in source):**
| Limit | Value | Where |
|---|---|---|
| Attributes per entity | 32, and a named schema's tag counts as one | `src/schema/schema.ts:11,125` |
| Attribute name | ≤32 bytes, `/^[A-Za-z][A-Za-z0-9._-]*$/`, case-sensitive, no leading `$`, no `--`, and not a reserved word (`and or not true false between startswith exists typeof order by asc desc` or any type tag, case-insensitive) | `src/schema/names.ts:4,13,24-49` |
| `str` value | **≤128 UTF-8 bytes** | `src/schema/values.ts:40` |
| One `bytes` value | ≤128 KiB | `src/schema/values.ts:45` |
| All `bytes` in one create/patch | ≤128 KiB, marked "provisional" | `src/schema/attributes.ts:14-21` |
| `dec` | fixed 18 decimals; extra precision is an error, not rounded | `src/schema/decimal.ts:7`, `:24-31` |
| Query page | `limit` ≤100 | `src/query/engine.ts:11,50` |
| Lifetime | ≤7,884,000 blocks (about 182.5 days at the nominal 2 s block) | `src/consts.ts:3,9` |

**Footgun with bare values.** Outside a schema, a bare `number` becomes **i32** and a bare `bigint` becomes **u256** (`src/schema/values.ts:567-570`). Through a schema, the bare forms each column accepts are `BareOf` (`src/schema/values.ts:525-535`): `u64`, `addr`, `dec` and `key` accept **no** bare form, so you must write `u64(x)` / `addr(x)`. `u256` takes a bare bigint, `str` a bare string, `bytes` a bare Uint8Array. Read-back shapes are `{ type, value }`: u64 and u256 give bigint, dec gives string, addr gives Address, bytes gives Hex (`src/schema/types.ts:83-107`).

### Create with expiry
The expiry parameter is **`options.expiration`** (required), of type `Expiry` (`src/actions/wallet/createEntity.ts:27-34`). It can only be built with `ExpirationTime`, because the type is branded and a hand-written literal won't typecheck (`src/entity/expiry.ts:5-32`). **The unit is blocks on the wire** (`minLifetime` in blocks, `expiresAt` a block height, `src/entity/expiry.ts:23-31`). The helpers take human units: `fromSeconds/Minutes/Hours/Days/Weeks/Months(30 d)/Years(365 d)`, `fromBlocks(n)`, `max()`, `atBlock(bigint, {atLeast?})` and `atDate(Date, {atLeast?})` (`src/utils/expirationTime.ts:53-161`). Durations must be a whole multiple of 2 s (`src/entity/expiry.ts:152-167`). `atDate` rounds up to the next block, assumes 2 s blocks, and throws if the date is in the past (`src/entity/expiry.ts:176-184`). Anything past `MAX_LIFETIME` is refused before sending (`:112-127`).

```ts
import { ExpirationTime } from "@arkiv-network/sdk"           // src/index.ts:48
import { addr, u64 } from "@arkiv-network/sdk/schema"
// signature: createEntity(schema, values, options, txParams?) -> { entityKey, txHash, expiresAt }
//   src/clients/decorators/arkivWallet.ts:109, src/actions/wallet/createEntity.ts:68-85
const { entityKey, txHash, expiresAt } = await writer.createEntity(Offer, {
  kind: "invoice", chainId: u64(1874), market: addr(MARKET), claimId: claimId /* bigint -> u256 */,
  merchant: addr(merchant), faceUsdt, priceUsdt, remainingUsdt,           // bigint (6-dp units)
  aprBps: u64(aprBps), holdbackBps: u64(0), maturity: u64(maturity), deadline: u64(deadline),
  status: "open", sector: "cafe", terms: termsBytes /* Uint8Array */,
}, { expiration: ExpirationTime.atDate(new Date(Number(deadline) * 1000)) })
```
Other options: `flags?: { readonly?, permissionlessExtension? }`, fixed for the entity's life. `salt?` defaults to 128 random bits, or pass `NO_SALT` for a predictable key (`src/actions/wallet/createEntity.ts:35-47`). `expiresAt` in the result is the block the engine recorded (`:72-76`).

### Update attributes
```ts
// patchEntity(schema, entityKey, { set?, unset? }, txParams?) -> { entityKey, txHash }
//   src/clients/decorators/arkivWallet.ts:144, src/actions/wallet/patchEntity.ts:22-39,61
await writer.patchEntity(Offer, entityKey, { set: { remainingUsdt: 0n, status: "filled" } })
```
`set` writes only the named columns, and defaults don't apply. `unset` takes optional columns only, and naming the same column in both throws `ConflictingMutationError`. To move the expiry: `writer.extendEntity({ entityKey, expiration })` (`src/actions/wallet/extendEntity.ts:28-32`). To delete: `writer.deleteEntity({ entityKey })` (`src/actions/wallet/deleteEntity.ts:13-15`).

### Query by attribute equality and by owner
```ts
import { and, asc, eq, gt } from "@arkiv-network/sdk/query"   // src/query/index.ts:25-41
import { addr, u64 } from "@arkiv-network/sdk/schema"
const page = await reader
  .select({ $key: true, $owner: true, $expiresAt: true, claimId: true, priceUsdt: true, status: true }) // inline, not a variable (README:355-361)
  .from(Offer)                                   // adds the arkiv.schema tag filter; type-checks where/orderBy
  .where(eq("status", "open"), eq("chainId", u64(1874)))  // repeated args/calls are ANDed
  .ownedBy(PUBLISHER)                            // == where(eq("$owner", addr(PUBLISHER)))
  .orderBy(asc("$key"))                          // one key only
  .limit(100)
  .fetch()                                       // QueryResult { entities, blockNumber, skipped, count }
```
References: `select` (`src/clients/decorators/arkivPublic.ts:140`), `from(schema, { onMismatch?: "throw" | "skip" })` (`src/query/queryBuilder.ts:41-50,144`), `where` (`src/query/builderBase.ts:98`), `ownedBy(owner: Hex)` (`:112-115`, implemented as `eq("$owner", addr(owner))`), `createdBy` (`:123`), `orderBy` (`src/query/queryBuilder.ts:187`), `limit` (`:217`), `offset` (`:240`), `withCount()` (`:262`), `fetch()` (`:286`), `QueryResult` (`src/query/queryResult.ts:19-52`). Other operators: `or, gte, lt, lte, between, exists, startsWith, hasType` (`src/query/index.ts:25-39`). A query with no filter throws, but a named schema's tag counts as a filter (`src/query/builderBase.ts:135-152`). Through a schema, `where` only accepts **indexed** columns plus `$key`, `$owner`, `$creator` and `$expiresAt`, and the value type must match the column (README:260-267). Selectable system fields are `$key $owner $creator $createdAt $updatedAt $expiresAt $creationFlags` (`src/query/selection.ts:24-32`). Entities that don't fit the schema are silently skipped by default and counted in `page.skipped` (README:314-324). Anyone can write a matching entity, so **filter with `.ownedBy(PUBLISHER)`**. `reader.count()` exists (`src/clients/decorators/arkivPublic.ts:187`). The raw-string form is `reader.query(expr | string, options?)` (`:224`).

### Read one entity by key
```ts
// getEntity(key) -> FullEntity ; getEntity(key, schema) -> FullRow<S>   src/clients/decorators/arkivPublic.ts:93
const offer = await reader.getEntity(entityKey, Offer)   // offer.status.value, offer.$owner ...
```
Throws `NoEntityFoundError` if the key never existed or has expired, and `SchemaMismatchError` if it doesn't fit the schema (`src/actions/public/getEntity.ts:18-22,44`).

---

## 2. @anon-rpc/browser-harness 0.4.0 (+ @anon-rpc/harness-core 0.4.0)

Entry point is `dist/host.js`, which exports `AnonRpcWorker` and `RpcError` plus all spec types (`src/host/index.ts:1-2`). A second export is `./iframe-boot.js`. Deps: `@anon-rpc/harness-core 0.4.0` (exact), `@kpstreams/webrtc-client ^0.2.1`, `@noble/hashes ^1.5.0`. **Browser only.** The module statically imports `@kpstreams/webrtc-client` (`src/host/kps-bridge-host.ts:11`), and the constructor touches `document` right away (`src/host/AnonRpcWorker.ts:93,126,152`). Load it from a client-only effect with `await import("@anon-rpc/browser-harness")`, never during SSR. The README calls it "prototype-grade reference implementation of a draft spec" (README:143-144).

### Create the worker
```ts
const { AnonRpcWorker } = await import("@anon-rpc/browser-harness")
const worker = new AnonRpcWorker({
  address: NYM_SPECIFIER,                         // or TOR_SPECIFIER; this choice IS Nym-vs-Tor
  preExisting: { rpcProvider: { request: ({ method, params }) => mainnetJsonRpc(method, params) } },
  // config?: plain JSON (Nym fields below); iframeUrl?: same-origin page, see CSP
})
await worker.ready      // optional: fetches made before this are buffered
```
- `WorkerInit = { address: string; config?: PlainValue; iframeUrl?: string; preExisting?: { rpcProvider?: RpcProvider } }` and `RpcProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> }` (harness-core `src/spec-types.ts:10-28`). Any EIP-1193-style object works, so a viem mainnet `PublicClient` qualifies because it has `.request`.
- **0.4.0 breaking change:** `config` must be a §9.4 plain value (JSON plus `undefined`, `Uint8Array`, `ArrayBuffer`). Anything else throws a `TypeError` in the constructor (CHANGELOG 0.4.0; `src/host/AnonRpcWorker.ts:82`).
- If `preExisting.rpcProvider` is missing, boot fails: "preExisting.rpcProvider is required to read the specifier" (`src/host/AnonRpcWorker.ts:115-116`).
- Other methods: `worker.acceptLog({ signal? })` pulls worker logs and stops echoing them to the console (`:311-314`). `worker.close()` tears down the iframe and worker and fails everything still pending (`:316-321`). A fatal worker error rejects every pending and future fetch (`:98-112`).

### The bootstrap read (which RPC, what it reads)
`readSpecifier` makes **two `eth_call`s at `"latest"`** on the specifier address, for `workerHash()` (bytes32) and `workerResolvers()` (string[]), through `rpcProvider` (harness-core `src/specifier.ts:40-59`). The provider must therefore point at **the chain the specifier lives on, which is Ethereum mainnet**, not 1874. It then `fetch()`es the bundle **in the host page** from the first resolver that works, and checks `keccak256(bytes) == workerHash` with a 64 MiB cap (`src/specifier.ts:64,98-141`). This read is plain RPC and is not anonymized.

Checked live on mainnet (`cast call` via https://ethereum-rpc.publicnode.com, which returns `access-control-allow-origin: *`; https://rpc.ankr.com/eth also returned CORS `*`):

| Specifier | workerHash | Resolvers (in order) | Bundle size (raw / brotli on jsDelivr) |
|---|---|---|---|
| Nym `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0` | 0xf13a448a…1fceb8 | cdn.jsdelivr.net/npm/@nymproject/anon-rpc-worker@0.1.0/dist/nym-anon-rpc-worker.js, unpkg.com (same path), raw.githubusercontent.com/nymtech/anon-rpc-worker/keccak/f1/… | **18,283,862 B (18.3 MB) / 3,941,140 B (3.9 MB br)** |
| Tor `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e` | 0x5b62f358…ec818b | cdn.jsdelivr.net/npm/tor-js@0.4.4/dist/anon-rpc-worker.js, unpkg.com, raw.githubusercontent.com/ethereum/tor-js/keccak/5b/…, `kps:152.236.3.22:12298:…` | 6,874,306 B (6.9 MB) / 2,179,002 B (2.2 MB br) |

I checked that `openssl dgst -keccak-256` of the npm-published Nym bundle equals the on-chain `workerHash` (f13a448a…fceb8).

### Nym vs Tor
You choose by **specifier address**. There is no harness option for it. Nym worker `config` is optional and read once at boot: `preferredIpr`, `disableCoverTraffic`, `connectTimeoutMs`, `clientId`, `primaryDns`/`fallbackDns`, `debug`. A `config` that is present but not a JSON object is fatal (Nym README "Configuration"; the bundle contains the string "anonRpcWorker.config must be a JSON object"). The Nym README also says: "Mixnet bootstrap takes a few seconds before the first response", it is "not yet confirmed working on Safari", identity is fresh on every boot, and abort is not cancel. Tor (tor-js 0.4.4) dials its gateway over KPS/WebRTC, and the anon-rpc worker can take a fast-bootstrap snapshot as `config.bootstrap` (tor-js README "Gateway"). Tor bootstrap logs "hundreds of lines" (`src/host/AnonRpcWorker.ts:31-35`). For a fallback, create a second worker with the Tor address only after Nym's `ready` rejects or a timeout passes, so we don't download both bundles.

### `worker.fetch` signature
`fetch: AnonFetch`, where `AnonFetch = (input: string | URL | Request, init?: RequestInit & { anonOptions?: AnonOptions }) => Promise<Response>`. It is assignable to `typeof fetch` (harness-core `src/spec-types.ts:95-99`) and this-bound, so it can be passed around as a free function (`src/host/AnonRpcWorker.ts:91-92`). `anonOptions.isolationKey?: string` asks for unlinkable circuits; tor-js honours it, and Nym support is **UNVERIFIED** (`spec-types.ts:77-81`, README:62-73). Init keys other than `method/headers/body/redirect/signal` are forwarded to the worker and must be plain values, otherwise the call rejects with `TypeError` (harness-core `src/forwarded.ts:7,20-35`). The body can be a string, Uint8Array, ArrayBuffer, ReadableStream, or anything `Response` can buffer (`src/host/normalize-request.ts:72-91`).

### viem transport for chain 1874
Recommended, because it gives the least code plus viem's JSON-RPC batching and error mapping: `http(url, { fetchFn })`. viem 2.57.13 has `fetchFn` on `HttpTransportConfig` (`viem/clients/transports/http.ts:39`, type in `viem/utils/rpc/http.ts:27-29`) and calls `fetchFn(args.url ?? url, args)` (`viem/utils/rpc/http.ts:158`). `args` includes a `url` string key, which the harness forwards as a plain value, so that's fine. The default timeout is **10 s** (`viem/clients/transports/http.ts:125`), which is too short for a cold mixnet, so raise it.
```ts
import { createPublicClient, custom, http } from "viem"
import { whitechainSepolia } from "viem/chains"   // id 1874, multicall3 0xcA11…CA11 (viem/chains/definitions/whitechainSepolia.ts:6-53)
const ANKR = "https://rpc.ankr.com/whitechain_testnet"   // viem's default RPC is rpc.testnet.whitechain.io (:18), so pass Ankr explicitly

export const chainClient = createPublicClient({
  chain: whitechainSepolia,
  batch: { multicall: true },                      // viem/clients/createClient.ts:42-45
  transport: http(ANKR, { fetchFn: worker.fetch, timeout: 60_000 }),
})

// Same thing as custom({ request }), as ARCHITECTURE §4 describes (custom: viem/clients/transports/custom.ts:35)
let id = 0
const anonTransport = custom({
  async request({ method, params }: { method: string; params?: unknown[] }) {
    const res = await worker.fetch(ANKR, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) })
    const json = await res.json()
    if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data })
    return json.result
  },
})
```
The `custom` version skips viem's HTTP error classes and timeout. Only use it if `fetchFn` misbehaves. **UNVERIFIED:** whether Ankr accepts or rate-limits requests that leave from Nym IPR exits. DEP-6 has to test this live.

### CSP and iframe requirements
- The harness always builds a hidden `<iframe sandbox="allow-scripts">`, an opaque origin, and appends it to `document.body` (`src/host/AnonRpcWorker.ts:126-135,152`). We don't need to create one ourselves.
- **Default path (no CSP on our pages):** a `srcdoc` iframe with an inline bootstrap script just works. Next.js sets no CSP by default.
- **If we add a CSP:** a `srcdoc` frame inherits it, so `script-src` without `'unsafe-inline'` means `ready` never settles (README:95-102). The fix is `iframeUrl: "/anon-rpc-iframe.html"`, a **same-origin** page (a cross-origin one is rejected, `src/host/AnonRpcWorker.ts:332-346`) containing `<!doctype html><meta charset="utf-8"><script src="/anon-rpc-iframe.js"></script>`. Copy `dist/iframe-boot.js` to `/anon-rpc-iframe.js` (README:104-121). Firefox also needs `data:` in that page's `script-src`, because opaque-origin workers refuse `importScripts(blob:)` (`src/worker/worker-runtime.ts:17-41`, CHANGELOG 0.3.3).
- The main page's `connect-src` must allow the bootstrap mainnet RPC and the bundle resolvers (cdn.jsdelivr.net, unpkg.com, raw.githubusercontent.com), because those fetches run in the host context (`src/specifier.ts:113-116`). The iframe spawns workers from `blob:` (`src/iframe/iframe-boot.ts:23-24`). **UNVERIFIED:** which hosts the Nym WASM opens WebSockets to (gateways and the directory). They sit inside base64-inlined WASM, so grep found none. Any CSP that covers the iframe would probably need `connect-src https: wss:` and `'wasm-unsafe-eval'`. The simplest choice is to set no CSP, or to use `iframeUrl` and scope a loose CSP to that one page only.
- Lazy loading: the 3.9 MB brotli download only happens when the `AnonRpcWorker` is constructed, so construct it after first paint, or on the screens that read the chain.

---

## 3. @privy-io/react-auth 3.51.0

### Custom chain 1874: yes, through config
`PrivyProviderProps = { appId: string; clientId?: string; config?: PrivyClientConfig; apiUrl?; children }` (`dist/dts/index.d.ts:584-624`). The keys inside `PrivyClientConfig` (`dist/dts/types-Bz_bVOEe.d.ts:1669`) are:
- `supportedChains?: Chain[]` (`:1939`). For embedded wallets, "the wallet will automatically default to the `defaultChain` (if set) or first supplied `supportedChain`" (`:1937`).
- `defaultChain?: Chain` (`:1947`).
- `Chain` here is Privy's own structural type from `@privy-io/chains` (`dist/dts/index.d.ts:51-79`): `{ id; name; network?; nativeCurrency; blockExplorers?; rpcUrls: { default: { http; webSocket? }, privyWalletOverride?: {...} }; testnet? }`. viem's `whitechainSepolia` fits it.
- Embedded-wallet RPC URL order (js-sdk-core `dist/esm/index.mjs`, minified, search `privyWalletOverride`): `chain.rpcUrls.privyWalletOverride` first, then `rpcConfig.rpcUrls[chainId]`, then `chain.rpcUrls.privy` (Privy's proxy, with `?privyAppId=`), then `public`, then `default`. Chain 1874 has no `privy` URL (no `1874` or `whitechain` in `@privy-io/chains`), so the wallet would use viem's default, rpc.testnet.whitechain.io (behind Cloudflare), unless we override it with `addRpcUrlOverrideToChain` (exported from react-auth, `dist/dts/index.d.ts:8`; implementation `{...chain, rpcUrls: {...chain.rpcUrls, privyWalletOverride: {http: [url]}}}` in `@privy-io/chains`).

```tsx
import { PrivyProvider, addRpcUrlOverrideToChain } from "@privy-io/react-auth"
import { whitechainSepolia } from "viem/chains"
const wc = addRpcUrlOverrideToChain(whitechainSepolia, "https://rpc.ankr.com/whitechain_testnet")
<PrivyProvider appId={PRIVY_APP_ID} config={{
  loginMethods: ["email"],                                          // types :1753
  supportedChains: [wc], defaultChain: wc,                          // :1939, :1947
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false }, // :1974, :2010, :2474
  externalWallets: { walletConnect: { enabled: false } },           // :1647-1649
}}>{children}</PrivyProvider>
```
**UNVERIFIED (this is DEP-3):** whether Privy's servers or the embedded-wallet iframe reject a chain id that isn't on their list. I saw no client-side chain allow-list check on the sign path, but the iframe and TEE code run on Privy's side and can't be read. `switchChain` says "chainId must be a supported network" (`types:1132-1138`).

### Embedded-wallet signTypedData
Option A, the Privy hook (`dist/dts/index.d.ts:3499-3509`):
```ts
const { signTypedData } = useSignTypedData()
const { signature } = await signTypedData(
  { domain, types, primaryType, message },          // SignTypedDataParams = TypedMessage<MessageTypes> (types:2594-2610)
  { uiOptions: { showWalletUIs: false }, address },  // SignMessageModalUIOptions (types:2554-2568)
)
```
`TypedMessage.domain` is `{ name?, version?, chainId?: number, verifyingContract?, salt? }` and `message` is `Record<string, unknown>`. **UNVERIFIED:** how bigints in `message` get serialized, so pass uint256 values as decimal strings, or use option B.

Option B, viem-native, fits our "viem only" rule better. `wallet.getEthereumProvider(): Promise<EIP1193Provider>` (`types:1140`), then `createWalletClient({ account: wallet.address as Address, chain: whitechainSepolia, transport: custom(provider) }).signTypedData({ domain, types, primaryType, message })`. viem encodes the bigints. Find the wallet with `useWallets()` (`index.d.ts:1356`) and `getEmbeddedConnectedWallet(wallets)` (`index.d.ts:4210`).

The internals I saw (`dist/esm/index-CaWn8tEz.mjs`, search `embedded_wallet_sign_typed_data_started`): signing either goes to Privy's wallet API as `eth_signTypedData_v4` with a `wallet_id` (server/TEE wallets), or through the hidden iframe's `rpc`. Neither path needs a chain RPC.

### Third-party hosts in the dist (NFR-8, DEP-3)
I grepped every `http(s)/ws(s)://host` in `dist/esm/*.mjs` (200 files), plus js-sdk-core and chains. Privy itself has **no Sentry, Segment, PostHog, Datadog, Mixpanel, Amplitude, Hotjar, GTM, LogRocket, Bugsnag or `sendBeacon`** (0 hits each).

| Host | What / when (file) | Loads for email-only embedded wallet? |
|---|---|---|
| auth.privy.io | the API and the hidden iframe `/apps/{appId}/embedded-wallets?caid=<clientAnalyticsId>&client_id=…` (`privy-context-D_jO1TWW.mjs`) | **yes**, needed |
| auth.privy.io `/api/v1/analytics_events` | **first-party analytics** (`paths-D5yr69aj.mjs`): `sdk_initialize` once per app/browser via a localStorage flag (`privy-context-D_jO1TWW.mjs`), plus `sdk_authenticate`, `embedded_wallet_creation_*`, **`embedded_wallet_sign_typed_data_started/_completed` with `walletAddress`**, `possible_phishing_attempt` and others. Sent with a random `client_id` analytics id. **I found no config flag to turn it off.** | **yes** |
| *.rpc.privy.systems | Privy RPC proxies; for EVM only when a chain has a `privy` rpcUrl (1874 doesn't) | no (solana-* hosts appear in the solana bundle only) |
| explorer-api.walletconnect.com | wallet-list fetch with `projectId`, inside a hook used by connect-wallet screens (`guards-DZc6JJJZ.mjs`) | probably not; UNVERIFIED |
| relay.walletconnect.com (wss) | Solana WalletConnect, `telemetryEnabled:!1` (`solana.mjs`); EVM WC is a lazy `import("./walletconnect-v2-…")` | no if `walletConnect.enabled:false` |
| api.moonpay.com, js.stripe.com, issuing-key.stripe.com, api.relay.link, api.testnets.relay.link | funding, on-ramp, cards and bridging features | no (feature-gated, lazy chunks) |
| cdn.apple-cloudkit.com | only an origin check in the iCloud recovery screen | no |
| hCaptcha / Cloudflare Turnstile | lazy `HCaptchaWrapper` / `TurnstileWrapper`, used if captcha is on in the dashboard | only if enabled |
| @coinbase/wallet-sdk, @base-org/account | lazy chunks; Base Account gets `preference.telemetry:false` (`privy-context-D_jO1TWW.mjs`) | no (external wallets only) |
| etherscan.io, phantom.app, solflare.com, backpack.app, chrome/mozilla stores, go.cb-w.com, www.walletlink.org | links or localStorage keys only | no |

My verdict for NFR-8: no third-party trackers ship in Privy's own code. It does send **first-party product analytics to Privy**, including sign events tied to the wallet address. Whether that counts as a "tracker" is the human's call. I didn't inspect the transitive packages (WalletConnect 2.22.4, Coinbase SDK 4.3.2, `@base-org/account`); they only load lazily for external-wallet flows. The DEP-3 network-tab check is still the real test.

### Other Privy surprises
- It **pins `viem: "2.57.8"` exactly** (a dependency, not a peer). With our 2.57.13, npm will install a second, nested viem: a bigger bundle, though the types stay compatible because Privy uses its own `Chain` type.
- It pulls in a heavy dependency tree: WalletConnect 2.22.4, Coinbase wallet-sdk, `@base-org/account`, `x402`, `pino-pretty`, `styled-components`, `@stripe/crypto` and more (package.json `dependencies`). The Solana, permissionless and abstract peers are marked optional (`peerDependenciesMeta`).
- `scriptNonce` config exists for CSP nonces (`types:1903`).
- Needs a Privy app id from the dashboard, with our Vercel origins allow-listed. That is a step for the human. **UNVERIFIED** from source.

---

## Open items for Phase 1 (each needs a live check)
1. Arkiv access key: the keyless Rabdi endpoint timed out twice on 2026-11-05.
2. Ankr whitechain_testnet through the Nym exit (DEP-6), and how long the cold `ready` takes.
3. Privy embedded wallet signing EIP-712 with `domain.chainId = 1874`, and the network tab during an email login (DEP-3).
4. Decide whether Privy's first-party `analytics_events` passes NFR-8.
5. Whether `config.isolationKey` does anything on Nym.
