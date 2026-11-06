// A small JSON file shared by processes (the MCP server and the sandbox CLI): every read-modify-write holds an
// exclusive lock file (O_EXCL create) and writes atomically (temp file + rename), so a crash leaves the old or the
// new state, never half of one. Files are created owner-only (0600; on Windows the user profile's ACL applies).
// ponytail: one lock per file and whole-file rewrites: fine for a single merchant's sandbox and a key journal; the
// real records live in the backend's Postgres.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const LOCK_WAIT_MS = 5_000;
const STALE_LOCK_MS = 30_000; // a holder never keeps the lock this long; one this old was left by a killed process
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class StateError extends Error {
  readonly expose = true;
}

function lock(file: string): () => void {
  const path = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(path, "wx", 0o600));
      return () => rmSync(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS) rmSync(path, { force: true });
      } catch {
        // gone between the two calls: try again
      }
      if (Date.now() > deadline) throw new StateError(`${file} is locked by another WhiteFlow process. Try again in a moment.`);
      sleepSync(25);
    }
  }
}

function read<T>(file: string, initial: () => T): T {
  if (!existsSync(file)) return initial();
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    throw new StateError(`${file} is damaged (not valid JSON). Move it aside to start fresh; nothing was changed.`);
  }
}

function write(file: string, value: unknown): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  for (let tries = 0; ; tries++) {
    try {
      renameSync(temp, file);
      return;
    } catch (error) {
      // Windows: a virus scanner or indexer can hold the target for a moment
      if (tries >= 20 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      sleepSync(25);
    }
  }
}

/** Runs `change` on the file's current value under the lock and stores what it returns as `next`. */
export function transact<T, R>(file: string, initial: () => T, change: (state: T) => { next?: T; result: R }): R {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const release = lock(file);
  try {
    const { next, result } = change(read(file, initial));
    if (next !== undefined) write(file, next);
    return result;
  } finally {
    release();
  }
}

/** The current value, read under the lock. */
export const snapshot = <T>(file: string, initial: () => T): T => transact(file, initial, (state) => ({ result: state }));
