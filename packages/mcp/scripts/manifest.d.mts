// Types for scripts/manifest.mjs (used by test/package.test.ts).
export function buildManifest(): Promise<Record<string, unknown>>;
export function manifestText(): Promise<string>;
