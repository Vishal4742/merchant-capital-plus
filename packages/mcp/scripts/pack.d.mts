// Types for scripts/pack.mjs (used by test/package.test.ts).
export const archive: string;
export function pack(): Promise<{ archive: string; digest: string; contents: string; files: string[]; validated: string; packed: string; info: string }>;
