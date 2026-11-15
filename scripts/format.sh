#!/usr/bin/env bash
# Formats the repo with pinned tools: Prettier (md, json, yaml, js, mjs) and
# shfmt (sh).
#   scripts/format.sh                   format every file
#   scripts/format.sh --check           change nothing; list unformatted files, exit 1 if any
#   scripts/format.sh PATH...           format only these files or directories
#   scripts/format.sh --list [PATH...]  print the files it would format (the pre-commit hook uses it)
# It skips the paths in .prettierignore. Prettier comes from package-lock.json
# (npm ci on first use). shfmt is downloaded on first use into .tools/ and
# checked against the SHA-256 below.
set -euo pipefail
IFS=$'\n'
set -f

SHFMT_VERSION=3.14.1

mode=format
case ${1-} in --check | --list)
  mode=${1#--}
  shift
  ;;
esac

root=$(cd "$(dirname "$0")/.." && pwd)
[ $# -gt 0 ] || cd "$root"
# Repo-root paths of the tracked and untracked, not ignored files under PATH...
files=$(git ls-files --full-name -co --exclude-standard -- "$@" | sort -u |
  awk 'NR == FNR { if (!/^(#|$)/) skip[n++] = $0; next }
    { for (i = 0; i < n; i++) if (index($0, skip[i]) == 1) next; print }' "$root/.prettierignore" - |
  grep -E '\.(md|json|ya?ml|m?js|sh)$' || true)
cd "$root"
files=$(for f in $files; do [ ! -f "$f" ] || echo "$f"; done)

if [ $mode = list ]; then
  [ -z "$files" ] || echo "$files"
  exit 0
fi

pick() { grep -E "\.($1)\$" <<<"$files" || true; }
prettier_files=$(pick 'md|json|ya?ml|m?js')
sh_files=$(pick sh)

fetch() { # URL SHA256 FILE: download once and verify
  [ ! -f "$3" ] || return 0
  mkdir -p .tools
  curl -fsSL "$1" -o "$3.part"
  if ! echo "$2  $3.part" | shasum -a 256 -c --status; then
    rm -f "$3.part"
    echo "format.sh: checksum mismatch for $1" >&2
    exit 1
  fi
  chmod +x "$3.part"
  mv "$3.part" "$3"
}

prettier() { node_modules/.bin/prettier "$@"; }
shfmt() { ".tools/shfmt-$SHFMT_VERSION" -i 2 "$@"; }

if [ -n "$prettier_files" ] && [ ! -x node_modules/.bin/prettier ]; then
  npm ci --no-audit --no-fund --loglevel=error
fi
if [ -n "$sh_files" ]; then
  # ponytail: only the Mac's and CI's platforms are pinned; add a line per new platform.
  case $(uname -s)_$(uname -m) in
  Darwin_arm64) platform=darwin_arm64 sha=b7c872db63553ccffc7253aba3ed7d4885a27d83f1ba567b1138c6315a5847e5 ;;
  Linux_x86_64) platform=linux_amd64 sha=76e77641faa025814b77f153b29796b8e6fa2fca03e0c76a691608b86c7ea7bf ;;
  *)
    echo "format.sh: no pinned shfmt for $(uname -sm); add its SHA-256 to this script" >&2
    exit 1
    ;;
  esac
  fetch "https://github.com/mvdan/sh/releases/download/v$SHFMT_VERSION/shfmt_v${SHFMT_VERSION}_$platform" \
    $sha ".tools/shfmt-$SHFMT_VERSION"
fi

if [ $mode = check ]; then
  fail=0
  # Prints the files a tool lists as unformatted; fails on any, or on a tool error.
  check() {
    local out
    out=$("$@") || fail=1
    [ -z "$out" ] || { echo "$out" && fail=1; }
  }
  [ -z "$prettier_files" ] || check prettier --list-different $prettier_files
  [ -z "$sh_files" ] || check shfmt -l $sh_files
  [ $fail = 0 ] || echo "format.sh: run scripts/format.sh to fix the files above" >&2
  exit $fail
fi

[ -z "$prettier_files" ] || prettier --write --log-level=warn $prettier_files
[ -z "$sh_files" ] || shfmt -w $sh_files
