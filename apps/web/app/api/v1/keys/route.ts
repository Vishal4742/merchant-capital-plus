// POST /api/v1/keys {label, kind: "pk"|"sk"} → the new key, shown once · GET /api/v1/keys → the merchant's live keys
// (no key, no hash). Dashboard only: an Owner of the workspace that linked the merchant wallet (SRS FR-GW-6; batch 051
// R2-1 keys:manage).
import { HttpError, handle, ok, readJson, textField } from "../../../../lib/server/http.ts";
import { createKey, keyJson, listKeys, type KeyKind } from "../../../../lib/server/keys.ts";
import { auditV1, legacyAccess } from "../../../../lib/server/legacy.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const access = await legacyAccess(request, "keys:manage");
    const body = await readJson(request);
    const label = textField(body.label, "label", { max: 60 });
    const kind = body.kind ?? "sk";
    if (kind !== "pk" && kind !== "sk") throw new HttpError(400, 'kind must be "pk" or "sk".');
    const { key, record } = await createKey(access.merchant, label, kind as KeyKind);
    await auditV1(access, "keys.create", record.id);
    return ok({ ...keyJson(record), key }, 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "keys:manage");
    return ok({ keys: (await listKeys(merchant)).map(keyJson) });
  });
}
