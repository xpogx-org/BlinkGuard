#!/bin/sh
# harness-stock: true
exec node "$(dirname "$0")/harness-verify.mjs" "$@"
