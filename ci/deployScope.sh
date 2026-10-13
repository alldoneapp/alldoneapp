#!/bin/sh
#
# Decide what a production pipeline still has to deploy, by comparing the commit it is
# building against the commit each deploy target LAST SHIPPED — not against what this
# particular push happened to change.
#
# WHY THIS EXISTS
#
# Deploy jobs used to be scoped with `rules: changes:`, i.e. "deploy functions if THIS
# push touched functions/". Combined with ci/assertNewestCommit.sh (which correctly makes
# a superseded pipeline skip its deploy) that leaves a hole big enough to lose a release
# in, and it closes silently:
#
#   10:00  push A  touches functions/ only   -> pipeline A: functions deploy queued
#   10:03  push B  touches components/ only  -> pipeline B has NO functions deploy job,
#                                               because B's push changed no functions/ path
#   10:08  pipeline A reaches its functions deploy, sees master has moved to B,
#          and skips as "superseded" (exit 75)
#
# A's functions change is now deployed by nobody. Every job in both pipelines is green,
# the pipeline graph looks healthy, and the only symptom is production running code that
# is one merge behind. Master takes ~11 pushes a day here with a median gap of 26 minutes
# and 28% of pushes landing within 10 minutes of another, so this is the normal case, not
# an edge case: 45 days of history contain ~34 functions-side and ~30 web-side occurrences.
#
# WHAT THIS DOES
#
# Each deploy target keeps a MARKER: a git tag `deployed/<target>` pointing at the last
# commit that target successfully shipped. The scope of a deploy is then
#
#     git diff <marker> <this commit> -- <the target's paths>
#
# which is inherently catch-up: whatever a superseded pipeline skipped is still missing
# from the marker, so the NEXT pipeline sees it and ships it along with its own change.
# Nothing is lost, and a target whose paths did not move since its last deploy is still
# skipped, so this costs no extra deploys in the steady state.
#
# It is also self-healing for failures, retries, rollbacks and manual deploys: the marker
# only moves after a deploy actually succeeds, and the comparison is a two-commit tree
# diff rather than a commit range, so it stays meaningful even when the marker is not an
# ancestor of HEAD (after a revert or a force-push).
#
# SUBCOMMANDS
#
#   compute            Write deploy-scope.env with one DEPLOY_<TARGET>=0|1 per target.
#                      Run once per pipeline, early; every later job reads the artifact
#                      so web build/test/deploy use the same data. Functions refresh
#                      their graph inside the serialized deployment job.
#   require <target>   Exit 0 if that target must be deployed, 76 if it must not.
#   record <target>    Move the marker to this commit. Call only after a successful
#                      deploy. Never fails the job.
#   marker-read <t>    Print the marker commit (used by ci/github-push.sh).
#   functions-plan <t> Refresh function names from the verified marker; 76 on no-op.
#   functions-begin <t> Record the attempt BEFORE deploying; fails closed if unavailable.
#
# EXIT CODES
#
#   0   this target needs deploying (or the answer could not be determined - see below)
#   76  nothing to do for this target; the caller should stop. CI callers translate this
#       deliberate no-op to a successful early exit so GitLab does not render an expected
#       skip as a failed-with-warnings job. The explicit log and the wrapper's early exit
#       preserve the distinction from the historical `xargs -r` bug, where no test ran
#       accidentally and the script silently continued.
#
# FAILING SAFE
#
# Every uncertain path resolves to "deploy". A redundant deploy is visible and cheap; a
# skipped one is invisible and ships nothing. So a missing marker, an unreadable remote,
# a missing scope file or a git-less image all mean "deploy", never "skip".
#
# SETUP (one-time, and it degrades gracefully until it is done)
#
# Recording a marker pushes a tag. The short-lived CI_JOB_TOKEN can do that when GitLab's
# same-project "Allow Git push requests to the repository" setting is enabled. A masked
# DEPLOY_MARKER_TOKEN with write_repository remains an explicit override for older GitLab
# instances or projects that deliberately keep job-token pushes disabled.
# Until either route works, `record` warns and the target falls back to the old push-range
# comparison for path-scoped targets. Functions require attempt-marker writes before
# deploying so a partial failure followed by a revert can never be silently skipped.
#
# Tag pipelines cannot be triggered by this: the workflow rules in .gitlab-ci.yml only
# admit pipelines that have $CI_COMMIT_BRANCH, which a tag push does not.

set -eu

CMD="${1:-}"
TARGET="${2:-}"

# Resolve everything against the project root, never the current directory: the functions
# and runner deploy jobs `cd functions` in their before_script, so a relative path would
# look for the scope artifact and the path lists inside functions/ and silently miss both.
SCRIPT_DIR="$(dirname "$0")"
PROJECT_DIR="${CI_PROJECT_DIR:-${SCRIPT_DIR}/..}"

SCOPE_FILE="${DEPLOY_SCOPE_FILE:-${PROJECT_DIR}/deploy-scope.env}"
PATHS_DIR="${DEPLOY_SCOPE_PATHS_DIR:-${PROJECT_DIR}/ci/deploy-scope}"
MARKER_NAMESPACE="deployed"
NOT_NEEDED_EXIT_CODE=76

# Production targets reported by `compute`. Functions also refresh their selection
# inside the serialized deploy job; staging uses that same selection directly.
TARGETS="web-production functions-production runner-production firestore-rules-production firestore-tests"

log() {
    echo "deploy-scope${TARGET:+ [$TARGET]}: $1"
}

die() {
    log "ERROR: $1"
    exit 1
}

# DEPLOY_WEB_PRODUCTION from web-production, and so on.
target_var() {
    echo "DEPLOY_$(echo "$1" | tr 'a-z-' 'A-Z_')"
}

marker_ref() {
    echo "refs/tags/${MARKER_NAMESPACE}/$1"
}

paths_file() {
    echo "${PATHS_DIR}/$1.paths"
}

have_git() {
    command -v git >/dev/null 2>&1
}

# Always act on the project root explicitly. The functions and runner deploy jobs run this
# from functions/, and a bare `git` would then resolve against whatever directory the job
# happened to be in.
g() {
    git -C "$PROJECT_DIR" "$@"
}

# The marker lives on the remote, because the runner's checkout is shallow and
# disposable. Read it there rather than trusting anything local.
marker_remote_sha() {
    have_git || return 1
    remote_refs="$(g ls-remote origin "$(marker_ref "$1")" 2>/dev/null)" || return 1
    printf '%s\n' "$remote_refs" | awk 'NR == 1 { print $1 }'
}

# A tree diff only needs both commit objects present, not a shared history, so a
# depth-1 fetch of the marker is enough even in GitLab's depth-50 clone.
fetch_marker() {
    ref="$(marker_ref "$1")"
    g fetch --quiet --depth=1 origin "+${ref}:${ref}" >/dev/null 2>&1 || return 1
    g cat-file -e "${ref}^{commit}" >/dev/null 2>&1 || return 1
}

commit_exists() {
    [ -n "${1:-}" ] || return 1
    # An all-zero sha is how GitLab spells "there was no previous commit".
    case "$1" in
        0000000000000000000000000000000000000000) return 1 ;;
    esac
    g cat-file -e "${1}^{commit}" >/dev/null 2>&1
}

# Comment- and blank-line-tolerant pattern list. A blank line in a `grep -f` file matches
# EVERY line, which would silently mark every target as needing a deploy.
compiled_paths() {
    file="$(paths_file "$1")"
    [ -f "$file" ] || die "no path list at $file"
    sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$file"
}

# 0 = this target has changes to ship, 1 = it does not.
target_has_changes() {
    t="$1"
    base=""
    mode=""

    if have_git; then
        marker_target="$t"
        marker="$(marker_remote_sha "$marker_target" || true)"
        # Before the first dedicated test marker, a successful rules deployment
        # is a tested baseline: that deployment was gated by the emulator suite.
        if [ "$t" = "firestore-tests" ] && [ -z "$marker" ]; then
            marker_target="firestore-rules-production"
            marker="$(marker_remote_sha "$marker_target" || true)"
        fi
        if [ -n "$marker" ] && fetch_marker "$marker_target"; then
            base="$marker"
            mode="marker"
        fi
    fi

    if [ -z "$base" ]; then
        if [ "$t" = "firestore-tests" ]; then
            log "no verified test baseline; running the complete rules suite."
            return 0
        fi
        # No marker yet (or no git): fall back to the range this push introduced, which
        # is what `rules: changes:` used to compare. Same behaviour as before, including
        # the same hole - hence the warning.
        if have_git && commit_exists "${CI_COMMIT_BEFORE_SHA:-}"; then
            base="$CI_COMMIT_BEFORE_SHA"
            mode="push-range"
            log "WARNING: no '$(marker_ref "$t")' marker on the remote yet."
            log "         Falling back to this push's own diff, which cannot catch up"
            log "         work a superseded pipeline skipped. Set DEPLOY_MARKER_TOKEN"
            log "         (project access token, write_repository) to enable markers."
        else
            log "cannot establish a comparison point; assuming a deploy is needed."
            return 0
        fi
    fi

    # Tests must use this exact verified deployment baseline, not a new remote
    # read later in the pipeline and not the most recent push's parent.
    if [ "$t" = "web-production" ] && [ "$mode" = "marker" ]; then
        WEB_TEST_BASE="$base"
    fi

    if ! commit_exists "$CI_COMMIT_SHA"; then
        log "this commit is not available locally; assuming a deploy is needed."
        return 0
    fi

    if [ "$t" = "functions-production" ]; then
        # Individual exports and their transitive imports, including shared files
        # outside functions/, determine the selection. An unverified push-range
        # baseline cannot prove what shipped, so it deliberately selects all.
        function_base=""
        if [ "$mode" = "marker" ]; then function_base="$base"; fi
        force_all="${FUNCTIONS_DEPLOY_ALL:-0}"
        attempt="$(marker_remote_sha "${t}-attempt" || echo unknown)"
        if [ -n "$attempt" ] && [ "$attempt" != "$function_base" ]; then force_all=1; fi
        if FUNCTIONS_DEPLOY_ALL="$force_all" node "${SCRIPT_DIR}/selectFunctionsDeployment.js" "$function_base" "$CI_COMMIT_SHA" "${PROJECT_DIR}/functions-deploy-scope.json"; then
            return 0
        else
            status=$?
            if [ "$status" -eq 76 ]; then return 1; fi
            die "Functions dependency analysis failed; refusing to publish an incomplete selection."
        fi
    fi

    changed="$(g diff --name-only "$base" "$CI_COMMIT_SHA" 2>/dev/null || true)"
    if [ -z "$changed" ]; then
        # An empty diff is only trustworthy when git actually answered. `git diff` against
        # an object it cannot reach errors out, and `|| true` above turns that into the
        # same empty string, so re-check the base is really usable before believing it.
        if commit_exists "$base"; then
            log "no changes since ${mode} base ${base}."
            return 1
        fi
        log "could not diff against ${base}; assuming a deploy is needed."
        return 0
    fi

    patterns_file="$(mktemp)"
    compiled_paths "$t" >"$patterns_file"
    matched="$(printf '%s\n' "$changed" | grep -E -f "$patterns_file" || true)"
    rm -f "$patterns_file"

    if [ -n "$matched" ]; then
        log "changes since ${mode} base ${base}:"
        printf '%s\n' "$matched" | head -n 20 | sed 's/^/  /'
        count="$(printf '%s\n' "$matched" | wc -l | tr -d ' ')"
        # Not `[ ... ] && log ...`: under `set -e` a false test makes that list the
        # failing statement and kills the script.
        if [ "$count" -gt 20 ]; then
            log "  ... and $((count - 20)) more"
        fi
        return 0
    fi

    log "nothing relevant changed since ${mode} base ${base}."
    return 1
}

cmd_compute() {
    : >"$SCOPE_FILE"
    WEB_TEST_BASE=""
    for t in $TARGETS; do
        TARGET="$t"
        if target_has_changes "$t"; then
            echo "$(target_var "$t")=1" >>"$SCOPE_FILE"
        else
            echo "$(target_var "$t")=0" >>"$SCOPE_FILE"
        fi
    done
    TARGET=""
    (cd "$PROJECT_DIR" && node "${SCRIPT_DIR}/selectTargetedJestFiles.js" "$WEB_TEST_BASE" "$CI_COMMIT_SHA" "${PROJECT_DIR}/web-test-scope.json")
    functions_test_base="$(node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); console.log(p.base || "")' "${PROJECT_DIR}/functions-deploy-scope.json")"
    (cd "$PROJECT_DIR" && node "${SCRIPT_DIR}/selectTargetedJestFiles.js" "$functions_test_base" "$CI_COMMIT_SHA" "${PROJECT_DIR}/functions-test-scope.json" --functions)
    log "wrote $SCOPE_FILE:"
    sed 's/^/  /' "$SCOPE_FILE"
}

cmd_require() {
    [ -n "$TARGET" ] || die "require needs a target"

    if [ ! -f "$SCOPE_FILE" ]; then
        # The scope job did not run, or its artifact did not reach here. Deploying is the
        # safe reading of that: worst case it is redundant.
        log "no $SCOPE_FILE artifact; proceeding as if a deploy is needed."
        return 0
    fi

    var="$(target_var "$TARGET")"
    value="$(sed -n "s/^${var}=//p" "$SCOPE_FILE" | head -n 1)"

    if [ "$value" = "0" ]; then
        log "already deployed - nothing changed for this target since its last deploy."
        log "Skipping on purpose (exit ${NOT_NEEDED_EXIT_CODE})."
        exit "$NOT_NEEDED_EXIT_CODE"
    fi

    if [ -z "$value" ]; then
        log "no entry for ${var} in $SCOPE_FILE; proceeding as if a deploy is needed."
        return 0
    fi

    log "deploy needed."
    return 0
}

cmd_record() {
    [ -n "$TARGET" ] || die "record needs a target"

    marker_push_user=""
    if [ -n "${DEPLOY_MARKER_TOKEN:-}" ]; then
        marker_push_user="deploy-marker"
        MARKER_PUSH_TOKEN="$DEPLOY_MARKER_TOKEN"
    elif [ -n "${CI_JOB_TOKEN:-}" ]; then
        marker_push_user="gitlab-ci-token"
        MARKER_PUSH_TOKEN="$CI_JOB_TOKEN"
    else
        [ "$CMD" != "functions-begin" ] || die "Cannot record Functions attempt without a marker token."
        log "WARNING: neither CI_JOB_TOKEN nor DEPLOY_MARKER_TOKEN is available, so the"
        log "         deploy marker cannot be recorded. Every pipeline will keep"
        log "         falling back to its own push diff."
        return 0
    fi
    export MARKER_PUSH_TOKEN

    if ! have_git; then
        [ "$CMD" != "functions-begin" ] || die "Cannot record Functions attempt without git."
        log "WARNING: git is unavailable, so the deploy marker was not recorded."
        return 0
    fi

    url="https://${CI_SERVER_HOST:-gitlab.com}/${CI_PROJECT_PATH:-}.git"
    ref="$(marker_ref "$TARGET")"
    source_ref="$CI_COMMIT_SHA"
    if [ "$TARGET" = "web-full-tests" ]; then
        # Annotated tags carry the validation time, not the source commit time.
        # A superseded full run must not move this marker backwards.
        latest="$(g ls-remote origin "refs/heads/${CI_DEFAULT_BRANCH:-master}" 2>/dev/null | awk 'NR == 1 { print $1 }')"
        if [ "$latest" != "$CI_COMMIT_SHA" ]; then
            log "not recording full-suite time for an unverified or superseded commit."
            return 0
        fi
        if ! g -c user.name='Alldone CI' -c user.email='ci@alldone.app' tag --force --annotate "${MARKER_NAMESPACE}/${TARGET}" "$CI_COMMIT_SHA" --message='Full web test suite passed'; then
            log "WARNING: full-suite timestamp could not be recorded; the next deployment will run the full suite."
            return 0
        fi
        source_ref="$ref"
    fi

    # The token is handed to git through a credential helper reading the environment, so
    # it never appears in a remote URL, a process command line or a GIT_TRACE dump - the
    # same precaution ci/github-push.sh takes.
    if g \
        -c "credential.${url}.helper=!f() { echo username=${marker_push_user}; echo password=\${MARKER_PUSH_TOKEN}; }; f" \
        push --force --quiet "$url" "${source_ref}:${ref}" >/dev/null 2>&1; then
        log "marker ${ref} now points at ${CI_COMMIT_SHA}."
    else
        [ "$CMD" != "functions-begin" ] || die "Could not record Functions attempt; refusing an untracked partial deploy."
        # Not fatal: the deploy itself succeeded. The next pipeline will simply compare
        # against the older marker and redeploy this range, which is wasteful but correct.
        log "WARNING: could not push ${ref}. The deploy succeeded; the next pipeline will"
        log "         redeploy this range. For CI_JOB_TOKEN, enable Settings > CI/CD >"
        log "         Job token permissions > Allow Git push requests to the repository."
        log "         For DEPLOY_MARKER_TOKEN, check write_repository and tag protection."
    fi
    return 0
}

cmd_marker_read() {
    [ -n "$TARGET" ] || die "marker-read needs a target"
    marker_remote_sha "$TARGET" || true
}

cmd_functions_plan() {
    case "$TARGET" in functions-production|functions-staging) ;; *) die "functions-plan requires a Functions target" ;; esac
    base=""
    marker="$(marker_remote_sha "$TARGET" || true)"
    if [ -n "$marker" ] && fetch_marker "$TARGET"; then base="$marker"; fi
    # A failed deploy can have updated only some batches. Even a subsequent
    # revert back to the last successful source must repair those live functions.
    force_all="${FUNCTIONS_DEPLOY_ALL:-0}"
    attempt="$(marker_remote_sha "${TARGET}-attempt" || echo unknown)"
    if [ -n "$attempt" ] && [ "$attempt" != "$base" ]; then
        log "Unverified prior deployment attempt; reconciling all Functions."
        force_all=1
    fi
    FUNCTIONS_DEPLOY_ALL="$force_all" node "${SCRIPT_DIR}/selectFunctionsDeployment.js" "$base" "$CI_COMMIT_SHA" "${PROJECT_DIR}/functions-deploy-scope.json"
}

cmd_functions_begin() {
    case "$TARGET" in functions-production|functions-staging) ;; *) die "functions-begin requires a Functions target" ;; esac
    TARGET="${TARGET}-attempt"
    cmd_record
}

case "$CMD" in
    compute) cmd_compute ;;
    require) cmd_require ;;
    record) cmd_record ;;
    marker-read) cmd_marker_read ;;
    functions-plan) cmd_functions_plan ;;
    functions-begin) cmd_functions_begin ;;
    *)
        echo "usage: $0 {compute | require <target> | record <target> | marker-read <target> | functions-plan <target> | functions-begin <target>}" >&2
        echo "targets: $TARGETS" >&2
        exit 2
        ;;
esac
