#!/usr/bin/env bash
# Vercel "Ignored Build Step" for each project (run from its root dir, e.g. apps/web):
#   bash ../../tools/vercel-ignore.sh . ../../packages || exit 1
# Exit 0 = skip the build (nothing under the given paths changed since the last deploy); 1 = build.
# Builds whenever unsure: no previous deploy, or the previous commit isn't in Vercel's shallow clone and can't be fetched.
P="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$P" ] || exit 1
git cat-file -e "$P^{commit}" 2>/dev/null || git fetch -q --depth=1 origin "$P" 2>/dev/null || exit 1
git cat-file -e "$P^{commit}" 2>/dev/null || exit 1
git diff --quiet "$P" HEAD -- "$@" && exit 0
exit 1
