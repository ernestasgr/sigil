#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GH_TOKEN:-}" ]]; then
    echo 'GH_TOKEN is required for an authenticated push.' >&2
    exit 1
fi

authorization="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 --wrap=0)"
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic ${authorization}" push "$@"
