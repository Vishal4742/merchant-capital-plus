// Bundles the service (and the packages/mcp tool code it reuses) into one file, dist/index.mjs, so a deployment doesn't
// depend on the repo layout or on TypeScript being run at request time. Run: npm run build
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  // some bundled CommonJS dependencies call require(): give the ESM output one
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
