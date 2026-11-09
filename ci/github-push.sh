#!/bin/sh
#
# Mirror master to the two GitHub repositories.
#
#   origin_github      kwkrass/alldone          full history, pushed as-is
#   alldoneapp_github  alldoneapp/alldoneapp    history truncated at CUTOFF_DATE, replayed
#                                               as a fresh root so nothing before that date
#                                               is published, with authorship preserved
#
# WHY THIS LOOKS DIFFERENT NOW
#
# This used to run inside build_web_production's before_script, which is why that ~9-minute
# production build carried `interruptible: false` and therefore could not be auto-cancelled:
# every superseded master push still paid for a full production build purely to reach this
# script. It is now its own job (`mirror:github`), so the build is cancellable again.
#
# The truncated mirror also used to be rebuilt from scratch on every single deploy: an
# orphan branch plus a `git checkout <commit> -- . && git add -A && git commit` loop over
# every commit since the cutoff - 2,524 of them and growing, each one a full worktree
# rewrite. It now uses `git commit-tree`, which writes the commit object directly from the
# original tree and never touches the worktree, and it appends only the NEW commits on top
# of what the mirror already has. The old loop also silently dropped file deletions
# (`git checkout <c> -- .` restores files but never removes them, and `git add -A` then has
# nothing to notice), so the mirror slowly accumulated files master had deleted; taking the
# tree wholesale fixes that by construction.
#
# The incremental path is keyed on the `deployed/github-mirror` marker (see
# ci/deployScope.sh). If the marker is missing, unreachable, or the resulting push is not a
# fast-forward - anything that means "the mirror is not where we think it is" - it falls
# back to the full rebuild and force-push, so the mirror is always self-correcting.

set -e

echo "Starting GitHub push process..."

CUTOFF_DATE="${GITHUB_MIRROR_CUTOFF_DATE:-2025-08-28T00:00:00Z}"
MIRROR_MARKER="github-mirror"
SCRIPT_DIR="$(dirname "$0")"

# Configure git
git config --global user.email "karsten@alldone.app"
git config --global user.name "Alldone CI"

# Add remotes with credential-free URLs. The tokens are supplied by URL-scoped
# credential helpers that read the environment only when git authenticates, so
# no secret ever appears in remote URLs, process command lines, or GIT_TRACE
# output (the old token-in-URL form leaked the PAT into job logs via the
# verbose retry below).
ORIGIN_GITHUB_URL="https://github.com/kwkrass/alldone.git"
ALLDONEAPP_GITHUB_URL="https://github.com/alldoneapp/alldoneapp.git"
git remote add origin_github "$ORIGIN_GITHUB_URL" 2>/dev/null || git remote set-url origin_github "$ORIGIN_GITHUB_URL"
git remote add alldoneapp_github "$ALLDONEAPP_GITHUB_URL" 2>/dev/null || git remote set-url alldoneapp_github "$ALLDONEAPP_GITHUB_URL"
git config --global "credential.${ORIGIN_GITHUB_URL}.helper" '!f() { echo "username=${GITHUB_USER}"; echo "password=${GITHUB_TOKEN}"; }; f'
git config --global "credential.${ALLDONEAPP_GITHUB_URL}.helper" '!f() { echo "username=${GITHUB_USER_ALLDONEAPP}"; echo "password=${GITHUB_TOKEN_ALLDONEAPP}"; }; f'

# The job sets GIT_DEPTH: 0 so the checkout is already complete. Keep the unshallow as a
# fallback for a runner that ignored it - pushing a truncated history to a full repository
# is rejected, and the old `gc`/`repack` dance existed only to survive that.
if [ -f "$(git rev-parse --git-dir)/shallow" ]; then
    echo "Checkout is shallow; fetching full history..."
    git fetch --unshallow origin || git fetch --deepen=100000 origin || true
fi
git fetch origin master || true

ORIGINAL_HEAD=$(git rev-parse HEAD)
echo "Mirroring $ORIGINAL_HEAD"

# ---------------------------------------------------------------------------
# 1. Full-history mirror
# ---------------------------------------------------------------------------

git fetch origin_github master || true

MAX_ATTEMPTS=3
DELAY=5
ATTEMPT=1
PUSH_SUCCESS=0
while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
    echo "Pushing to origin_github (attempt $ATTEMPT/$MAX_ATTEMPTS)..."
    if [ "$ATTEMPT" -eq 2 ]; then
        echo "Enabling verbose git trace for diagnostics on attempt $ATTEMPT"
        GIT_TRACE=1 GIT_CURL_VERBOSE=1 git push --force-with-lease origin_github "$ORIGINAL_HEAD:master" && PUSH_SUCCESS=1 && break || true
    else
        git push --force-with-lease origin_github "$ORIGINAL_HEAD:master" && PUSH_SUCCESS=1 && break || true
    fi
    echo "Push attempt $ATTEMPT failed, retrying in ${DELAY}s..."
    sleep "$DELAY"
    ATTEMPT=$((ATTEMPT + 1))
    DELAY=$((DELAY * 2))
done
if [ "$PUSH_SUCCESS" -ne 1 ]; then
    echo "WARNING: Failed to push to origin_github after $MAX_ATTEMPTS attempts. Continuing pipeline."
fi

# ---------------------------------------------------------------------------
# 2. Truncated mirror
# ---------------------------------------------------------------------------

CUTOFF_COMMIT=$(git rev-list --max-count=1 --before="$CUTOFF_DATE" "$ORIGINAL_HEAD" || true)
if [ -z "$CUTOFF_COMMIT" ]; then
    echo "WARNING: no commit found before $CUTOFF_DATE, so the truncated mirror cannot be"
    echo "         built without publishing history it is meant to withhold. Skipping it."
    exit 0
fi
echo "Cutoff commit (last commit before $CUTOFF_DATE): $CUTOFF_COMMIT"

# Rewrite BASE..ORIGINAL_HEAD on top of PARENT and print the resulting commit.
# An empty PARENT starts a fresh root commit, which is what truncates the history.
# Logs go to stderr so stdout carries only the resulting sha.
replay_range() {
    base="$1"
    parent="$2"
    msg_file=$(mktemp)
    count=0

    for commit in $(git rev-list --reverse "${base}..${ORIGINAL_HEAD}"); do
        # One call for all the metadata (%T is the tree), one for the raw message body.
        meta=$(git log -1 --format='%T%x09%an%x09%ae%x09%aI%x09%cn%x09%ce%x09%cI' "$commit")
        tree=$(echo "$meta" | cut -f1)
        GIT_AUTHOR_NAME=$(echo "$meta" | cut -f2)
        GIT_AUTHOR_EMAIL=$(echo "$meta" | cut -f3)
        GIT_AUTHOR_DATE=$(echo "$meta" | cut -f4)
        GIT_COMMITTER_NAME=$(echo "$meta" | cut -f5)
        GIT_COMMITTER_EMAIL=$(echo "$meta" | cut -f6)
        GIT_COMMITTER_DATE=$(echo "$meta" | cut -f7)
        export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE
        export GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE

        git log -1 --format=%B "$commit" >"$msg_file"

        if [ -n "$parent" ]; then
            parent=$(git commit-tree "$tree" -p "$parent" -F "$msg_file")
        else
            parent=$(git commit-tree "$tree" -F "$msg_file")
        fi
        count=$((count + 1))
    done

    rm -f "$msg_file"
    unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE
    unset GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE
    echo "Replayed $count commit(s)." >&2
    echo "$parent"
}

full_rebuild_and_force_push() {
    echo "Rebuilding the truncated mirror from $CUTOFF_COMMIT..."
    rebuilt=$(replay_range "$CUTOFF_COMMIT" "")
    if [ -z "$rebuilt" ]; then
        echo "WARNING: nothing to mirror after the cutoff. Leaving the mirror untouched."
        return 1
    fi
    git push --force alldoneapp_github "$rebuilt:master"
}

git fetch alldoneapp_github master || true
# Read the mirror's tip explicitly rather than relying on FETCH_HEAD, which the
# origin_github fetch above also writes - a failed fetch here would otherwise leave us
# appending onto the wrong repository's commit.
MIRROR_TIP=$(git ls-remote alldoneapp_github refs/heads/master 2>/dev/null | awk 'NR == 1 { print $1 }')

LAST_MIRRORED=""
if [ -x "$SCRIPT_DIR/deployScope.sh" ] || [ -f "$SCRIPT_DIR/deployScope.sh" ]; then
    LAST_MIRRORED=$(sh "$SCRIPT_DIR/deployScope.sh" marker-read "$MIRROR_MARKER" 2>/dev/null || true)
fi

MIRROR_PUSHED=0

if [ -n "$LAST_MIRRORED" ] &&
    git cat-file -e "${LAST_MIRRORED}^{commit}" 2>/dev/null &&
    git merge-base --is-ancestor "$LAST_MIRRORED" "$ORIGINAL_HEAD" 2>/dev/null &&
    [ -n "$MIRROR_TIP" ] &&
    git cat-file -e "${MIRROR_TIP}^{commit}" 2>/dev/null; then

    if [ "$LAST_MIRRORED" = "$ORIGINAL_HEAD" ]; then
        echo "Truncated mirror is already at $ORIGINAL_HEAD; nothing to append."
        MIRROR_PUSHED=1
    else
        echo "Appending $LAST_MIRRORED..$ORIGINAL_HEAD on top of mirror tip $MIRROR_TIP"
        APPENDED=$(replay_range "$LAST_MIRRORED" "$MIRROR_TIP")
        # A plain (non-force) push: if the mirror is not where the marker claims, this
        # is rejected rather than clobbering it, and the full rebuild below takes over.
        if [ -n "$APPENDED" ] && git push alldoneapp_github "$APPENDED:master"; then
            MIRROR_PUSHED=1
        else
            echo "Incremental mirror push was rejected; falling back to a full rebuild."
        fi
    fi
else
    echo "No usable $MIRROR_MARKER marker; doing a full rebuild of the truncated mirror."
fi

if [ "$MIRROR_PUSHED" -ne 1 ]; then
    if full_rebuild_and_force_push; then
        MIRROR_PUSHED=1
    else
        echo "WARNING: could not update the truncated mirror."
    fi
fi

if [ "$MIRROR_PUSHED" -eq 1 ]; then
    sh "$SCRIPT_DIR/deployScope.sh" record "$MIRROR_MARKER" || true
fi

echo "GitHub push process completed"
