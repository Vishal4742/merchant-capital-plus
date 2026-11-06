// WhiteFlow v2 API helpers (batch 050): one wrapper so a database outage answers 503 "nothing changed" (fail closed,
// 032 acceptance 15) instead of a generic 500, plus the body reader the v2 routes share.
import { DbUnavailable } from "./db.ts";
import { HttpError, handle, readJson } from "./http.ts";

export const DB_DOWN = "WhiteFlow can't reach its database right now. Nothing changed. Try again in a minute.";

/** Connection-level failures (not SQL errors): unset DATABASE_URL, the Neon driver's fetch failure, Postgres classes
 *  08 (connection), 53 (resources), 57P0x (shutdown). */
export function isDbDown(err: unknown): boolean {
  if (err instanceof DbUnavailable) return true;
  const e = (typeof err === "object" && err !== null ? err : {}) as { name?: unknown; code?: unknown; sourceError?: unknown };
  if (e.name === "NeonDbError" && e.sourceError !== undefined) return true;
  return typeof e.code === "string" && /^(08...|53...|57P0[123])$/.test(e.code);
}

export function v2(run: () => Promise<Response>): Promise<Response> {
  return handle(async () => {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof HttpError) && isDbDown(err)) throw new HttpError(503, DB_DOWN);
      throw err;
    }
  });
}

export const body = (request: Request) => readJson(request, 8_192);
