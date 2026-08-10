#!/bin/sh
#
# Refuse to deploy from a pipeline whose commit is no longer the tip of its branch.
#
# WHY THIS EXISTS
#
# Every deployment here is last-writer-wins over a whole environment, and nothing in the
# pipeline enforces an order:
#
#   - `workflow.auto_cancel.on_new_commit: interruptible` correctly keeps deploy jobs
#     (`interruptible: false`) alive when a newer commit lands, so a superseded pipeline
#     still has a live deploy job sitting in the queue;
#   - `resource_group` prevents two deploys running CONCURRENTLY, but says nothing about
#     which one runs LAST. The older pipeline's job simply wins if it is scheduled last.
#
# That is not a theoretical race. `firebase deploy --only functions --force` treats the
# source it is deploying as the desired state and PRUNES every function absent from it, so
# a stale pipeline deletes functions a newer commit added and reverts the rest — while every
# Cloud audit entry reads "ok", because from Firebase's point of view nothing failed.
#
# It happened in production on 2026-08-10 (AT-2221). A stale master pipeline deleted two
# freshly shipped callables and reverted a third:
#
#   10:11:53  UpdateFunction  getVmAgentSettings      ok   <- reverted to pre-feature code
#   10:17:37  DeleteFunction  getVmAgentModelOptions  ok   <- deleted
#   10:17:40  DeleteFunction  setDefaultVmAgentModel  ok   <- deleted
#   10:23:23  (a newer pipeline put all three back)
#
# A user loading the feature inside that window got a silently broken screen.
#
# WHAT THIS DOES
#
# Compares this pipeline's commit against the live tip of the branch it was created for,
# read from the remote at the moment of the deploy (not at pipeline start — a newer commit
# can land while an earlier stage is still building, which is exactly what happened above).
#
# EXIT CODES
#
#   0   this commit is the branch tip; the deploy may proceed
#   75  superseded by a newer commit; the deploy is skipped on purpose. Callers declare this
#       an allowed failure (`allow_failure.exit_codes: 75`) so the job is VISIBLY skipped in
#       the pipeline graph without turning an otherwise-correct pipeline red. Deliberately
#       not exit 0: a deploy job that reports success without deploying is the same trap as
#       the `xargs -r` no-op this repo already had in test:web:changed.
#   1   the tip could not be determined. Fails CLOSED: not deploying is recoverable with a
#       job retry, whereas an out-of-order deploy silently reverts production.
#
# ESCAPE HATCH
#
#   ALLOW_STALE_DEPLOY=1 forces the deploy through (re-deploying an older commit on purpose,
#   e.g. a rollback). It is logged loudly.

set -eu

BRANCH="${CI_COMMIT_BRANCH:-}"
SHA="${CI_COMMIT_SHA:-}"
LABEL="${1:-deploy}"

log() {
    echo "newest-commit guard [$LABEL]: $1"
}

if [ -z "$BRANCH" ] || [ -z "$SHA" ]; then
    log "ERROR: CI_COMMIT_BRANCH and CI_COMMIT_SHA must both be set (got branch='$BRANCH')."
    log "This guard is only meaningful on a branch pipeline."
    exit 1
fi

# `git ls-remote` is the primary probe: GitLab points `origin` at an authenticated URL
# carrying the job token, so it needs no extra credentials. Not every deploy image ships
# git though (build_firebase is node:*-alpine), hence the HTTP fallbacks.
remote_tip_via_git() {
    command -v git >/dev/null 2>&1 || return 1
    git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | awk 'NR == 1 { print $1 }'
}

# The branch API returns {"name":...,"commit":{"id":"<sha>",...},...}. Splitting on JSON
# punctuation and matching a bare 40-hex id avoids depending on a JSON parser being present.
extract_commit_id() {
    tr ',{}' '\n\n\n' | sed -n 's/^"id":"\([0-9a-f]\{40\}\)"$/\1/p' | head -n 1
}

remote_tip_via_api() {
    [ -n "${CI_API_V4_URL:-}" ] && [ -n "${CI_PROJECT_ID:-}" ] && [ -n "${CI_JOB_TOKEN:-}" ] || return 1
    url="${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/repository/branches/${BRANCH}"

    if command -v curl >/dev/null 2>&1; then
        curl -sSf -H "JOB-TOKEN: ${CI_JOB_TOKEN}" "$url" 2>/dev/null | extract_commit_id
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- --header="JOB-TOKEN: ${CI_JOB_TOKEN}" "$url" 2>/dev/null | extract_commit_id
    else
        return 1
    fi
}

TIP="$(remote_tip_via_git || true)"
if [ -z "$TIP" ]; then
    TIP="$(remote_tip_via_api || true)"
fi

if [ -z "$TIP" ]; then
    log "ERROR: could not read the tip of '$BRANCH' from the remote."
    log "Tried: git ls-remote, then the GitLab branches API (curl/wget)."
    log "Refusing to deploy rather than risk overwriting a newer deployment."
    log "If the image lacks git, curl and wget, install one of them or set ALLOW_STALE_DEPLOY=1."
    exit 1
fi

if [ "$TIP" = "$SHA" ]; then
    log "OK - $SHA is the current tip of '$BRANCH'. Proceeding."
    exit 0
fi

log "SUPERSEDED - this pipeline is building $SHA,"
log "             but '$BRANCH' has since moved to $TIP."
log "Skipping this deploy so it cannot overwrite the newer one."
log "The pipeline for $TIP is responsible for deploying it."

if [ "${ALLOW_STALE_DEPLOY:-}" = "1" ]; then
    log "ALLOW_STALE_DEPLOY=1 is set - deploying the OLDER commit anyway, on purpose."
    exit 0
fi

exit 75
