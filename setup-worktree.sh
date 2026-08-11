#!/bin/sh
# Link a git worktree to the main checkout's installed dependencies and local env.
#
# A fresh worktree (git worktree add, e.g. under .claude/worktrees/) contains only
# tracked files, so all four gitignored things the toolchain needs are absent - and
# each one fails in its own misleading way:
#
#   node_modules             jest dies inside setupFiles; prettier/babel unavailable
#   functions/node_modules   functions-side suites cannot resolve googleapis etc.
#   web-bundler/node_modules build-web-webpack cannot find webpack (web-bundler keeps
#                            its own lockfile); before the guard in check-node.js this
#                            printed an install prompt and exited 0 having built nothing
#   .env                     build fails with "GOOGLE_FIREBASE_WEB_API_KEY" is not
#                            defined in ... (react-native-dotenv reads it at build time)
#
# Symlinks rather than installs: npm install per worktree duplicates ~1GB and takes
# minutes, and everything here is gitignored, so the links never show up in git status.
#
# Idempotent - a link already pointing at the right place is left alone, a broken or
# stale one is repointed, and a REAL directory is never touched (so a worktree that
# genuinely ran its own npm install is safe).
#
# Usage: sh setup-worktree.sh        (from anywhere inside the worktree)
set -eu

worktree_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "setup-worktree: not inside a git repository." >&2
    exit 2
}

# --git-common-dir points at the MAIN checkout's .git even from a linked worktree;
# it may come back relative, so resolve it before taking the parent directory.
common_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd)
main_root=$(dirname "$common_dir")

if [ "$main_root" = "$worktree_root" ]; then
    echo "setup-worktree: this IS the main checkout ($main_root) - nothing to link."
    echo "Run this from a linked worktree instead (see: git worktree list)."
    exit 0
fi

echo "worktree : $worktree_root"
echo "main     : $main_root"
echo

linked=0
skipped=0
missing=0

# link <relative-path>
link() {
    rel=$1
    src="$main_root/$rel"
    dst="$worktree_root/$rel"

    if [ ! -e "$src" ]; then
        echo "  MISSING  $rel - not present in the main checkout either"
        missing=$((missing + 1))
        return 0
    fi

    if [ -L "$dst" ]; then
        current=$(readlink "$dst")
        if [ "$current" = "$src" ] && [ -e "$dst" ]; then
            echo "  ok       $rel"
            skipped=$((skipped + 1))
            return 0
        fi
        rm -f "$dst"
    elif [ -e "$dst" ]; then
        # A real file/directory - someone installed here deliberately. Never clobber.
        echo "  KEPT     $rel - real file/directory already present, left untouched"
        skipped=$((skipped + 1))
        return 0
    fi

    mkdir -p "$(dirname "$dst")"
    ln -s "$src" "$dst"
    echo "  linked   $rel"
    linked=$((linked + 1))
}

link node_modules
link functions/node_modules
link web-bundler/node_modules
link .env

echo
echo "linked $linked, already fine $skipped, missing $missing"

if [ "$missing" -gt 0 ]; then
    echo
    echo "Some sources are absent from the main checkout. Install them there and re-run:"
    echo "  (repo root)    npm ci"
    echo "  (functions/)   npm ci"
    echo "  (web-bundler/) npm install"
    echo ".env is local-only and is not created by any install step."
    exit 1
fi

echo "Worktree ready: npm test and npm run build-web-webpack should now work."
