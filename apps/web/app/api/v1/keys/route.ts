// POST /api/v1/keys {label, kind: "pk"|"sk"} → the new key, shown once · GET /api/v1/keys → the merchant's live keys
// (no key, no hash). Dashboard only: the SIWE session cookie (SRS FR-GW-6).
import { HttpError, handle, ok, readJson, signedInMerchant, textField } from "../../../../lib/server/http.ts";
import { createKey, keyJson, listKeys, type KeyKind } from "../../../../lib/server/keys.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const body = await readJson(request);
    const label = textField(body.label, "label", { max: 60 });
    const kind = body.kind ?? "sk";
    if (kind !== "pk" && kind !== "sk") throw new HttpError(400, 'kind must be "pk" or "sk".');
    const { key, record } = await createKey(merchant, label, kind as KeyKind);
    return ok({ ...keyJson(record), key }, 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    return ok({ keys: (await listKeys(merchant)).map(keyJson) });
  });
}
