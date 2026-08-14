#!/bin/sh
# Fetch the default branch and guarantee it shares a merge base with the commit
# under test, deepening the shallow CI clone only as far as that takes.
#
# GitLab clones with `git depth 50`, and a plain fetch of the default branch
# inherits that boundary. A branch whose fork point is older than the boundary
# then has no common ancestor locally, `git diff base...HEAD` fails, and the
# targeted selection comes back empty - which used to leave test:web:changed
# green while running nothing. Deepening here keeps that case a working run
# instead of relying on selectTargetedJestFiles.js to fail the job.
#
# Runs on busybox sh (ci/Dockerfile_base is Alpine); keep it POSIX.
set -eu

branch="${1:-}"
head_ref="${2:-HEAD}"

if [ -z "$branch" ]; then
    echo "usage: sh ci/ensureMergeBase.sh <default-branch> [head-ref]" >&2
    exit 2
fi

remote_ref="origin/$branch"

# A merge base needs history on both sides, so deepen the branch under test
# alongside the default branch.
refspecs="+refs/heads/$branch:refs/remotes/origin/$branch"
if [ -n "${CI_COMMIT_BRANCH:-}" ] && [ "$CI_COMMIT_BRANCH" != "$branch" ]; then
    refspecs="$refspecs +refs/heads/$CI_COMMIT_BRANCH:refs/remotes/origin/$CI_COMMIT_BRANCH"
fi

have_merge_base() {
    git merge-base "$remote_ref" "$head_ref" >/dev/null 2>&1
}

is_shallow() {
    [ "$(git rev-parse --is-shallow-repository)" = "true" ]
}

report_and_exit() {
    echo "Merge base with $remote_ref: $(git merge-base "$remote_ref" "$head_ref")"
    exit 0
}

# Intentionally unquoted: $refspecs may carry two refspecs. Statuses are checked
# explicitly rather than left to `set -e`, whose behaviour varies by shell.
# shellcheck disable=SC2086
if ! git fetch --no-tags --quiet origin $refspecs; then
    echo "ERROR: could not fetch $branch from origin; the targeted Jest selection has no comparison point." >&2
    exit 1
fi

if have_merge_base; then
    report_and_exit
fi

for depth in 250 1000; do
    if ! is_shallow; then
        break
    fi
    echo "No merge base with $remote_ref yet; deepening the shallow clone by $depth commits..."
    # shellcheck disable=SC2086
    if ! git fetch --no-tags --quiet --deepen="$depth" origin $refspecs; then
        break
    fi
    if have_merge_base; then
        report_and_exit
    fi
done

if is_shallow; then
    echo "Still no merge base; fetching the complete history of $branch and the current branch..."
    # shellcheck disable=SC2086
    git fetch --no-tags --quiet --unshallow origin $refspecs || true
    if have_merge_base; then
        report_and_exit
    fi
fi

echo "ERROR: $head_ref and $remote_ref have no common ancestor even with the full history." >&2
echo "The targeted Jest selection cannot be computed, so this job would test nothing." >&2
exit 1
