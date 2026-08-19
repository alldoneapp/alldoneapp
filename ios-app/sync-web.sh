#!/bin/sh
# Copies the production web build into the Capacitor webDir and syncs it into
# the native iOS project. Run `npm run build-web-webpack` at the repo root
# first (that is the single source of truth for what ships on every platform).
set -e
cd "$(dirname "$0")"

if [ ! -f ../web-build/index.html ]; then
    echo "ERROR: ../web-build/index.html not found — run 'npm run build-web-webpack' at the repo root first." >&2
    exit 1
fi

rm -rf www
cp -R ../web-build www
npx cap sync ios
