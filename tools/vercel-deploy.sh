#!/usr/bin/env bash
# Run by .github/workflows/deploy.yml, once per project: tools/vercel-deploy.sh web|relayer|shop.
# If the project's paths changed since the last successful deploy run (or FORCE=1, or there is no usable previous
# run), builds main here and deploys it to production (prebuilt). Then checks that every production domain of the
# project serves that new deployment, so a domain left on another project or an old build fails the run.
set -euo pipefail
name=${1:?usage: vercel-deploy.sh web|relayer|shop}
[ -n "${VERCEL_TOKEN:-}" ] || { echo "::error::VERCEL_TOKEN secret is not set"; exit 1; }
export VERCEL_ORG_ID=team_f3vbqdrWJjxwwM7g2dphSQcM # arthurgreycode-2623's projects
vercel() { npx --yes vercel@65.12.1 "$@" --token "$VERCEL_TOKEN"; }

case $name in
  web)     export VERCEL_PROJECT_ID=prj_qf25l7Cwd8u2Ye9tL1Rlfi6dBjNS; paths=(apps/web packages);     domains=(whiteflow.org whiteflow-app.vercel.app) ;;
  relayer) export VERCEL_PROJECT_ID=prj_UyTxbpvs4friw4Jt2JsQv6EadHY0; paths=(apps/relayer packages); domains=(relayer.whiteflow.org whiteflow-relayer.vercel.app) ;;
  shop)    export VERCEL_PROJECT_ID=prj_KpTcfBJexGJA6yP2EeIxIC9xFmmv; paths=(apps/shop packages);    domains=(shop.whiteflow.org whiteflow-shop.vercel.app) ;;
  *) echo "::error::unknown project '$name' (web, relayer or shop)"; exit 1 ;;
esac

base=$(gh run list --workflow deploy.yml --branch main --status success --limit 1 --json headSha -q '.[0].headSha // empty')
if [ -n "$base" ] && ! git cat-file -e "$base^{commit}" 2>/dev/null; then base=; fi
echo "last successful deploy run: ${base:-none}"
if [ "${FORCE:-0}" != 1 ] && [ -n "$base" ] && git diff --quiet "$base" HEAD -- "${paths[@]}"; then
  echo "$name: unchanged since $base, not deployed"
  exit 0
fi

rm -rf .vercel
vercel pull --yes --environment=production
vercel build --prod
url=$(vercel deploy --prebuilt --prod)
echo "$name: deployed $url"

# `vercel inspect` resolves a domain to the deployment it serves; its "id" line is that deployment's id.
# awk reads all of it (an early exit would SIGPIPE the CLI) and `|| true` keeps a CLI error from ending the script
# under `set -e -o pipefail`: an empty id is handled below, with a message.
id_of() { { vercel inspect "$1" 2>&1 || true; } | awk '$1 == "id" && !id { id = $2 } END { print id }'; }
want=$(id_of "$url")
[ -n "$want" ] || { echo "::error::$name: can't read the new deployment's id from $url"; exit 1; }
status=0
for d in "${domains[@]}"; do
  got=
  for _ in 1 2 3 4 5 6; do # aliases move within seconds of --prod; allow up to a minute
    got=$(id_of "$d")
    [ "$got" = "$want" ] && break
    sleep 10
  done
  if [ "$got" = "$want" ]; then
    echo "$name: $d serves $want"
  elif [ -z "$got" ] && code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "https://$d/") && [ "${code:0:1}" = 2 ]; then
    echo "::warning::$name: vercel inspect can't resolve $d; it answers HTTP $code, but check by hand that it serves $want"
  else
    echo "::error::$name: $d serves ${got:-nothing} instead of the new deployment $want (is the domain on project $name?)"
    status=1
  fi
done
exit $status
