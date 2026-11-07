// Bundles the service (and the packages/mcp tool code it reuses) into ONE self-contained file, api/index.mjs, which is the
// Vercel function (see vercel.json: every path rewrites to it, as apps/relayer does). Nothing is resolved at request time
// and the deployment does not depend on the repo layout or on TypeScript being run. Run: npm run build
//
// packages/mcp's sources import zod and the MCP SDK by bare name. On Vercel only apps/mcp's dependencies are installed, so
// those imports are resolved from apps/mcp/node_modules (nodePaths); the two packages pin the same versions, and a build
// without packages/mcp/node_modules is how this is tested.
import { resolve } from "node:path";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "api/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  nodePaths: [resolve("node_modules")],
  // some bundled CommonJS dependencies call require(): give the ESM output one
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
