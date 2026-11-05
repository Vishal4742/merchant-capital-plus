# Arkiv friction log (25% of the Arkiv score)

Logged as it happens, with how to reproduce each problem. Known before we started (research, 2026-11-05):
- SDK 1.0.0 removed payloads and `buildQuery()`; the docs still show older helpers, so AI agents trained on the old API write wrong calls. We read the SDK source instead.
- Public RPC rate limits (429) with reported hangs; batch writes over ~128 KB fail with a misleading error.

| When | What happened | Repro | Workaround |
|---|---|---|---|
| ⟨…⟩ | | | |
