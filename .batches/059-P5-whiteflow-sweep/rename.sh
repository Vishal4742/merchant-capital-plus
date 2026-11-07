#!/usr/bin/env bash
# Batch 059: the Whiteflow wording sweep (rules in spec.md). Idempotent; run from the repo root on the final main.
# Prints each file it changed. Never touches contracts/src (verified source), lockfiles (except the sdk's name) or .gitignore.
set -euo pipefail
[ -f PIPELINE.md ] || { echo "run from the repo root"; exit 1; }
OLD='Merchant Capital\+|MERCHANT CAPITAL\+|Merchant Capital Plus|WhiteFlow|@merchant-capital/sdk|Vishal4742/merchant-capital-plus|cd merchant-capital-plus|claude mcp add merchant-capital '
git grep -l -I -E "$OLD" -- ':!contracts/src/**' ':!**/package-lock.json' ':!.gitignore' ':!.batches/059-P5-whiteflow-sweep/**' \
| while IFS= read -r f; do
  perl -pi -e '
    s/Merchant Capital\+/Whiteflow/g; s/MERCHANT CAPITAL\+/WHITEFLOW/g; s/Merchant Capital Plus/Whiteflow/g;
    s/WhiteFlow/Whiteflow/g; s#\@merchant-capital/sdk#\@whiteflow/sdk#g;
    s#Vishal4742/merchant-capital-plus#Vishal4742/whiteflow#g; s/\bcd merchant-capital-plus\b/cd whiteflow/g;
    s/claude mcp add merchant-capital /claude mcp add whiteflow /g;
  ' "$f"
  echo "$f"
done
# the sdk lockfile names the package twice (root and packages[""]); nothing else in any lockfile changes
if [ -f packages/sdk/package-lock.json ]; then perl -pi -e 's#"\@merchant-capital/sdk"#"\@whiteflow/sdk"#g' packages/sdk/package-lock.json; fi
