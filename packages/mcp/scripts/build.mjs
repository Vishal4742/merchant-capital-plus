// Bundles the server and the sandbox CLI into dist/bundle/server/*.mjs with esbuild: one file each, every runtime
// dependency inside, so the .mcpb ships no node_modules and no dev-only package. Also writes the bundled packages'
// licences, and fails if any machine-specific path (this checkout, the home folder) ended up in the output.
// Usage: node scripts/build.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const root = fileURLToPath(new URL("..", import.meta.url));
export const bundleDir = join(root, "dist", "bundle");

/** Each bundled npm package (the innermost node_modules segment of every input) with its licence text. */
function licences(inputs) {
  const dirs = new Map();
  for (const input of inputs) {
    const parts = input.split(/[\\/]/);
    const at = parts.lastIndexOf("node_modules");
    if (at < 0) continue;
    const name = parts[at + 1].startsWith("@") ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1];
    dirs.set(name, join(root, ...parts.slice(0, at + 1), ...name.split("/")));
  }
  return [...dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
    return { name, version: pkg.version, license: pkg.license ?? "see text", text: file ? readFileSync(join(dir, file), "utf8").trim() : `(${pkg.license}; no licence file shipped in the package)` };
  });
}

export async function buildServer() {
  rmSync(join(root, "dist"), { recursive: true, force: true });
  mkdirSync(join(bundleDir, "server"), { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: { index: "src/index.ts", "sandbox-cli": "src/sandbox/cli.ts" },
    outdir: join(bundleDir, "server"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // some bundled CommonJS calls require() for Node built-ins
    banner: { js: 'import { createRequire as __wfRequire } from "node:module";\nconst require = __wfRequire(import.meta.url);' },
    legalComments: "none", // the licences go to THIRD_PARTY_LICENSES instead
    metafile: true,
    charset: "utf8",
    logLevel: "warning",
  });

  const forbidden = [root, root.replaceAll("\\", "/"), homedir(), homedir().replaceAll("\\", "/")].filter((p) => p.length > 3);
  for (const file of readdirSync(join(bundleDir, "server"))) {
    const text = readFileSync(join(bundleDir, "server", file), "utf8");
    const hit = forbidden.find((p) => text.includes(p));
    if (hit) throw new Error(`${file} contains a machine-specific path; refusing to package it.`);
  }

  const own = readFileSync(join(root, "THIRD_PARTY_LICENSES"), "utf8").trim();
  const bundled = licences(Object.keys(result.metafile.inputs));
  const text = [
    own,
    "",
    "=".repeat(80),
    "Bundled into server/index.mjs and server/sandbox-cli.mjs by esbuild (scripts/build.mjs):",
    ...bundled.map((p) => `- ${p.name} ${p.version} (${p.license})`),
    ...bundled.flatMap((p) => ["", "-".repeat(80), `${p.name} ${p.version}`, "-".repeat(80), p.text]),
    "",
  ].join("\n");
  writeFileSync(join(bundleDir, "THIRD_PARTY_LICENSES"), text);

  // a CycloneDX SBOM of what is inside the bundle (production review F8). Deterministic: no timestamp, and the serial
  // number is derived from the component list, so the same source gives the same bytes.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const components = bundled.map((p) => ({ type: "library", name: p.name, version: p.version, purl: `pkg:npm/${p.name.replace("@", "%40")}@${p.version}`, licenses: [{ expression: p.license }] }));
  const digest = createHash("sha256").update(JSON.stringify(components)).digest("hex");
  const serial = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.5", serialNumber: serial, version: 1, metadata: { component: { type: "application", name: "whiteflow-merchant", version: pkg.version, licenses: [{ expression: pkg.license }] } }, components };
  writeFileSync(join(bundleDir, "sbom.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
  return { files: readdirSync(join(bundleDir, "server")), packages: bundled.map((p) => `${p.name}@${p.version}`) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files, packages } = await buildServer();
  process.stdout.write(`built ${files.join(", ")} (bundled: ${packages.join(", ")})\n`);
  if (!existsSync(join(bundleDir, "server", "index.mjs"))) process.exit(1);
}
