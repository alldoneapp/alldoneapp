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
#   marker-read <t>    Print the verified marker commit (used by ci/github-push.sh).
#   functions-plan <t> Refresh function names from the verified marker; 76 on no-op.
#   functions-begin <t> Record the attempt BEFORE deploying; fails closed if unavailable.
#   has-changes <t>    Exit 0 / 76 for one target, the decision `compute` makes for each.
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
# WHO MAY MOVE A MARKER (security audit 2026-11, NV-01)
#
# A marker can only ever make a deploy SMALLER, so a forged one is a way to hold back a
# reviewed fix: point `deployed/firestore-rules-production` at any commit whose rules equal
# master's, and the rules release reports "already deployed". The tags cannot be protected
# in GitLab, because a protected tag can never be moved again and CI force-moves them on
# every deploy. Anyone with Developer access (or a branch pipeline's job token) can push
# them. So a production marker is only believed when ALL of these hold:
#
#   1. It is an annotated tag whose message names this target, the commit, the default
#      branch, the pipeline and the job, signed with HMAC-SHA256 under
#      DEPLOY_MARKER_SIGNING_KEY. That variable is protected, so only default-branch
#      pipelines can read it, and only they can sign. A lightweight tag, a missing or wrong
#      signature, another target's marker copied over this one, or a marker signed for a
#      branch other than the default one are all rejected.
#   2. The marked commit is an ancestor of the commit under test (and so of the default
#      branch). The history is deepened as far as that takes.
#   3. Changes are read from every commit in marker..HEAD, not only from the two trees.
#      An old genuine marker replayed after a revert (rules A, then B deployed, then back
#      to A) has an empty tree diff but a non-empty range, so it still deploys.
#
# Anything that fails these checks is treated like a missing marker, and for a production
# target a missing marker now means "deploy" (it used to fall back to the push range, which
# a deleted tag could exploit). Staging markers (functions-staging*) are written by feature
# branch pipelines on purpose, have no key and are taken as they are: staging is reachable
# from any branch anyway.
#
# Pushing a tag needs CI_JOB_TOKEN with "Allow Git push requests to the repository", or the
# DEPLOY_MARKER_TOKEN override. Without DEPLOY_MARKER_SIGNING_KEY a default-branch pipeline
# fails in `compute` with a message naming the variable, rather than silently deploying
# everything (Functions in full) on every push.
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
    # marker-read hands its stdout to a caller as data, so its diagnostics go to stderr.
    if [ "${LOG_TO_STDERR:-0}" = "1" ]; then
        echo "deploy-scope${TARGET:+ [$TARGET]}: $1" >&2
    else
        echo "deploy-scope${TARGET:+ [$TARGET]}: $1"
    fi
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

# Staging markers are written by feature-branch pipelines on purpose (manual staging
# deploys), which cannot read the signing key. Everything else decides what production
# ships or what the public mirror publishes, and must be signed. Unknown names count as
# production: a new target is protected unless someone deliberately lists it here.
is_unsigned_target() {
    case "$1" in
        functions-staging | functions-staging-attempt) return 0 ;;
        *) return 1 ;;
    esac
}

on_default_branch() {
    [ -n "${CI_DEFAULT_BRANCH:-}" ] && [ "${CI_COMMIT_BRANCH:-}" = "$CI_DEFAULT_BRANCH" ]
}

require_signing_key() {
    [ -n "${DEPLOY_MARKER_SIGNING_KEY:-}" ] && return 0
    die "DEPLOY_MARKER_SIGNING_KEY is not available. Production deploy markers are only trusted
       when signed with it (see 'WHO MAY MOVE A MARKER' in ci/deployScope.sh). Create it once
       as a protected, masked CI/CD variable (e.g. \`openssl rand -hex 32\`) and retry the job."
}

# HMAC-SHA256 of $1 under DEPLOY_MARKER_SIGNING_KEY, as lowercase hex. The CI images differ
# (node on the Firebase images, openssl on Alpine/Debian, gcloud's bundled Python on
# cloud-sdk:slim), so take whichever exists; all compute the same RFC 2104 value over the
# key's bytes. DEPLOY_MARKER_HMAC_TOOL pins one, for the test that holds them equal.
hmac_hex() {
    MARKER_HMAC_MESSAGE="$1"
    export MARKER_HMAC_MESSAGE
    tool="${DEPLOY_MARKER_HMAC_TOOL:-}"
    if [ -z "$tool" ]; then
        if command -v node >/dev/null 2>&1; then
            tool=node
        elif command -v python3 >/dev/null 2>&1; then
            tool=python3
        elif command -v openssl >/dev/null 2>&1; then
            tool=openssl
        elif command -v gcloud >/dev/null 2>&1; then
            tool=gcloud-python
        else
            return 1
        fi
    fi
    py='import hashlib, hmac, os, sys; sys.stdout.write(hmac.new(os.environ["DEPLOY_MARKER_SIGNING_KEY"].encode(), os.environ["MARKER_HMAC_MESSAGE"].encode(), hashlib.sha256).hexdigest())'
    case "$tool" in
        node)
            node -e 'process.stdout.write(require("crypto").createHmac("sha256", process.env.DEPLOY_MARKER_SIGNING_KEY).update(process.env.MARKER_HMAC_MESSAGE).digest("hex"))'
            ;;
        python3) python3 -c "$py" ;;
        openssl)
            # The only variant that puts the key on a command line; it is the fallback for
            # images without an interpreter, and the job container runs nothing else.
            printf '%s' "$MARKER_HMAC_MESSAGE" | openssl dgst -sha256 -hmac "$DEPLOY_MARKER_SIGNING_KEY" -r | awk '{ print $1 }'
            ;;
        gcloud-python)
            interpreter="$(gcloud info --format='value(basic.python_location)' 2>/dev/null || true)"
            [ -n "$interpreter" ] && [ -x "$interpreter" ] || return 1
            "$interpreter" -c "$py"
            ;;
        *) return 1 ;;
    esac
}

# The exact bytes a signature covers. Every field the verifier relies on is in here.
marker_payload() {
    printf 'alldone-deploy-marker-v1\ntarget=%s\ncommit=%s\nref=%s\npipeline=%s\njob=%s' "$1" "$2" "$3" "$4" "$5"
}

# The marker lives on the remote, because the runner's checkout is shallow and
# disposable. Read it there rather than trusting anything local. Prints the ref's own
# object id (the tag object for an annotated tag); empty when there is no marker.
marker_remote_sha() {
    have_git || return 1
    remote_refs="$(g ls-remote origin "$(marker_ref "$1")" 2>/dev/null)" || return 1
    printf '%s\n' "$remote_refs" | awk 'NR == 1 { print $1 }'
}

# A tree diff only needs both commit objects present, not a shared history, so a
# depth-1 fetch of the marker is enough in GitLab's depth-50 clone. In a complete clone
# (mirror:github sets GIT_DEPTH 0) `--depth=1` would graft a shallow boundary at the
# marker and cut off everything older, including the mirror's cutoff commit, so fetch
# normally there: the commit is already present and only the tag object is transferred.
fetch_marker() {
    ref="$(marker_ref "$1")"
    if [ "$(g rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
        g fetch --quiet --depth=1 origin "+${ref}:${ref}" >/dev/null 2>&1 || return 1
    else
        g fetch --quiet --no-tags origin "+${ref}:${ref}" >/dev/null 2>&1 || return 1
    fi
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

# 0 when $1 is an ancestor of (or equal to) $2. The CI clone is shallow, so deepen the
# default branch only as far as the answer needs; "not found" is only believed once the
# history is complete, and every failure reads as "not an ancestor" (= deploy).
is_ancestor() {
    g merge-base --is-ancestor "$1" "$2" >/dev/null 2>&1 && return 0
    branch="${CI_DEFAULT_BRANCH:-master}"
    for deepen in 1000 unshallow; do
        [ "$(g rev-parse --is-shallow-repository 2>/dev/null)" = "true" ] || return 1
        if [ "$deepen" = "unshallow" ]; then
            g fetch --quiet --unshallow origin "+refs/heads/${branch}:refs/remotes/origin/${branch}" >/dev/null 2>&1 || return 1
        else
            g fetch --quiet --deepen="$deepen" origin "+refs/heads/${branch}:refs/remotes/origin/${branch}" >/dev/null 2>&1 || return 1
        fi
        g merge-base --is-ancestor "$1" "$2" >/dev/null 2>&1 && return 0
    done
    return 1
}

# Print the commit a target's marker vouches for, or fail. Unsigned (staging) targets are
# taken as they are; every other target must pass the checks in 'WHO MAY MOVE A MARKER'.
# A missing marker fails quietly; a rejected one says why.
verified_marker() {
    t="$1"
    remote="$(marker_remote_sha "$t" || true)"
    [ -n "$remote" ] || return 1
    fetch_marker "$t" || {
        LOG_TO_STDERR=1 log "marker $(marker_ref "$t") exists but could not be fetched; not trusting it."
        return 1
    }
    ref="$(marker_ref "$t")"
    commit="$(g rev-parse --verify --quiet "${ref}^{commit}" 2>/dev/null || true)"
    [ -n "$commit" ] || return 1

    if is_unsigned_target "$t"; then
        echo "$commit"
        return 0
    fi

    # Its output is data for the caller, so diagnostics go to stderr (still in the job log).
    reject() {
        LOG_TO_STDERR=1 log "IGNORING marker $(marker_ref "$t") -> ${commit}: $1"
        LOG_TO_STDERR=1 log "         Treating the target as never deployed (it will deploy)."
    }

    [ "$(g cat-file -t "$ref" 2>/dev/null || true)" = "tag" ] || {
        reject "not an annotated tag written by CI (no signature)."
        return 1
    }
    [ -n "${DEPLOY_MARKER_SIGNING_KEY:-}" ] || {
        reject "DEPLOY_MARKER_SIGNING_KEY is not available to verify it."
        return 1
    }
    # Only the message, not the tag header: the fields must come from what was signed.
    body="$(g cat-file tag "$ref" 2>/dev/null | awk 'seen { print } /^$/ { seen = 1 }')"
    field() {
        printf '%s\n' "$body" | sed -n "s/^$1=//p" | head -n 1
    }
    m_target="$(field target)"
    m_commit="$(field commit)"
    m_ref="$(field ref)"
    m_pipeline="$(field pipeline)"
    m_job="$(field job)"
    m_signature="$(field signature)"

    [ "$m_target" = "$t" ] || {
        reject "signed for target '${m_target}', not '${t}'."
        return 1
    }
    [ "$m_commit" = "$commit" ] || {
        reject "the signed commit does not match the tagged one."
        return 1
    }
    [ "$m_ref" = "${CI_DEFAULT_BRANCH:-master}" ] || {
        reject "signed for ref '${m_ref}', not the default branch."
        return 1
    }
    expected="$(hmac_hex "$(marker_payload "$m_target" "$m_commit" "$m_ref" "$m_pipeline" "$m_job")" || true)"
    [ -n "$expected" ] || {
        reject "no HMAC tool (node, python3, openssl) to verify the signature."
        return 1
    }
    [ "$m_signature" = "hmac-sha256:${expected}" ] || {
        reject "the signature does not verify."
        return 1
    }
    commit_exists "${CI_COMMIT_SHA:-}" || {
        reject "the commit under test is not available to check ancestry."
        return 1
    }
    is_ancestor "$commit" "$CI_COMMIT_SHA" || {
        reject "not an ancestor of ${CI_COMMIT_SHA} (marker from another branch, or newer than this pipeline)."
        return 1
    }
    echo "$commit"
}

# Every path touched by any commit in base..head plus the two-tree diff. With a verified
# ancestor marker the range is complete, so a change that was made and later reverted
# still counts: production may be running the intermediate state (see point 3 above).
changed_paths() {
    cp_base="$1"
    {
        g diff --name-only --no-renames "$cp_base" "$CI_COMMIT_SHA" 2>/dev/null || echo "__deploy_scope_diff_failed__"
        if [ "${2:-}" = "range" ]; then
            g log --format= --name-only --no-renames -m "${cp_base}..${CI_COMMIT_SHA}" 2>/dev/null || echo "__deploy_scope_diff_failed__"
        fi
    } | sed '/^$/d' | sort -u
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
        marker="$(verified_marker "$marker_target" || true)"
        # Before the first dedicated test marker, a successful rules deployment
        # is a tested baseline: that deployment was gated by the emulator suite.
        if [ "$t" = "firestore-tests" ] && [ -z "$marker" ]; then
            marker_target="firestore-rules-production"
            marker="$(verified_marker "$marker_target" || true)"
        fi
        if [ -n "$marker" ]; then
            base="$marker"
            mode="marker"
        fi
    fi

    if [ -z "$base" ]; then
        if [ "$t" = "firestore-tests" ]; then
            log "no verified test baseline; running the complete rules suite."
            return 0
        fi
        if [ "$t" = "functions-production" ]; then
            # Still run the selector below: with no base it plans a full deployment, and
            # `compute` reads the plan it writes (functions-deploy-scope.json).
            log "no verified '$(marker_ref "$t")' marker; planning a full Functions deployment."
        elif ! is_unsigned_target "$t"; then
            # The push-range fallback used to apply here. A production marker can be
            # deleted by anyone who can push tags, which would turn that fallback into a way
            # to drop work a superseded pipeline skipped, so no verified marker = deploy.
            log "no verified '$(marker_ref "$t")' marker; assuming a deploy is needed."
            return 0
        elif have_git && commit_exists "${CI_COMMIT_BEFORE_SHA:-}"; then
            # Unsigned (staging) targets only: fall back to the range this push introduced,
            # which is what `rules: changes:` used to compare.
            base="$CI_COMMIT_BEFORE_SHA"
            mode="push-range"
            log "WARNING: no '$(marker_ref "$t")' marker on the remote yet; using this push's own diff."
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

    if [ "$t" != "functions-production" ] && ! commit_exists "$CI_COMMIT_SHA"; then
        log "this commit is not available locally; assuming a deploy is needed."
        return 0
    fi

    # A verified production marker is an ancestor, so the commit range is meaningful.
    range=""
    if [ "$mode" = "marker" ] && ! is_unsigned_target "$t"; then range="range"; fi

    if [ "$t" = "functions-production" ]; then
        # Individual exports and their transitive imports, including shared files
        # outside functions/, determine the selection. An unverified push-range
        # baseline cannot prove what shipped, so it deliberately selects all.
        function_base=""
        if [ "$mode" = "marker" ]; then function_base="$base"; fi
        force_all="${FUNCTIONS_DEPLOY_ALL:-0}"
        attempt="$(verified_marker "${t}-attempt" || echo unknown)"
        if [ "$attempt" != "$function_base" ]; then force_all=1; fi
        extra_file="$(mktemp)"
        if [ -n "$function_base" ]; then changed_paths "$function_base" "$range" >"$extra_file"; fi
        if FUNCTIONS_EXTRA_CHANGED_FILES="$extra_file" FUNCTIONS_DEPLOY_ALL="$force_all" node "${SCRIPT_DIR}/selectFunctionsDeployment.js" "$function_base" "$CI_COMMIT_SHA" "${PROJECT_DIR}/functions-deploy-scope.json"; then
            rm -f "$extra_file"
            return 0
        else
            status=$?
            rm -f "$extra_file"
            if [ "$status" -eq 76 ]; then return 1; fi
            die "Functions dependency analysis failed; refusing to publish an incomplete selection."
        fi
    fi

    changed="$(changed_paths "$base" "$range")"
    case "$changed" in
        *__deploy_scope_diff_failed__*)
            log "could not diff against ${base}; assuming a deploy is needed."
            return 0
            ;;
    esac
    if [ -z "$changed" ]; then
        # An empty diff is only trustworthy when git actually answered.
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
    # Without the key no production marker can be verified or written, so every target
    # would deploy on every push (Functions in full). Stop here with the reason instead.
    if on_default_branch; then require_signing_key; fi
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
        log "         deploy marker cannot be recorded. The next pipeline will deploy again."
        return 0
    fi
    export MARKER_PUSH_TOKEN

    if ! have_git; then
        [ "$CMD" != "functions-begin" ] || die "Cannot record Functions attempt without git."
        log "WARNING: git is unavailable, so the deploy marker was not recorded."
        return 0
    fi

    # Not moving a production marker is always safe (the next pipeline compares against the
    # older one and deploys again); moving it to an unsigned tag is not, because verifiers
    # would ignore it and an unsigned production tag is exactly what an attacker writes.
    cannot_sign() {
        [ "$CMD" != "functions-begin" ] || die "Cannot sign the Functions attempt marker: $1"
        log "WARNING: not recording $(marker_ref "$TARGET"): $1"
        log "         The next pipeline compares against the previous marker and deploys again."
    }

    url="${DEPLOY_MARKER_PUSH_URL:-https://${CI_SERVER_HOST:-gitlab.com}/${CI_PROJECT_PATH:-}.git}"
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
    fi

    if ! is_unsigned_target "$TARGET"; then
        # Only protected default-branch pipelines can read the key; refuse anything else even
        # if it somehow could, so a mis-scoped variable cannot let a branch vouch for itself.
        if ! on_default_branch || [ "${CI_COMMIT_REF_PROTECTED:-}" != "true" ]; then
            cannot_sign "production markers are only signed by protected default-branch pipelines."
            return 0
        fi
        if [ -z "${DEPLOY_MARKER_SIGNING_KEY:-}" ]; then
            cannot_sign "DEPLOY_MARKER_SIGNING_KEY is not available."
            return 0
        fi
        signature="$(hmac_hex "$(marker_payload "$TARGET" "$CI_COMMIT_SHA" "$CI_DEFAULT_BRANCH" "${CI_PIPELINE_ID:-}" "${CI_JOB_ID:-}")" || true)"
        if [ -z "$signature" ]; then
            cannot_sign "no HMAC tool (node, python3, openssl) in this image."
            return 0
        fi
        message_file="$(mktemp)"
        {
            marker_payload "$TARGET" "$CI_COMMIT_SHA" "$CI_DEFAULT_BRANCH" "${CI_PIPELINE_ID:-}" "${CI_JOB_ID:-}"
            printf '\nsignature=hmac-sha256:%s\n' "$signature"
        } >"$message_file"
        if ! g -c user.name='Alldone CI' -c user.email='ci@alldone.app' tag --force --annotate --cleanup=verbatim --file="$message_file" "${MARKER_NAMESPACE}/${TARGET}" "$CI_COMMIT_SHA" >/dev/null 2>&1; then
            rm -f "$message_file"
            cannot_sign "could not create the annotated tag."
            return 0
        fi
        rm -f "$message_file"
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

# Print the commit a marker vouches for, after the same verification `compute` applies;
# nothing when it is missing or rejected. stdout is data, so diagnostics go to stderr.
cmd_marker_read() {
    LOG_TO_STDERR=1
    [ -n "$TARGET" ] || die "marker-read needs a target"
    verified_marker "$TARGET" || true
}

# Exit 0 if the target has changes since its verified marker, 76 if not. `compute` does
# this for every target at once; this is the same decision for one, used by the tests.
cmd_has_changes() {
    [ -n "$TARGET" ] || die "has-changes needs a target"
    if on_default_branch && ! is_unsigned_target "$TARGET"; then require_signing_key; fi
    WEB_TEST_BASE=""
    if target_has_changes "$TARGET"; then exit 0; fi
    exit "$NOT_NEEDED_EXIT_CODE"
}

cmd_functions_plan() {
    case "$TARGET" in functions-production|functions-staging) ;; *) die "functions-plan requires a Functions target" ;; esac
    if ! is_unsigned_target "$TARGET"; then require_signing_key; fi
    base="$(verified_marker "$TARGET" || true)"
    # A failed deploy can have updated only some batches. Even a subsequent
    # revert back to the last successful source must repair those live functions.
    force_all="${FUNCTIONS_DEPLOY_ALL:-0}"
    if is_unsigned_target "$TARGET"; then
        # Staging keeps its old rule: only a recorded attempt that differs forces all.
        attempt="$(verified_marker "${TARGET}-attempt" || true)"
        if [ -n "$attempt" ] && [ "$attempt" != "$base" ]; then
            log "Unverified prior deployment attempt; reconciling all Functions."
            force_all=1
        fi
    else
        # Production: a missing or unverifiable attempt marker is no proof that the last
        # attempt finished, so it reconciles everything too.
        attempt="$(verified_marker "${TARGET}-attempt" || echo unknown)"
        if [ "$attempt" != "$base" ]; then
            log "No verified record that the last deployment attempt completed; reconciling all Functions."
            force_all=1
        fi
    fi
    extra_file="$(mktemp)"
    if [ -n "$base" ] && ! is_unsigned_target "$TARGET"; then
        changed_paths "$base" range >"$extra_file"
    fi
    status=0
    FUNCTIONS_EXTRA_CHANGED_FILES="$extra_file" FUNCTIONS_DEPLOY_ALL="$force_all" node "${SCRIPT_DIR}/selectFunctionsDeployment.js" "$base" "$CI_COMMIT_SHA" "${PROJECT_DIR}/functions-deploy-scope.json" || status=$?
    rm -f "$extra_file"
    return "$status"
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
    has-changes) cmd_has_changes ;;
    *)
        echo "usage: $0 {compute | require <target> | record <target> | marker-read <target> | functions-plan <target> | functions-begin <target>}" >&2
        echo "targets: $TARGETS" >&2
        exit 2
        ;;
esac
